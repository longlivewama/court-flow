# CourtFlow Production Hardening — Final Report

**Date:** 2026-09-14
**Branch:** `fix/refresh-cookie-samesite` (uncommitted)
**Session type:** Resume of a prior same-day 17-phase hardening pass + this session's live-verification, DB migration, ESLint, and bug-fix pass.

---

## 1. Overall status

**PRODUCTION READY: NO**

Not because of unresolved critical bugs — every critical/high bug found (this session and the prior one) is fixed and live-verified — but because of process gaps that are prerequisites for a real production cutover: nothing is committed to git, DB role passwords are still dev placeholders, and a few categories of testing (live concurrency, live reminder-cron cycle, exhaustive security re-attack) were not exercised against the real stack this session. See §7.

---

## 2. Executive summary

This session resumed a prior same-day 17-phase hardening pass (found via memory, not restarted from scratch) and discovered its most important claim was untested: **the original critical booking bug — `POST /api/bookings` failing with `permission denied for table audit_logs` — was still live and broken**, despite an earlier, unrelated security-audit session having built the `courtflow_app`/`audit_writer` role-separation architecture that caused it. Root-caused it live via a real booking attempt through Nginx, designed and shipped an architecture-preserving fix (`SET LOCAL ROLE audit_writer` scoped to just the audit INSERT, via a new non-inheriting role grant), and verified it end-to-end against the real Docker/Postgres stack with real least-privilege roles — this is now fixed.

From there: applied all four pending migrations (019-022) to the live Postgres volume with pre-flight safety checks, live-verified password reset / settings / court validation / refund-ledger consistency / DB overlap-exclusion through real Nginx-routed HTTP calls, brought backend ESLint to 0 errors and frontend ESLint from 36 errors down to 0 (root-caused, not suppressed — see §4), fixed the e2e verification script's hardcoded localhost URL and ran it live (39/39 checks passing through Nginx), found and fixed one new bug during live browser testing (dashboard/calendar pagination limit), ran a live security spot-check (SQLi/XSS/invalid-UUID), and confirmed the live database has zero orphans/negative-totals/overlaps/broken-FKs.

**Financial consistency:** verified live — a real partial refund correctly and atomically updated payment status, `refunded_amount`, and produced exactly one `REFUND`/`DEBIT` ledger entry.
**Security:** unchanged/intact — no control was weakened; the audit-log fix specifically avoided the two tempting shortcuts (broad `courtflow_app` grant, weakened RLS) in favor of a scoped, explicit elevation mechanism.
**Original booking blocker:** resolved and verified live.

---

## 3. Phase results

| Phase | Status | Evidence |
|---|---|---|
| 1. Booking audit log permission | ✅ VERIFIED (was still broken, now fixed) | Live-reproduced then fixed; see §4 |
| 2. Password reset | ✅ VERIFIED live | Full flow through Nginx incl. rate limiting, enumeration resistance, hash-at-rest, single-use |
| 3. Settings DTO contract | ✅ VERIFIED live | GET→PATCH→GET round-trip via Nginx |
| 4. Court NaN validation | ✅ VERIFIED live + found/fixed a new bug | Duplicate court number was an unhandled 500; now 409 |
| 5. DB overlap exclusion | ✅ VERIFIED live, migration applied | Real insert tests against the live volume |
| 6. Refund/ledger consistency | ✅ VERIFIED live, migration applied | Full refund lifecycle through Nginx |
| 7. Reminder cron idempotency | ⚠️ Migrated + unit-tested; not live-cycle-tested | Needs a real cron tick or backdated booking to observe |
| 8. Overnight availability | ✅ Unit-tested (prior session) | Not independently re-tested live this session |
| 9. Backend ESLint | ✅ VERIFIED — 0 errors, 1 justified warning | |
| 10. Frontend ESLint | ✅ VERIFIED — 0 errors, 1 justified warning | 36 errors fixed, root-caused (see §4) |
| 11. E2E script hardcoded URL | ✅ VERIFIED — 39/39 live through Nginx | |
| 12-17. Integration via Docker/Nginx | ✅ Substantially covered by the e2e script + manual live passes | 5-way concurrency and live reminder-cron not exercised |
| 18. Security regression | ✅ Targeted, not exhaustive | SQLi/XSS/invalid-UUID/rate-limit live; IDOR/tenant-isolation via existing unit suites |
| 19. Data integrity | ✅ VERIFIED | Zero orphans/negatives/overlaps/broken-FKs, live query |
| 20. Performance/query review | ⚠️ Design-level only (prior session) | No live EXPLAIN this session |
| 21. Frontend booking UX | ⚠️ Partially verified live | Happy paths clicked through; error/timeout paths not |
| 22. Test coverage | ✅ DONE | 26/26 suites, 255/255 backend tests |
| 23. Full build/deploy verification | ✅ VERIFIED | tsc/lint/jest/build all clean, both sides |
| 24. Final live smoke test | ✅ VERIFIED | e2e script + manual browser pass |
| 25. Final report | ✅ this document | |

