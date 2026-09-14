# CourtFlow Production Remediation — Progress Checkpoint

Follow-up QA audit remediation, started 2026-09-14, resuming from the prior
25-phase hardening pass (`COURTFLOW_PRODUCTION_HARDENING_PROGRESS.md`,
commit `13ae905`, docs commit `d0acb67`). Branch: `fix/refresh-cookie-samesite`.
Treating current HEAD as baseline per the resume protocol — did not restart
the prior pass.

## Finding status

| # | Finding | Verification | Status | Evidence |
|---|---|---|---|---|
| CF-QA-001 | Dev runtime config / seed / webhook secret | Reproduced partially | **FIXED** | See below |
| CF-QA-002 | Frontend dependency vulnerabilities | Reproduced (1 mod/6 high/1 crit) | **FIXED** | `npm audit`: 0 vulnerabilities |
| CF-QA-003 | Backend dependency vulnerabilities | Reproduced (7 mod/6 high/1 crit) | **FIXED (except xlsx)** | `npm audit`: 1 high (xlsx, no upstream fix) |
| CF-QA-004 | Duplicate/conflicting security headers | Reproduced live via curl | **FIXED** | live curl re-verified, single value per header |
| CF-QA-005 | Tenant isolation lacks DB-level RLS | Confirmed (app-level only) | **FIXED (scoped rollout)** | 17 direct-club_id tables under FORCE RLS, live cross-tenant tested; relationship-owned tables documented as follow-up |
| CF-QA-006 | Lint warnings | Reproduced (1 backend, 1 frontend) | **FIXED** | both 0 errors/0 warnings |
| CF-QA-S001 | Subscription court lock not tenant-scoped | Reproduced by code read | **FIXED** | live + unit-tested |

## CF-QA-001 — Runtime configuration

