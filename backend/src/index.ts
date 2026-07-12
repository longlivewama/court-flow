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

const app = express();

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
app.use(pinoHttp({ logger }));

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