---

## 4. Bugs fixed this session

### BUG 1 (critical): `POST /api/bookings` → 500 `permission denied for table audit_logs`
**Root cause:** `auditLogStrict()` runs on the caller's transaction client, which (since an earlier, separate security-audit session's migration 018) authenticates as `courtflow_app` — a role with INSERT deliberately revoked on `audit_logs` (only `audit_writer` may write, enforced under `FORCE ROW LEVEL SECURITY`). `auditLogStrict` needs to commit atomically with the booking, so it can't just use the separate `audit_writer` connection pool (a different physical connection can't join another connection's open transaction).
**Fix:** New migration `022_audit_writer_scoped_membership.sql` grants `courtflow_app` **non-inheriting** membership in `audit_writer` (`GRANT audit_writer TO courtflow_app WITH INHERIT FALSE`) — membership without inheritance means `courtflow_app` gains the *ability* to explicitly `SET ROLE audit_writer` for one statement, without ambiently holding that privilege on every other query. `audit.service.ts`'s `auditLogStrict` now does `SET LOCAL ROLE audit_writer` → INSERT → `RESET ROLE` (best-effort in a `finally`) around just the audit write.
**Verification:** Live-reproduced the exact 500 via a real `POST /api/bookings` through Nginx before the fix. After migrating + rebuilding the API container: real booking → 201, audit row present, payment record consistent. Confirmed live that `courtflow_app` still cannot `INSERT` into `audit_logs` without the explicit `SET ROLE` (tested both paths against the real roles). New unit test `audit-service-role-elevation.test.ts` (3 tests) locks the exact statement sequence.
**Result:** FIXED + VERIFIED.

### BUG 2 (medium): Duplicate court number → unhandled 500
**Root cause:** `createCourt`/`updateCourt` never caught the `courts_club_id_number_key` unique-constraint violation (Postgres `23505`); it surfaced as a raw, opaque 500.
**Fix:** Translated `23505` → `ConflictError` (409) in both handlers, mirroring the pattern already used for booking-slot conflicts.
**Verification:** Live-reproduced (real duplicate-number POST → 500), fixed, rebuilt, re-verified (→ 409 with a clear message). New test in `court-creation-validation.test.ts`.
**Result:** FIXED + VERIFIED.

### BUG 3 (medium): Dashboard/calendar → visible error "limit must not exceed 200"
**Root cause:** An earlier session's pagination-hardening work (`parsePagination`) capped `listBookings`'s `maxLimit` at 200, but the dashboard's 14-day trend chart and the calendar's 7-day week view both legitimately request `limit=500` — a busy club can exceed 200 bookings across that range. Found live, in a real browser, after logging in as the dev owner.
**Fix:** Raised `listBookings`'s `maxLimit` to 500 specifically (both callers are staff-only internal views, not a public pagination surface).
**Verification:** Rebuilt API container, reloaded both pages live — no error, correct data.
**Result:** FIXED + VERIFIED.

### Original QA item: duplicate `no_show`/`expired` booking pair
**Classification:** Not a double-booking bug. Both statuses are excluded from the "active/blocking" set by the booking state machine and by the new exclusion constraint's own predicate — two historical bookings for the same slot that each independently ended up in a terminal, non-blocking state is legitimate data, not corruption.
**Action:** Documented, not repaired (no repair needed).

