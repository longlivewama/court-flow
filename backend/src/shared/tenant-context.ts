/**
 * Request-scoped tenant context (CF-QA-005 — DB-level defense-in-depth).
 *
 * Application-level tenant scoping (`WHERE club_id = $1` on every domain
 * query, `requireClubResource()` in tenant.middleware.ts) is the primary
 * isolation boundary and is unchanged by this module. This adds a second,
 * database-enforced layer: Postgres Row-Level Security policies (see
 * migration 023) that check the session variable `app.current_club_id`.
 *
 * The variable must be set with `SET LOCAL` (transaction-scoped) — never a
 * plain `SET` — because `db` in client.ts is a pooled connection shared
 * across concurrent requests from different tenants. A plain `SET` would
 * leak the wrong tenant's scope onto whichever unrelated request the
 * connection is handed to next. AsyncLocalStorage carries the current
 * request's club_id through the call stack (including inside
 * `await`-chained usecases) without threading it through every function
 * signature; client.ts reads it once per query/transaction and applies it
 * with `SET LOCAL` immediately after `BEGIN`, so it is automatically
 * discarded at COMMIT/ROLLBACK regardless of what happens to the
 * connection afterward.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantStore {
  clubId: string | null; // null = explicit system/cross-tenant context (see runAsSystem)
}

const storage = new AsyncLocalStorage<TenantStore>();

/** Run `fn` with `clubId` as the active tenant for every DB call inside it. */
export function runWithTenant<T>(clubId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ clubId }, fn);
}

/**
 * Run `fn` with RLS's tenant check explicitly bypassed — for genuine
 * system-level operations that must legitimately reach across tenants
 * before a specific club is known (e.g. the payment webhook looking up a
 * booking by the gateway's opaque reference, before it knows which club
 * that booking belongs to). Use only at the specific call site that needs
 * it, never as a general escape hatch — every use should be commented with
 * why the operation is inherently cross-tenant.
 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ clubId: null }, fn);
}

/** Returns the active tenant's club_id, `null` if running as system, or `undefined` if no tenant context has been established at all (e.g. pre-auth, migrations, seed scripts) — callers distinguish "no context" from "explicitly system" so they can fall back to the unwrapped connection instead of paying transaction overhead they'll never use. */
export function getTenantContext(): TenantStore | undefined {
  return storage.getStore();
}