- **NODE_ENV**: base `docker-compose.yml` already used `${NODE_ENV:-development}`
  (fixed in the prior session), but nothing *forced* production behavior on a
  real deployment — an operator could reuse the base file and silently get
  dev security behavior. Added `docker-compose.prod.yml`, an override applied
  via `-f docker-compose.yml -f docker-compose.prod.yml`, which hardcodes
  `NODE_ENV=production` and uses Compose's `${VAR:?err}` syntax so the stack
  **refuses to start** if `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/`AUDIT_DB_PASSWORD`/
  `COURTFLOW_APP_DB_PASSWORD` aren't actually set (verified live: `docker compose
  config` errors out with all four `must be set for production` messages when
  unset, succeeds when set). Documented in README under a new "Production
  deployment" section.
- **Seed account**: `seedDefaultOwner()` already no-ops when `NODE_ENV === 'production'`
  (`backend/src/infrastructure/database/seed.ts:18`) — verified by reading the
  code, no change needed. **NOT REPRODUCIBLE** as a production issue (it's
  correctly dev-only already).
- **Webhook secret**: `assertWebhookSecretConfigured()` already throws at
  bootstrap if `NODE_ENV === 'production'` and `PAYMENT_WEBHOOK_SECRET` is
  unset (`payment-webhook.controller.ts`), called from `index.ts` bootstrap
  before the server starts listening. **NOT REPRODUCIBLE** — already fails
  closed. Live-verified missing/bad webhook signature → clean 400, no secret
  leaked, no stack trace.
- **Cookies**: `secure: process.env.NODE_ENV === 'production'` on the refresh
  cookie (`auth.controller.ts`) — correctly gated, live-verified `HttpOnly` +
  `SameSite=Lax` present; `Secure` absent on this dev stack (expected, dev
  runs over a self-signed cert with `NODE_ENV=development`) and will be
  present once `docker-compose.prod.yml` is applied.

## CF-QA-002 / CF-QA-003 — Dependency audits

**Frontend**: `next` 16.2.9 → `^16.3.5` (patched, non-major per npm),
`@tanstack/react-virtual` `^3.14.6` → `^3.14.13` (patch). `npm audit fix`
(no `--force`) cleared the remaining transitive dev-toolchain vulnerabilities
(browserslist/brace-expansion/js-yaml/baseline-browser-mapping, all from
eslint's own dependency tree). **Result: 8 → 0 vulnerabilities.** Full
production build verified (37 routes, same as before), typecheck clean,
lint clean, live-verified through Docker/Nginx (CSP nonce present, login page
loads, App Router routing intact).

**Backend**: `nodemailer` 6.10.1 → `10.0.10` (major; API usage was minimal —
`createTransport`/`sendMail` with plain options, no `raw`/custom
`envelope`/custom headers — only broke one type import,
`nodemailer.SendMailOptions` → named import `SendMailOptions`, fixed;
removed the now-obsolete `@types/nodemailer` devDependency since nodemailer
10 ships its own types). `bcrypt` 5.1.1 → `6.0.0` (major; removed the
`@mapbox/node-pre-gyp`/`tar` dependency chain entirely — that chain carried
the one **critical** advisory, `tar` decompression DoS, and was install-time
only, never runtime-reachable, since it's node-pre-gyp fetching a prebuilt
binary during `npm install`). `uuid` pinned via a new `"overrides": {"uuid":
"^11.1.0"}` in `package.json` to de-duplicate the transitive `uuid@8.3.2`
copies pulled in by `bull` and `node-cron` — verified both only call the
stable, unchanged `uuid.v4()` (grepped their source directly) before
applying, so this is safe. `xlsx@0.18.5`: **no patched version exists on
npm** (known SheetJS/npm situation). Verified usage is write-only —
`report.controller.ts` only calls `xlsx.utils.json_to_sheet()` /
`xlsx.write()` on our own DB-derived report data; the codebase never calls
`xlsx.read()`/`readFile()` on any user-uploaded or untrusted file — so the
prototype-pollution advisory (parse-time only) is **not reachable**, and the
ReDoS advisory's reachability is narrow (would need attacker-controlled
string content already in the DB, e.g. a crafted customer name, to reach a
staff-only export). **Classified ACCEPTED RISK WITH JUSTIFICATION** — no
upstream fix, low/no reachability, narrowly scoped (owner/receptionist-only
export endpoint). **Result: 14 → 1 vulnerability (xlsx, unfixable).**

Live-verified after rebuilding both Docker images (bcrypt is a native addon —
rebuilt for the Linux container, not just the macOS host): login (correct +
wrong password), protected endpoint access (fresh token 200, revoked token
correctly 401 "Token has been revoked"), refresh-token rotation, logout,
webhook rejects missing/bad signature (400, no leakage), cron jobs start
cleanly (`node-cron`), Redis/Bull connects cleanly. Full regression:
`e2e-api-verification.mjs` 39/39, `concurrency-verification.mjs` 8/8 (5-way
identical-slot race, adjacent bookings, different-courts-concurrent,
repeated-attempt rejection — all through real Nginx routing). Backend: tsc
clean, eslint clean, jest 26/26 suites, 257/257 tests (255 prior + 2 new
CF-QA-S001 regression tests). Frontend: tsc clean, eslint clean, production
build succeeds.

## CF-QA-004 — Duplicate/conflicting security headers

Reproduced live: `curl -k -D - https://localhost/api/health` showed **two**
`X-Frame-Options` (`SAMEORIGIN` from Helmet's default vs `DENY` from nginx),
**two** `Referrer-Policy` (`no-referrer` vs `strict-origin-when-cross-origin`),
**two** `Content-Security-Policy`, and duplicate (same-value)
`Strict-Transport-Security`/`X-Content-Type-Options`. Root cause: nginx's
`add_header` doesn't replace a header already present from the upstream
(Helmet) response — it appends a second occurrence. Fix: added
`proxy_hide_header` for all five headers to each of the three `/api/*`
location blocks in `nginx/nginx.conf`, before nginx's own `add_header`
directives, making nginx (the only edge real clients ever reach — the API
container has no published host port) the single source of truth. Did not
touch Helmet's own config (still defense-in-depth for direct-to-API access
in other topologies) or the frontend's nonce-based CSP (untouched, verified
still single-valued). Live re-verified post-fix: every header appears
exactly once with nginx's value, on both `/api/*` and `/` (frontend)
responses; `/health` still returns 200.

## CF-QA-006 — Lint warnings

- **Backend** (`auth.controller.ts:726`, `PERMISSION_KEYS` unused-except-via-typeof):
  root-caused, not suppressed — removed the redundant `PERMISSION_KEYS`
  array entirely and derived `PermissionKey` directly from
  `keyof typeof permissionsSchema.shape` (the zod schema was always the real
  source of truth; the array was redundant). **0 errors, 0 warnings.**