### ESLint (frontend): 36 errors across 23 files, root-caused not suppressed
All were one of four patterns, each fixed at the root:
- **`react-hooks/set-state-in-effect`** (majority): async data-fetch functions rewritten as `.then/.catch/.finally` chains (avoids the lint's inability to see past `await`); "reset state when a prop changes" effects converted to React's own documented render-time-adjustment pattern (compare-to-previous-render, `setState` called directly during render, not in an effect) since these panels stay mounted between opens (their close animation needs it) so a key-based remount wasn't available.
- **`react-hooks/purity`** (`Date.now()` in render): moved to lazy `useState` initializers refreshed from event handlers or promise callbacks; one `URL.createObjectURL` case moved to `useMemo` + a cleanup-only effect (removing the state+effect pair entirely); one case (`handleSubmit`, confirmed only ever invoked via `onSubmit`, never during render) is a linter false-positive — justified with a single, clearly-commented, scoped `eslint-disable-next-line`.
- **`@typescript-eslint/no-explicit-any`** (5 instances): typed via `AxiosError<T>` instead of `any`.
- **Unused imports/vars**: removed, including a fully dead 161-line `CustomerPicker` component with its own interface that was never rendered anywhere.
- Two "detect hydration" effects (`AppShell`, `NavAuthActions`) replaced with `useSyncExternalStore`, React's purpose-built primitive for exactly this case.

All fixes were **live-verified in a real browser** (not just typecheck/build): login, dashboard, calendar (New Booking panel open/close/reset, Command Menu search/filter), admin/courts, admin/lost-found, bookings list, booking detail page — zero console errors.

---

## 5. Database changes

**Migrations applied to the live volume this session:** `019_payment_refund_sync.sql`, `020_reminder_idempotency.sql`, `021_booking_overlap_exclusion.sql` (all written by the prior session, never previously applied), and `022_audit_writer_scoped_membership.sql` (new this session, the audit-log fix).

**Pre-flight safety:** Ran 021's own documented pre-flight overlap query against the live volume first (0 rows — safe). Backfilled a `schema_migrations` tracking table with all 22 filenames so future `npm run migrate` runs are safe no-ops (the live volume had never used that tracking mechanism — migrations 001-018 were applied via Docker's `docker-entrypoint-initdb.d` mount on first boot).

**Constraints/roles verified live:**
- `payments.refunded_amount` (numeric, CHECK ≥ 0) — present, exercised by a real refund.
- `bookings.reminder_24h_sent_at`/`reminder_2h_sent_at` — present.
- `bookings_no_overlap_per_court` EXCLUDE USING gist constraint — present, live-tested (rejects overlap, accepts adjacent/cancelled).
- `btree_gist` extension — installed.
- `courtflow_app` non-inheriting membership in `audit_writer` — present, live-tested both the elevation path and the "still denied without it" path.

**No data repairs performed** — the one QA-flagged "duplicate" pair was classified as non-blocking, not corrupted.

---

## 6. Tests executed

- **Backend unit/integration (Jest):** 26 suites, 255 tests, all passing. (251 inherited from the prior session + 3 new `audit-service-role-elevation.test.ts` + 1 new duplicate-court-number case.)
- **Backend typecheck:** clean.
- **Backend lint:** 0 errors, 1 justified warning.
- **Frontend typecheck:** clean.
- **Frontend lint:** 0 errors, 1 justified warning (down from 36 errors/10 warnings).
- **Frontend build:** succeeds, 37 routes.
- **E2E API script** (`npm run test:e2e`, fixed to route through Nginx): **39/39 checks passed** — auth, availability grid (PII-safe), booking creation, conflict detection, receipt upload (8 negative cases), staff verification/approval, check-in, cash auto-confirm, financial summary.
- **Live manual verification through real Nginx/Docker/Postgres** (curl + real browser): booking creation (the critical fix), password reset full lifecycle, settings round-trip, court validation (6 malformed-input cases + duplicate-number), refund/ledger full lifecycle, DB exclusion constraint (3 real-insert scenarios), SQL injection, XSS, invalid UUID, rate limiting.
- **Data integrity queries** against the live DB: 0 orphan payments/refunds/ledger-entries, 0 negative totals, 0 overlapping active bookings, 0 broken FKs.
- **Docker/Nginx:** all 5 services healthy; HTTP→HTTPS 301 redirect confirmed; `/health` 200 via HTTPS; backend port not published externally (by design).

