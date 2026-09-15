# CourtFlow — Resumed 9-Bug Remediation Report

**Date:** 2026-09-15
**Branch:** `fix/refresh-cookie-samesite`
**Baseline / starting HEAD:** `594825a` (unchanged — nothing committed this session)
**Trigger:** terminal restart interrupted an in-progress QA remediation session; this session recovered and completed it per the resume protocol rather than restarting.

---

## 1. Recovery

No progress/checkpoint doc existed for this specific pass (it was interrupted before one was written), so state was reconstructed entirely from repository evidence:

- `git status`/`git diff` showed 13 modified + 3 untracked migrations + 8 untracked test files, all uncommitted, sitting on top of an already-committed, unrelated prior pass (`COURTFLOW_PRODUCTION_REMEDIATION_REPORT.md`, findings `CF-QA-001..006`/`CF-QA-S001`, committed in `594825a`).
- Every uncommitted test file and the three new migrations tag themselves with a **different** numbering scheme — `CF-QA-01`..`CF-QA-09` (two digits, no dash-prefix collision with the committed `CF-QA-001` series) — which maps 1:1 onto the resume protocol's 9-bug list. This confirmed the in-flight work was a second, later QA pass, not a duplicate of the committed one.
- `schema_migrations` on the live `courtflow_postgres` volume already had migrations `024`, `025`, `026` applied (timestamps 15:38–17:52 on 2026-09-15).
- `courtflow_api`'s running container was created at 17:58:17 — **after** all three migrations — and its compiled `dist/` already contained the CF-QA fix code (grepped directly inside the container). So the prior session had already rebuilt and redeployed before the restart; nothing needed rebuilding.

**Conclusion:** all 9 bugs were already **IMPLEMENTED** (code + migrations + unit tests written) and the migrations were already **live-applied**, but no verification pass or checkpoint doc had been produced yet — status was IMPLEMENTED BUT NOT VERIFIED across the board. This session's job was entirely verification, not implementation.

## 2. Bug matrix