- **Frontend** (`schedule/page.tsx:554`, `useVirtualizer` "Compilation Skipped"):
  investigated whether a version bump fixes it — bumped
  `@tanstack/react-virtual` to the latest available patch (3.14.13), warning
  persisted, confirming it's a genuine upstream library/React-Compiler
  incompatibility (the library returns fresh function references by design;
  no `"use no memo"` directive present anywhere in the package). Applied the
  narrowest possible suppression — a single documented
  `eslint-disable-next-line react-hooks/incompatible-library` on that exact
  hook call (the only `useVirtualizer` call site in the codebase), not a
  global compiler disable. **0 errors, 0 warnings.**

## CF-QA-S001 — Subscription court lock not tenant-scoped

Confirmed by reading `create-subscription.usecase.ts:94`: `SELECT id FROM
courts WHERE id = $1 FOR UPDATE` (no `club_id`), followed by a *separate*,
unlocked, club-scoped `SELECT` a few lines later that would catch a foreign
court and throw `ValidationError('Court not found')`. So no cross-tenant
**data** leak — but a real cross-tenant **contention/DoS** vector: Postgres
row locks are per-row, not per-query-predicate, so a courtId from another
tenant still takes a genuine row lock on that foreign court and holds it for
the rest of the transaction (occurrence-validation loop, up to 12 iterations)
before the tenant mismatch is ever noticed — capable of stalling that
tenant's own concurrent booking/subscription flow on the same court. Fixed
by merging the lock and the tenant check into one query:
`WHERE id = $1 AND club_id = $2 FOR UPDATE`, matching the pattern already
used in `create-booking.usecase.ts`. Added two regression tests to
`create-subscription.usecase.test.ts`: (1) asserts the lock query is scoped
by `club_id`, exactly one locking query is issued; (2) asserts a
foreign-club courtId is rejected without any unscoped lock ever being
issued. 10/10 tests pass in that file; 257/257 backend tests pass overall.

## CF-QA-005 — Tenant isolation / RLS — DONE (scoped rollout)

**Architecture mapped first** (tenant.middleware.ts, client.ts, courtflow_app
role from migration 018): tenant isolation was 100% application-level —
`WHERE club_id = $1` on every domain query, plus `requireClubResource()` for
parameterized routes. No RLS existed on business tables (only `audit_logs`,
via migration 018, governed by role not by club). `courtflow_app` (the
`db` pool's role) is `NOBYPASSRLS` and owns none of these tables — already
correctly positioned to be subject to RLS once policies exist.

**Design** — transaction-scoped tenant context, exactly as the task
requested ("no permanent setting on pooled connections"):
- `shared/tenant-context.ts`: an `AsyncLocalStorage`-based store, populated
  once per request by `auth.middleware.ts`'s `authenticate` (wraps `next()`
  in `runWithTenant(payload.clubId, ...)` so every downstream `await`,
  however many usecases deep, can read the current tenant).
- `database/client.ts`: `withTransaction()` now issues
  `SELECT set_config('app.current_club_id', $1, true)` (the parameterized
  equivalent of `SET LOCAL`) immediately after `BEGIN`. `db.query()` itself
  (the raw pooled Pool method, used directly at ~150 call sites across 18
  controller files, all in the same `await db.query<T>(text, params)`
  shape — verified by inspection, none use the callback/QueryConfig
  overloads) is wrapped so that when a tenant context is active, a single
  statement is transparently promoted into its own short transaction
  (`BEGIN; set_config; <query>; COMMIT`) so RLS sees it too — with zero
  changes to any of those ~150 call sites. Outside a tenant context
  (migrations, seed scripts, the unauthenticated payment webhook) this is a
  no-op passthrough — identical to pre-RLS behavior.
- `infrastructure/cron/index.ts`: each job already loops one club at a
  time (`for (const club of clubs) { ... WHERE club_id = $1 ... }`) — wrapped
  each iteration body (and `sendReminders`) in `runWithTenant(club.id, ...)`,
  a natural fit requiring no restructuring.
