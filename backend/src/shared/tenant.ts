/**
 * Tenant scope resolution.
 *
 * Every authenticated request MUST derive its club scope from the verified
 * JWT (req.user.clubId) — never from an environment constant — so a token
 * minted for club A can never read or write club B's rows.
 *
 * The CLUB_ID environment variable survives only as the *default onboarding
 * club* for public, unauthenticated flows (legacy member self-signup without
 * a club slug, and the seeded showcase deployment).
 */
import { Request } from 'express';
import { UnauthorizedError } from './errors';

/** Strict: the authenticated session's tenant. Throws if unauthenticated. */
export function clubIdOf(req: Request): string {
  const clubId = req.user?.clubId;
  if (!clubId) {
    throw new UnauthorizedError('No tenant scope on this session');
  }
  return clubId;
}

/** Public flows only (member signup without slug). Never use after auth. */
export function defaultClubId(): string {
  const id = process.env.CLUB_ID;
  if (!id) {
    throw new Error('[tenant] CLUB_ID env var is not configured for the default onboarding club');
  }
  return id;
}