| # | Finding | Code | Migration | Unit test | Live HTTP/DB proof | Final |
|---|---|---|---|---|---|---|
| 1 | CF-QA-01 — Audit log SELECT silently blocked by an overreaching `RESTRICTIVE FOR ALL` policy | `audit.controller.ts` unaffected (fix is pure RLS) | `024_fix_audit_log_select_rls.sql` (applied) | `audit-log-rls-read-access.test.ts` incl. disposable-DB role proof (ran with `RUN_LIVE_DB_TESTS=1`, 4/4) | `GET /api/audit` returns real rows for club 1 owner; cairo-smash owner sees only its own 41 rows (`club_id` never club 1's); no-token → 401 | **VERIFIED** |
| 2 | CF-QA-02 — Owner couldn't create refund requests; audit log hardcoded `userRole:'receptionist'` | `refund.controller.ts`, `routes.ts` (`requireRole('owner','receptionist')`), new refund UI in `BookingDetailsPanel.tsx` | — | `refund-owner-authorization.test.ts` | Live: owner created + self-approved a real $50 refund on a $100 cash booking → `payments.status` `paid_in_full→partially_refunded`, `refunded_amount=50.00`, audit row recorded `user_role:"owner"` (not the old hardcoded value) | **VERIFIED** |
| 3 | CF-QA-03 — Cancellation-triggered refund never wrote `payments.refunded_amount` | `cancel-booking.usecase.ts` | — | `cancel-booking.usecase.test.ts` | Live: cancelled a fresh $300 cash booking → `payments.status='fully_refunded'`, `refunded_amount=300.00`. Confirmed the bug was real: 3 pre-existing rows cancelled *before* today's 17:58 rebuild still show `refunded_amount=0` (historical, not a live regression — see §4) | **VERIFIED** |
| 4 | CF-QA-04 — Coach could be double-booked (no overlap check independent of court) | `coaching.controller.ts` (`FOR UPDATE` lock + overlap query) | — | `coaching-session-coach-overlap.test.ts` | Live: created a real session for coach Nour Hassan, then an overlapping one → clean `409 CONFLICT` | **VERIFIED** |
| 5 | CF-QA-05 — Deactivated court's number permanently unusable; no reactivation path existed | `court.controller.ts` (`isActive` field, `?all=1` list), `admin/courts/page.tsx` (UI) | `025_court_number_active_only_unique.sql` (applied) | `court-reactivation.test.ts` | Live: created a throwaway court → deactivated (hidden from default list) → reactivated (`is_active:true`) → cleaned up | **VERIFIED** |
| 6 | CF-QA-06 — `FRONTEND_URL` dev default unreachable even in dev; no production enforcement | `docker-compose.prod.yml`, `backend/.env.example` | — | (infra-only, no unit test) | `docker compose -f ... -f docker-compose.prod.yml config` with the var unset → refuses with `FRONTEND_URL must be set to the real public origin for production` | **VERIFIED** |
| 7 | CF-QA-07 — Malformed JSON body surfaced as a generic 500 | `error.middleware.ts` (`SyntaxError`/`entity.parse.failed` branch) | — | `error-middleware-malformed-json.test.ts` | Live: `POST /api/auth/login` with truncated JSON → clean `400`, not 500 | **VERIFIED** |
| 8 | CF-QA-08 — Non-UUID `courtId`/`customerId`/`equipmentId` hit Postgres raw (`22P02`) → 500 | `booking.controller.ts` (`.uuid()` on all FK fields) | — | `booking-creation-uuid-validation.test.ts` | Live: `POST /api/bookings` with `courtId:"not-a-uuid"` → clean `400 VALIDATION_ERROR` | **VERIFIED** |
| 9 | CF-QA-09 — Same customer could join the identical waitlist window unlimited times | `waitlist.controller.ts` (23505→`ConflictError`) | `026_waitlist_no_duplicate_active_entries.sql` (applied) | `waitlist-duplicate-join.test.ts` | Live SQL: two identical inserts inside one transaction → second correctly rejected with `duplicate key value violates unique constraint "idx_waitlist_no_duplicate_active"` (HTTP-level check blocked only by the customer-only role restriction, which is correct, expected behavior, not a gap) | **VERIFIED** |

All 9 — **VERIFIED**.

## 3. Regression

- **Backend:** `tsc --noEmit` clean. `eslint .` clean (0 errors/warnings). `jest` — **33/33 suites, 299/300 tests** (1 intentionally `test.skip`'d unless `RUN_LIVE_DB_TESTS=1`, which was separately run and passed 4/4).
- **Frontend:** `tsc --noEmit` clean. `eslint .` clean. Production build — 37 routes, unchanged.
- **Live stack:** all 5 containers (`postgres`, `redis`, `api`, `frontend`, `nginx`) healthy; `/health` and `/api/health` both 200 through real Nginx routing.
- **Database integrity sweep:** 0 orphan bookings/payments/refunds/ledger entries, 0 duplicate active court numbers, 0 duplicate active waitlist entries, 0 overlapping active coach sessions.

## 4. Database

- `schema_migrations` current head: `026_waitlist_no_duplicate_active_entries.sql` (all of 001–026 applied, tracked).
- 3 migrations applied this cycle (already live before this session started, reconfirmed): `024`, `025`, `026`.
- **One historical data note, not a live bug:** 5 `payments` rows have `status IN ('fully_refunded','partially_refunded')` with `refunded_amount=0` — 2 from 2026-07-24 (long predate this fix) and 3 from 2026-09-15 13:32–13:55 (cancelled *before* the 17:58 API rebuild that shipped the CF-QA-03 fix). This is expected: the fix is forward-only and was never asked to backfill history. Left untouched per the "don't delete/alter suspicious records automatically" rule — flagged here as a genuine remaining item if the business wants historical reporting corrected.

## 5. Remaining risks

1. **Historical `refunded_amount=0` rows** (§4) — cosmetic/reporting only, pre-dates this fix, no live financial impact (payment `status` itself was always correct).
2. **`xlsx@0.18.5`** — carried over from the prior committed session, no upstream fix, low reachability (write-only usage). Unrelated to this 9-bug pass.
3. **RLS on relationship-owned tables** (`refunds`, `tournament_teams`, etc.) — carried over from the prior committed session as a documented, scoped follow-up. Unrelated to this 9-bug pass.
4. **This session's own test fixtures remain in club 1's live data**, clearly identifiable and harmless: one cancelled booking ("QA Cancel Test"), one partially-refunded booking ("QA Refund Test", matches the exact pre-existing pattern from the prior session's own RLS test fixtures), one cancelled coaching session. The append-only ledger trigger (by design) prevents deleting the associated ledger rows, same documented limitation noted in prior reports.

## 6. Git

- Branch: `fix/refresh-cookie-samesite`, starting and current HEAD both `594825a` (no commits made).
- `git status`: identical before and after this session — 13 modified files, 11 untracked (8 new tests + 3 new migrations), plus pre-existing unrelated untracked assets (`Mobile App.png`, `landing page.png`, `logo.png`, `outreach/`) not part of this work and not touched.
- No secrets in any changed/untracked file (spot-checked `.env.example` — placeholder values only).
- **Not committed, not pushed**, per instructions.

## 7. Final verdict

**All 9 findings (CF-QA-01 through CF-QA-09) are VERIFIED** — code correct, targeted unit tests passing, and real-user HTTP/SQL verification performed against the live Docker/Nginx/Postgres stack for every single one, not just code review. Full backend + frontend regression suites clean. Database integrity sweep clean aside from the one pre-existing historical data note in §4, which is informational, not a defect.
