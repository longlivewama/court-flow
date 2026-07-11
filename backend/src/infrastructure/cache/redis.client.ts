import Redis from 'ioredis';
import { logger } from '../../shared/logger';

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy: (times) => {
    if (times > 10) return null; // stop retrying
    return Math.min(times * 100, 3000);
  },
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
