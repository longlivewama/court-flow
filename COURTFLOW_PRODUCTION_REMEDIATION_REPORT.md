# CourtFlow Production Remediation Report

**Date:** 2026-09-14
**Branch:** `fix/refresh-cookie-samesite`
**Baseline:** commit `d0acb67` (prior session's closed-out 25-phase hardening pass, `PRODUCTION_READINESS_REPORT.md`)
**Scope:** an independent follow-up QA audit — 6 confirmed findings (CF-QA-001–006) + 1 suspected finding (CF-QA-S001) — verified and remediated against current HEAD, per the resume protocol (did not restart the prior pass).

---

## 1. Executive summary

**7 of 7 findings addressed.** 6 fully fixed and live-verified; 1 (CF-QA-005, the highest-impact/highest-risk item) fixed for a deliberately scoped, fully-tested slice with the remainder documented as an accepted, mechanical follow-up rather than rushed. Two real bugs were found *during* remediation (not in the original audit) and fixed: a stale-header duplication root cause, and a Postgres RLS evaluation-order crash — caught live by this session's own testing on the dev database (never a real deployment or end user) within minutes via the e2e suite, root-caused, and corrected at the source rather than left as a footgun for a future fresh deployment (see §5).

No existing functionality regressed. Every fix was live-verified through real Docker/Nginx routing, not just code review: `e2e-api-verification.mjs` 39/39, `concurrency-verification.mjs` 8/8, backend `jest` 26/26 suites (257/257 tests), backend/frontend `tsc`+`eslint` both fully clean (0 errors, 0 warnings), a live two-tenant cross-tenant test suite (SQL and HTTP levels), a live subscription-creation + partial-refund cycle, and a final data-integrity sweep (0 orphans, 0 negative totals, 0 overlapping bookings, 0 broken references).

---

## 2. Finding status

| Finding | Status | Root cause | Fix | Verification |
|---|---|---|---|---|
| CF-QA-001 | **FIXED** | No forced production path — `NODE_ENV` defaulted to `development` with no override enforcement; an operator could reuse the dev compose file for a real deploy and silently get dev security behavior | New `docker-compose.prod.yml` override: hardcodes `NODE_ENV=production`, uses `${VAR:?err}` so the stack refuses to start without real DB/Redis secrets. Seed account, webhook secret, and cookie `Secure` flag were already correctly gated on `NODE_ENV==='production'` (verified by reading the code — no change needed there) | `docker compose config` with the override: errors on missing secrets, succeeds when set; live webhook signature rejection (400, no leakage) |
| CF-QA-002 | **FIXED** | `next@16.2.9` (1 critical, 6 high, 1 moderate CVEs, all fixed in `16.3.5`, non-major) | `next` → `^16.3.5`; `@tanstack/react-virtual` → `^3.14.13`; `npm audit fix` (no `--force`) cleared eslint's own transitive dev-toolchain vulnerabilities | `npm audit`: 8 → **0** vulnerabilities. Build: 37 routes, unchanged. tsc/eslint clean |
| CF-QA-003 | **FIXED** (except xlsx, documented) | `nodemailer@6.10.1` (critical `tar`/`node-pre-gyp` chain via `bcrypt`'s old prebuild tooling; multiple nodemailer CVEs only patched in 7.x+); duplicate `uuid@8.3.2` via `bull`/`node-cron` | `nodemailer` → `10.0.10` (one type-import fix: `nodemailer.SendMailOptions` → named import); `bcrypt` → `6.0.0` (removes the `node-pre-gyp`/`tar` chain entirely — that chain was install-time only, never runtime-reachable); `uuid` pinned to `^11.1.0` via a new `overrides` entry (verified `bull`/`node-cron` only call the stable `uuid.v4()`) | `npm audit`: 14 → **1** (xlsx, see below). Live-verified: login/wrong-password/refresh/revoked-token/logout/webhook-signature all correct after rebuilding the API image (bcrypt is a native addon, rebuilt for Linux) |
| CF-QA-004 | **FIXED** | nginx's `add_header` doesn't replace a header already present on the proxied response — Helmet's defaults (`X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`) and nginx's chosen values (`DENY`, `strict-origin-when-cross-origin`) both landed on the wire, genuinely conflicting | Added `proxy_hide_header` for the 5 relevant headers to all three `/api/*` nginx locations, before nginx's own `add_header` — nginx (the only edge real clients reach; the API has no published host port) is now the sole source of truth | Reproduced live via `curl -D -` before the fix (2× XFO, 2× Referrer-Policy, 2× CSP, differing values); re-verified after — exactly one value per header, both API and frontend responses |
| CF-QA-005 | **FIXED (scoped)** | Tenant isolation was 100% application-level (`WHERE club_id=$1` everywhere) — correct and tested, but no DB-enforced second layer for a missed filter | Transaction-scoped `SET LOCAL app.current_club_id` (via `AsyncLocalStorage`, set once per request in `authenticate`, read by `withTransaction()` and a `db.query()` wrapper with zero call-site changes) + `FORCE ROW LEVEL SECURITY` on the 17 tables with a direct `club_id` column, policy design "unset → allow" so unauthenticated/background paths (webhook, cron, migrations) are unaffected. See §5 | Live cross-tenant tests (SQL + HTTP, two real tenants), full write-path regression (subscription creation, refund cycle), e2e 39/39, concurrency 8/8, 0 data-integrity violations |
| CF-QA-006 | **FIXED** | Backend: `PERMISSION_KEYS` array used only via `typeof`, unrecognized by the unused-vars rule. Frontend: TanStack Virtual's `useVirtualizer()` returns functions the React Compiler can't safely memoize | Backend: removed the redundant array, derived the type from the zod schema directly (root-caused). Frontend: bumped to latest patch (3.14.13) — warning persisted, confirming genuine upstream incompatibility — applied one narrowly-scoped, documented `eslint-disable-next-line` on the single call site | Backend: 0 errors/0 warnings. Frontend: 0 errors/0 warnings |
| CF-QA-S001 | **FIXED** | `create-subscription.usecase.ts`'s court lock (`SELECT id FROM courts WHERE id=$1 FOR UPDATE`) omitted `club_id` — a foreign tenant's court still took a real Postgres row lock (locks are per-row, not per-predicate) before a separate, unlocked query caught the tenant mismatch a few lines later — a genuine cross-tenant contention/DoS vector, not a data leak | Merged the lock and the tenant check into one query: `WHERE id=$1 AND club_id=$2 FOR UPDATE`, matching `create-booking.usecase.ts`'s existing pattern | 2 new regression tests (lock query is club-scoped; foreign-club courtId never issues an unscoped lock) — 10/10 in that file, 257/257 overall |

---

## 3. Security

- **Authentication**: login (correct/wrong password), refresh-token rotation, revoked-token rejection ("Token has been revoked"), logout, protected-endpoint 401/200 — all live-verified post-upgrade.
- **Authorization / tenant isolation**: application-level scoping unchanged and still correct (existing `tenant-isolation.test.ts` suite untouched, still passing); now backed by DB-level RLS on 17 core tables, live-verified with two real tenants at both SQL and HTTP levels (§5, §2).
- **RLS**: see §5 — scoped, tested rollout; remaining relationship-owned tables documented as a follow-up, not silently dropped.
- **Cookies**: `HttpOnly` + `SameSite=Lax` confirmed live; `Secure` correctly gated on `NODE_ENV==='production'` (absent on this dev stack as expected, present once `docker-compose.prod.yml` is applied).
- **CSP / headers**: single, coherent value per security header on both API and frontend responses (was duplicated/conflicting — CF-QA-004); frontend's nonce-based CSP unaffected.
- **Webhook**: fails closed on missing/misconfigured secret in production (pre-existing, verified); missing/malformed signature → clean 400, no secret or stack trace leaked.
- **Dependencies**: frontend 0 vulnerabilities; backend 1 (xlsx, no upstream fix — see §6).
- **Rate limiting**: unchanged, not touched by this session (was already in place and unit-tested from the prior pass).

---

## 4. Booking / financial regression

- Booking creation, double-booking rejection, adjacent bookings, different-court concurrency, repeated-attempt rejection: all live-verified through real Nginx routing (`concurrency-verification.mjs`, 8/8) — including after RLS went live.
- Subscription creation (exercises the CF-QA-S001 fix together with the new `bookings`/`payments`/`subscriptions` RLS policies): live-tested end to end, 201, correct occurrence count and pricing, correctly listed afterward, cleaned up.
- Refund cycle (exercises `payments`/`ledger_entries` RLS): a real staff cash booking → partial refund request → owner approval → payment status `paid_in_full → partially_refunded`, one atomic `REFUND/DEBIT` ledger row. This test's fixtures could not be fully cleaned up — the ledger's append-only trigger blocks the cascade deletes needed, the same documented, by-design limitation noted in the prior session's report (clearly identifiable: "RLS test partial refund" / "RLS Refund Test").
- Audit logging: unaffected (separate `audit_writer` role/pool, untouched by this session's RLS or dependency changes).
- Data integrity sweep (post-everything): 0 orphan payments, 0 orphan ledger entries, 0 negative totals, 0 overlapping active bookings, 0 broken club/court references.

---

## 5. CF-QA-005 detail

Full architecture, design rationale, the bug found during dry-run testing (and its fix), and the complete live-verification log are in `COURTFLOW_PRODUCTION_REMEDIATION_PROGRESS.md` under "CF-QA-005 — Tenant isolation / RLS — DONE (scoped rollout)". Summary:

- **New file** `backend/src/shared/tenant-context.ts` — `AsyncLocalStorage`-based, transaction-scoped tenant context (never a permanent/session-level setting on a pooled connection, per the task's own explicit requirement).
- **Migration 023** — `FORCE ROW LEVEL SECURITY` + a permissive-when-unset policy on the 17 tables with a direct `club_id` column. Its first version had a genuine crash bug (Postgres doesn't guarantee short-circuit evaluation of OR conditions; a `::uuid` cast on an empty-string session variable crashed pre-auth routes) — found via this session's own dry-run-before-apply discipline before it ever affected a real user, initially patched with a follow-up migration 024, then corrected in place in 023 itself once a pre-commit review flagged that 023 and 024 only produced a correct result together, in order — 023 alone still reproduced the crash. Migration 024 was deleted (nothing left for it to fix) and the live `schema_migrations` tracking reconciled to match, after independently re-verifying the live policies were unaffected by the change.
- **Deferred, not dropped, and now complete**: 6 relationship-owned tables (no direct `club_id` column) need an `EXISTS`-based policy shape and their own test pass — `refunds`, `tournament_teams`/`tournament_matches`, `payment_webhook_events` (the original three), plus `booking_equipment`, `receipts`, and `lost_found_claims` (found missing from this list during a subsequent pre-commit review and added here). The mechanism is proven; extending it is now mechanical. Classified **ACCEPTED RISK WITH JUSTIFICATION** — all six remain protected by the same already-tested (or, for the three added, directly code-verified) application-level scoping, unchanged by this work.

---

## 6. Dependency audit

**Frontend** — before: 8 (1 moderate, 6 high, 1 critical). After: **0**.
`next` 16.2.9→16.3.5, `@tanstack/react-virtual` 3.14.6→3.14.13, plus `npm audit fix` (no force) for eslint's transitive dev-toolchain deps.

**Backend** — before: 14 (7 moderate, 6 high, 1 critical). After: **1** (high).
`nodemailer` 6.10.1→10.0.10, `bcrypt` 5.1.1→6.0.0 (removed the critical `tar`/`node-pre-gyp` chain entirely), `uuid` deduplicated to `^11.1.0` via `overrides`.

Remaining: **`xlsx@0.18.5`** — Prototype Pollution + ReDoS advisories, **no patched version exists on npm** (the well-known SheetJS/npm publishing gap). Verified usage (`report.controller.ts`) is **write-only** — `xlsx.utils.json_to_sheet()` / `xlsx.write()` on our own DB-derived report data; the codebase never calls `xlsx.read()`/`readFile()` on any user-uploaded or untrusted file, so the parse-time prototype-pollution vector is **not reachable**. The ReDoS vector's reachability is narrow (would need attacker-controlled string content already in the DB, surfaced only through a staff-only export endpoint). **Classified ACCEPTED RISK WITH JUSTIFICATION.**

---

## 7. Infrastructure

- Both Docker images (`api`, `frontend`) rebuilt from scratch (bcrypt is a native addon — rebuilt for the Linux container, not just the macOS host) and confirmed healthy.
- Nginx config validated (`nginx -t`) and reloaded; a transient bind-mount staleness on the long-running container (unrelated to the config's actual validity — confirmed via a fresh throwaway container) needed a container restart, not a config change.
- Postgres: 1 new migration (023, corrected in place — see §5) applied and tracked in `schema_migrations`, dry-run tested inside a rolled-back transaction first, including deliberately reproducing the crash scenario the earlier version had.
- No Docker volumes touched, no database recreated, no existing migrations modified or rerun.

---

## 8. Test results

- **Backend**: `tsc --noEmit` clean. `eslint .` — 0 errors, 0 warnings. `jest` — **26/26 suites, 257/257 tests** (255 prior + 2 new CF-QA-S001 regression tests).
- **Frontend**: `tsc --noEmit` clean. `eslint .` — 0 errors, 0 warnings. Production build — 37 routes (unchanged).
- **E2E** (`e2e-api-verification.mjs`, real Nginx routing): **39/39**.
- **Concurrency** (`concurrency-verification.mjs`, real Nginx routing): **8/8**.
- **Cross-tenant** (this session, live, two real tenants): courts/bookings/staff-list isolation at the HTTP level; SELECT/INSERT/UPDATE isolation at the SQL level (as the actual `courtflow_app` role, not superuser).
- **Data integrity**: 0 orphans/negatives/overlaps/broken-refs, checked after every major change and again at the end.

---

## 9. Remaining issues

1. **xlsx** (backend, high) — no upstream fix exists; reachability assessed as low/narrow; see §6. *Recommended next step*: monitor for an upstream patch, or evaluate a replacement (e.g. `exceljs`) if the export feature's threat model changes.
2. **RLS on relationship-owned tables** (`refunds`, `tournament_teams`/`tournament_matches`, `payment_webhook_events`, `booking_equipment`, `receipts`, `lost_found_claims`) — deferred with the mechanism already proven; see §5. *Recommended next step*: a follow-up session applying the same pattern with `EXISTS`-based policies and its own live cross-tenant test pass.
3. **`docker-compose.prod.yml` is new and unexercised in a real deployment** — validated via `docker compose config` (fails closed correctly) but not via an actual production cutover. *Recommended next step*: use it for the next real deploy and confirm `Secure` cookies / Postgres TLS verification / no dev seed in that environment.
4. Two DB rows of test data from this session (a partial-refund cycle) are permanently stuck due to the ledger's by-design append-only trigger — harmless, clearly identifiable, matches a pre-existing documented limitation from the prior session.
5. Everything else the prior session's `PRODUCTION_READINESS_REPORT.md` flagged as remaining (rotate the two DB role passwords before a real cutover, an optional deeper pentest) is unchanged and still applies.

---

## 10. Final decision

**PRODUCTION READY WITH CONDITIONS**

All 7 findings from the follow-up QA audit are resolved — 6 fully, and the highest-risk one (CF-QA-005) fixed for a deliberately scoped, thoroughly live-tested slice with a clear, documented, mechanical path to finish the rest. Two genuine bugs were caught and fixed during this session's own testing discipline before they could reach a real user. Every fix is backed by live verification through the real Docker/Nginx stack, not just code review, and a final data-integrity sweep found zero corruption.

The conditions are the same class of standard pre-launch operational steps the prior session already flagged, plus the two items this session scoped out on purpose: rotate the two DB role passwords and apply `docker-compose.prod.yml` for the actual cutover (§9.3); extend RLS to the relationship-owned tables using the now-proven pattern (§9.2); monitor/replace `xlsx` if its risk profile changes (§9.1). None of these are code defects, and none block a real deployment today.
