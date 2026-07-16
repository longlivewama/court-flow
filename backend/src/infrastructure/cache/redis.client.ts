import Redis from 'ioredis';
import { logger } from '../../shared/logger';

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  // Never permanently give up: returning null makes ioredis stop reconnecting,
  // which would keep auth (and any other Redis dependency) dead until a manual
  // process restart even after Redis recovers. Back off and keep trying.
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));
redis.on('reconnecting', () => logger.warn('Redis reconnecting...'));

// ── Key helpers ────────────────────────────────────────────────
export const CACHE_KEYS = {
  courtList:    (clubId: string) => `club:${clubId}:courts`,
  workingHours: (clubId: string) => `club:${clubId}:working_hours`,
  clubSettings: (clubId: string) => `club:${clubId}:settings`,
  tokenRevoked: (tokenId: string) => `token:revoked:${tokenId}`,
  userLockout:  (userId: string) => `user:lockout:${userId}`,
} as const;

export const CACHE_TTL = {
  courtList:    30,      // 30 seconds
  workingHours: 30,
  clubSettings: 30,
  tokenRevoked: 60 * 60 * 24 * 8,  // 8 days (longer than refresh token)
} as const;
