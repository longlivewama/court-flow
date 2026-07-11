import pino from 'pino';
import fs from 'fs';

/**
 * Returns true when the process is running inside a Docker container.
 * Docker always creates /.dockerenv; DOCKER_ENV=true is a manual escape hatch
 * for environments where that file is absent (e.g. rootless / distroless images).
 */
function isDocker(): boolean {
  if (process.env.DOCKER_ENV === 'true') return true;
  try {
    fs.accessSync('/.dockerenv');
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the pino-pretty transport only for local development.
 * Falls back to undefined (plain JSON) if:
 *   - NODE_ENV is not 'development', OR
 *   - the process is running inside Docker, OR
 *   - pino-pretty is not installed (safe fallback instead of a startup crash).
 */
function resolvePrettyTransport(): pino.TransportSingleOptions | undefined {
  if (process.env.NODE_ENV !== 'development' || isDocker()) return undefined;

  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true } };
  } catch {
    return undefined;
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: resolvePrettyTransport(),
  base: { service: 'courtflow-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
