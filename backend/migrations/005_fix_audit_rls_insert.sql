-- ============================================================
--  Migration 005: Fix audit_logs RLS — INSERTs were silently denied
--
--  001_init_schema.sql enabled RLS on audit_logs with only:
--    * audit_logs_insert_only  (RESTRICTIVE, FOR ALL)  — blocks UPDATE/DELETE
--    * audit_logs_select       (PERMISSIVE, FOR SELECT)
--  PostgreSQL default-denies any command with no PERMISSIVE policy, so the
--  audit_writer role's INSERTs have always failed ("new row violates
--  row-level security policy") and were swallowed by auditLog()'s
--  fire-and-forget error handling. No audit row was ever written.
--
--  This adds the missing permissive INSERT policy. The restrictive policy
--  still denies UPDATE/DELETE, preserving append-only semantics.
-- ============================================================

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (TRUE);
