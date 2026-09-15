-- ============================================================
--  Migration 024: Fix audit_logs SELECT — RESTRICTIVE FOR ALL was
--  silently blocking reads, not just writes (CF-QA-01).
--
--  Root cause (verified live against the running dev database, roles,
--  and policies — not assumed from a prior report):
--
--    001_init_schema.sql created audit_logs_insert_only as:
--      AS RESTRICTIVE FOR ALL USING (FALSE) WITH CHECK (TRUE)
--    with the comment "App role (courtflow_app) can only SELECT or
--    INSERT, never UPDATE/DELETE" — i.e. the INTENT was to block only
--    UPDATE/DELETE. But `FOR ALL` makes a RESTRICTIVE policy apply to
--    every command including SELECT, and a RESTRICTIVE policy is ANDed
--    with PERMISSIVE ones rather than substituting for them. So the
--    permissive audit_logs_select policy (USING TRUE) was always ANDed
--    with this one's USING (FALSE) for SELECT, i.e. TRUE AND FALSE =
--    FALSE for every row, for any role that isn't a superuser/RLS-bypass.
--
--  Why this was invisible until now: until migration 018, the app's
--  runtime connection was `courtflow`, a superuser — superusers are never
--  subject to RLS regardless of FORCE, so the bug was dormant. Migration
--  018 moved the app's day-to-day connection to `courtflow_app`
--  (NOBYPASSRLS) and FORCEd RLS, which activated it. GET /api/audit has
--  returned `{"data":[],"total":0}` for every tenant ever since — a
--  silent 200, not an error, so it read as "no events yet."
--
--  Fix — replace the single overreaching RESTRICTIVE FOR ALL policy with
--  two precise ones, matching exactly what the original comment already
--  intended: RESTRICTIVE policies scoped to FOR UPDATE and FOR DELETE
--  only. CREATE POLICY does not accept a combined "FOR UPDATE, DELETE"
--  command list, so this requires two policies rather than one — that is
--  the only structural difference from the original. SELECT and INSERT
--  are left to the existing audit_logs_select / audit_logs_insert
--  PERMISSIVE policies (005_fix_audit_rls_insert.sql), which were already
--  correct and are completely untouched by this migration.
--
--  Deliberately NOT adding a club-scoped `tenant_isolation`-style policy
--  here (the pattern migration 023 applied to 17 other tables): 023's own
--  header explicitly excludes audit_logs, noting it is "governed by role
--  ..., not by this club-scoped mechanism" — a documented prior decision,
--  not an oversight. Tenant isolation for audit reads is already enforced
--  today at the application layer (audit.controller.ts's listAuditLogs
--  binds `WHERE club_id = $1` from the authenticated caller's own JWT
--  clubId, and the route is owner-only + requireTenant-gated) and is
--  unaffected by this migration either way. Broadening RLS scope here
--  would reopen a separate, already-deliberated design question that is
--  out of bounds for a targeted fix to this one bug; live cross-tenant
--  verification below proves the existing app-layer boundary still holds
--  once reads are unblocked.
--
--  UPDATE/DELETE remain blocked exactly as before: USING (FALSE) with no
--  WITH CHECK is sufficient — Postgres uses the USING clause for the
--  WITH CHECK of an UPDATE when none is given, so no row is ever visible
--  to update in the first place, and DELETE has no WITH CHECK concept at
--  all. audit_writer's INSERT-only grant (migration 001) and
--  courtflow_app's lack of any UPDATE/DELETE/TRUNCATE grant on audit_logs
--  (migration 018) are both untouched — this migration only replaces RLS
--  policies, no GRANT/REVOKE.
-- ============================================================

DROP POLICY IF EXISTS audit_logs_insert_only ON audit_logs;

CREATE POLICY audit_logs_block_update ON audit_logs
  AS RESTRICTIVE
  FOR UPDATE
  USING (FALSE);

CREATE POLICY audit_logs_block_delete ON audit_logs
  AS RESTRICTIVE
  FOR DELETE
  USING (FALSE);