---

## 7. Remaining issues

**Issue: Nothing is committed to git.**
Severity: Process blocker, not a code defect.
Why unresolved: Out of scope for this task unless requested — commits should be a deliberate, reviewed action.
Impact: All of this session's and the prior session's work (48+ files) exists only in the working tree.
Next action: Review the diff, then commit in logical groups (or ask for a single commit) before any deployment.

**Issue: DB role passwords are dev placeholders.**
Severity: High (for production only — not a risk in this dev/QA environment).
Why unresolved: Rotating a shared secret requires coordinated action (env var + container restart) that's a deployment-time decision, not a code fix.
Impact: `courtflow_app`/`audit_writer` still use the migration's well-known default password.
Next action: Set `COURTFLOW_APP_DB_PASSWORD` (and the audit_writer equivalent) to real secrets before any real deployment; the rotation scripts already exist (`zz_set_*_password.sh`).

**Issue: Reminder cron idempotency not live-cycle-tested.**
Severity: Medium.
Why unresolved: Requires either waiting for a real 24h/2h reminder window or manually backdating a booking — not attempted this session given time constraints.
Impact: The fix is unit-tested and the migration is live, but no observed real cron tick this session.
Next action: Create a booking with a start time ~24h out, wait for (or manually trigger) the cron, confirm exactly one reminder log line and `reminder_24h_sent_at` populated.

**Issue: No live concurrency test (2-way/5-way simultaneous booking).**
Severity: Medium.
Why unresolved: Requires firing genuinely simultaneous requests (not sequential curl calls) — needs a small script, not attempted this session.
Impact: The app-level `FOR UPDATE` lock and the DB exclusion constraint are both individually verified; their behavior under real concurrent load is unverified.
Next action: Write a small concurrent-fetch script (5 parallel `POST /api/bookings` at the identical slot) and confirm exactly one 201 + four clean 409s, no 500s.

**Issue: Security regression was targeted, not exhaustive.**
Severity: Low (given the existing unit-test coverage for IDOR/tenant-isolation/RBAC).
Why unresolved: This dev DB's non-default tenants have no courts of their own, limiting live cross-tenant attack surface; a full re-attack of every endpoint in the original 25-phase task's list wasn't attempted given time constraints.
Impact: SQLi/XSS/invalid-UUID/rate-limiting are live-verified; deeper IDOR/tenant-isolation coverage rests on the existing (already-passing) unit-test suite rather than a fresh live attack.
Next action: If a second fully-populated tenant is seeded, re-run the original QA's cross-tenant attack list live.

**Issue: One booking's test data is permanently stuck in the dev DB.**
Severity: Cosmetic.
Why unresolved: The ledger's append-only trigger blocks the FK-cascade deletes needed to remove a booking once it has a ledger entry — by design, and confirmed working correctly even against a superuser cleanup attempt.
Impact: One clearly-identifiable test booking/payment/refund/ledger-entry/receptionist-account (customer "Refund Test", phone 01077778888, slot 2099-07-15) remains in the dev DB.
Next action: None required — this is expected behavior of an append-only ledger, not a bug.

---

## 8. Final recommendation

The code itself is in materially better shape than at session start: the original critical booking-creation blocker is genuinely fixed (not just claimed fixed) and verified against the real production-routed stack with real least-privilege database roles, financial consistency (refunds/ledger) is verified atomic, both ESLint surfaces are clean, and a live data-integrity sweep found zero corruption. CourtFlow can move toward production, but not today: get this branch committed and reviewed, rotate the two placeholder DB passwords, and close the concurrency/reminder-cron live-testing gaps above before a real cutover. None of the remaining gaps are evidence of a broken feature — they're testing coverage this session didn't have time to reach, not known defects.
