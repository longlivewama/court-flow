import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { logger } from './shared/logger';
import { db } from './infrastructure/database/client';
import { redis } from './infrastructure/cache/redis.client';
import { registerRoutes } from './interfaces/http/routes';
import { globalErrorHandler } from './interfaces/http/middleware/error.middleware';
import { startCronJobs } from './infrastructure/cron';
import { seedDefaultOwner } from './infrastructure/database/seed';

// ── Process-level safety net ──────────────────────────────────
// A stray rejection or throw outside a request handler would otherwise
// terminate the process silently (Node ≥15 exits on unhandledRejection).
// Log it through the structured logger; only a truly corrupt state (an
// uncaught exception) warrants a clean exit so the orchestrator restarts us.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});

const app = express();

// ── Proxy trust ───────────────────────────────────────────────
// Behind a reverse proxy (nginx, load balancer), the client IP arrives in
// X-Forwarded-For. Trust the first hop so express-rate-limit keys on the real
// client IP instead of collapsing every request onto the proxy's single IP.
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────
app.use(
  helmet({
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    contentSecurityPolicy: false, // configured separately for API
  })
);

// ── CORS ─────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
);

// ── Middleware ────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));
// Redact credentials from request logs. pino-http's default `req` serializer
// logs ALL headers — including `Authorization: Bearer <token>` and the refresh
// `Cookie` — on every request. Strip them and log only the safe request shape.
app.use(pinoHttp({
  logger,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
  },
}));

// ── Routes ────────────────────────────────────────────────────
registerRoutes(app);

// ── Global error handler ─────────────────────────────────────
app.use(globalErrorHandler);

// ── Bootstrap ────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '4000', 10);

async function bootstrap() {
  try {
    await db.connect();
    logger.info('✅ PostgreSQL connected');

    await redis.ping();
    logger.info('✅ Redis connected');

    await seedDefaultOwner();
    logger.info('✅ Default dev owner ensured');

    startCronJobs();
    logger.info('✅ Cron jobs started');

    app.listen(PORT, () => {
      logger.info(`🚀 CourtFlow API running on port ${PORT}`);
    });
  } catch (err) {
    logger.error({ err }, '❌ Failed to start server');
    process.exit(1);
  }
}

bootstrap();

export { app };