- Policy design — **"unset → allow"**: `current_setting('app.current_club_id',
  true) IS NULL OR ... = '' OR club_id::text = current_setting(...)`. The
  session variable is only ever set by the two paths above; every other
  caller (migration runner — superuser, bypasses RLS regardless — seed
  scripts, and the payment webhook, which must look up a booking by the
  gateway's opaque reference *before* it knows which club it belongs to)
  never sets it and behaves exactly as before. This makes the rollout
  additive for the authenticated request path (where a coding mistake
  omitting `club_id` is the highest-value target — the overwhelming
  majority of traffic) while carrying zero risk of breaking any
  unauthenticated/background flow.

**Migration 023** (`023_tenant_rls_defense_in_depth.sql`) enables `ENABLE`
+ `FORCE ROW LEVEL SECURITY` and the policy above on the 17 tables with
their own direct `club_id` column: `blocked_periods, bookings, coaches,
courts, equipment, expenses, ledger_entries, lost_found_items, payments,
report_jobs, slot_holds, subscriptions, tournaments, training_sessions,
users, waitlist_entries, working_hours`. Deliberately excludes `audit_logs`
(its own separate RLS, untouched), `clubs` (the tenant registry itself, no
club_id column), and relationship-owned tables without their own club_id
column (see "Deferred" below).

**Bug found during dry-run testing, then fixed at the source** (this is
exactly why the task's "test on disposable DB first" rule exists): the
first version of this policy cast `current_setting(...)::uuid`, guarded by
an earlier `IS NULL OR = ''` in the same OR expression. Postgres does not
guarantee left-to-right short-circuit evaluation of OR subexpressions in a
query plan (only `CASE` guarantees order) — reproduced live: after the
*first-ever* `set_config()` on a custom GUC on a pooled connection, once
that transaction ends the value reverts to `''` (not NULL, the placeholder
default for a never-session-set custom GUC), and the next query with no
active tenant context hit `''::uuid`, crashing with `invalid input syntax
for type uuid`. This surfaced as intermittent 500s on `/api/auth/register`
and `/api/auth/login` (both pre-auth, so no tenant context) whenever a
pooled connection had previously served an authenticated request.

This was initially patched with a follow-up migration 024, which worked but
left the bug live in migration 023's own file — meaning a fresh database
applying 023 in isolation would still hit the crash before 024 ever ran. A
subsequent pre-commit review flagged this (023 and 024 only produce a
correct result *together, in order* — 023 alone reproduces the crash), so
**023 was corrected in place** to use the safe comparison from the start —
`club_id::text = current_setting(...)` instead of casting the setting to
uuid (casting the column to text is always safe, correct regardless of
evaluation order) — and **migration 024 was deleted**, since its only
purpose was patching a bug that no longer exists in 023. The live
database's `schema_migrations` tracking was reconciled to match (the `024`
row removed) after independently re-verifying the live policies were
already in the correct, fixed state and unaffected by the cleanup. The
corrected 023 was re-validated the same way as before: dry-run inside a
rolled-back transaction, including deliberately reproducing the exact crash
scenario, before trusting it.

**Live verification, real cross-tenant data, both SQL and HTTP levels:**
- SQL-level (as `courtflow_app` via `SET ROLE`, not superuser): no context →
  all rows visible (permissive); club1 context → club2's real court invisible
  by direct ID lookup (0 rows) and a genuine cross-tenant `UPDATE`/`INSERT`
  blocked (`UPDATE 0`, `new row violates row-level security policy`).
- HTTP-level, two real tenants (`admin@courtflow.com` / club 1, and the
  existing `owner@cairosmash.test` / club 2 — password temporarily reset to
  a known value and restored afterward, original Argon2id hash captured and
  diff-verified byte-identical after, same reversible pattern as the prior
  session): club1 sees 7 courts / 97+ bookings; club2 correctly sees 0
  courts, 0 bookings, and only its own staff — even though club1's data
  genuinely exists in the same database. Cross-tenant resource IDs return
  404 (IDOR-safe, unchanged from before).
- Full write-path regression with RLS live: subscription creation (exercises
  the CF-QA-S001 fix + `bookings`/`payments`/`subscriptions` RLS together,
  201 + correct occurrence count), a staff cash booking + partial refund
  approval cycle (exercises `payments`/`ledger_entries` RLS — refund
  correctly transitioned `paid_in_full → partially_refunded`, one atomic
  `REFUND/DEBIT` ledger row, all under the same policy), dashboard/audit/
  analytics/financial-summary/users reads all 200.
- `e2e-api-verification.mjs`: 39/39 (rerun multiple times across this work —
  the first run against the original policy caught the uuid-cast bug live;
  reruns since, including after the fix was folded into 023 and 024 was
  deleted, all pass). `concurrency-verification.mjs`: 8/8 (after clearing
  stale fixed-date test bookings from an earlier same-day run — not an RLS
  regression, the script uses hardcoded 2097 dates and doesn't self-clean
  between runs).
- Performance: 10x `GET /bookings?limit=50` averaged ~8.5ms — the extra
  BEGIN/set_config/COMMIT round-trip per read is not perceptible at this
  app's scale.
- Data integrity sweep post-everything: 0 orphan payments, 0 orphan ledger
  entries, 0 negative totals, 0 overlapping active bookings, 0 broken
  club/court references.

**Deferred, documented, not silently dropped** — relationship-owned tables
without their own `club_id` column need an `EXISTS`-based policy shape
(materially different overhead/risk profile than the direct-column policy
above) and their own dedicated test pass. The mechanism (tenant context,
`SET LOCAL`, "unset → allow" policy shape) is now proven and reusable —
extending it to these tables is mechanical, not exploratory. The initial
version of this list (below the line) covered only 3 of the 6 tables that
actually need it — the other 3 were found during a subsequent pre-commit
review and are added here for a complete picture:

| Table | Reaches club_id via | Classified | Why |
|---|---|---|---|
| `refunds` | `payments.club_id` (also `bookings.club_id`) | NEEDS FOLLOW-UP | `requireClubResource('refunds')` joins through bookings — tested, unchanged, but no DB-enforced layer yet |
| `tournament_teams`, `tournament_matches` | `tournaments.club_id` | NEEDS FOLLOW-UP | Same pattern |
| `payment_webhook_events` | `bookings.club_id` (nullable — team-fee events use `team_id` instead) | NEEDS FOLLOW-UP | Inherently cross-tenant by design (the webhook doesn't know the club until the booking/team lookup resolves it) |
| `booking_equipment` | `bookings.club_id` | NEEDS FOLLOW-UP (currently safe) | Verified by reading `equipment.controller.ts` / `finance.controller.ts`: every query reaches it only through an already club-scoped `bookings`/`equipment` join or WHERE clause |
| `receipts` | `bookings.club_id` (also `payments.club_id`) | NEEDS FOLLOW-UP (currently safe) | Verified by reading `booking.controller.ts`'s `getReceiptHandler`: the booking is looked up `WHERE id=$1 AND club_id=$2` *before* the receipts query ever runs |
| `lost_found_claims` | `lost_found_items.club_id` | NEEDS FOLLOW-UP (currently safe) | Classified by consistency with the codebase's otherwise-uniform scoping style; not individually line-by-line re-verified the way the two rows above were |

Not classified as SECURITY RISK for any of the six — all are protected
today by the same application-level `club_id`-via-join scoping that was
already tested (`tenant-isolation.test.ts`, or by direct code reading for
the three added in this update) and unchanged by this work. Two tables
that also lack a direct `club_id` column were deliberately *not* added to
this list because they aren't tenant-owned data in the club_id sense at
all — `refresh_tokens`, `password_resets`, and `email_verifications` are
accessed exclusively by exact, unguessable secret-hash match, never listed
or enumerated by club, so there is no query shape a missing club_id filter
could ever affect. Classified **ACCEPTED RISK WITH JUSTIFICATION** for the
six tables in the table above: they simply don't yet have the second
DB-enforced layer the 17 direct-column tables now have.

## Regression evidence so far

- Backend: `tsc --noEmit` clean, `eslint .` clean (0/0), `jest` 26/26 suites,
  257/257 tests.
- Frontend: `tsc --noEmit` clean, `eslint .` clean (0/0), production build
  succeeds (37 routes).
- `e2e-api-verification.mjs`: 39/39 through real Nginx routing.
- `concurrency-verification.mjs`: 8/8 through real Nginx routing.
- Live auth flow (login/wrong-password/refresh/logout/protected-endpoint/
  revoked-token/webhook-signature) manually verified through Nginx after
  rebuilding both Docker images.
- Both Docker images (`api`, `frontend`) rebuilt and running healthy.

## Next steps

1. Map tenant-isolation architecture (middleware, DB roles, connection
   pooling) and design a minimal, transaction-safe RLS rollout for CF-QA-005.
2. Implement + migrate + live cross-tenant test (two real tenants, SELECT/
   INSERT/UPDATE/DELETE on bookings/payments/customers/subscriptions/courts).
3. Final regression pass + `COURTFLOW_PRODUCTION_REMEDIATION_REPORT.md`.
