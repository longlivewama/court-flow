-- ============================================================
--  Migration 018: Force RLS on audit_logs — close the owner/superuser
--  bypass so the immutability guarantee is real, not just documented.
--
--  Why FORCE ROW LEVEL SECURITY alone is not enough here:
--    * By default Postgres SKIPS row-level security entirely for a table's
--      OWNER (and always for a superuser, unconditionally — FORCE cannot
--      change that). `courtflow`, the role every migration up to this one
--      has run as, is both: it is created via the official postgres image's
--      POSTGRES_USER, which is provisioned as a SUPERUSER, and it owns
--      audit_logs (it created the table in 001_init_schema.sql).
--    * The application's day-to-day connection (`db` in client.ts) has,
--      until now, used that same superuser role for every query. A
--      superuser connection can UPDATE/DELETE/TRUNCATE audit_logs no matter
--      what RLS policies exist — RLS is not a control superusers are ever
--      subject to.
--
--  The fix has two parts:
--    1. Move audit_logs (and its sequence) to a dedicated, unprivileged
--       owner role that nothing ever logs in as, so ownership itself can no
--       longer imply a bypass.
--    2. Introduce `courtflow_app`: a NON-superuser role for the app's
--       regular connection, with SELECT-only on audit_logs (it never writes
--       audit rows directly — audit.service.ts always uses the separate
--       audit_writer/DATABASE_URL_AUDIT connection for inserts) and full
--       day-to-day access to every other table, matching what `courtflow`
--       already granted it implicitly as owner. `courtflow` remains
--       available, unchanged, for migrations and admin tooling.
--
--  client.ts's main pool picks up DATABASE_URL_APP when set (falling back to
--  DATABASE_URL otherwise, so any environment that hasn't provisioned the
--  new role keeps working exactly as before); docker-compose.yml sets
--  DATABASE_URL_APP for the api service to use courtflow_app.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'courtflow_app') THEN
    CREATE ROLE courtflow_app LOGIN PASSWORD 'CHANGE_IN_PRODUCTION' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Ownerless administrative role: nothing ever authenticates as this. Its only
-- purpose is to hold ownership of audit_logs so that neither `courtflow`
-- (superuser/migrations) nor `courtflow_app` (the app's runtime connection)
-- is the owner — table owners implicitly hold every privilege, including
-- TRUNCATE, and that cannot be revoked from an owner short of changing who
-- owns the table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_owner') THEN
    CREATE ROLE audit_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

ALTER TABLE audit_logs OWNER TO audit_owner;
ALTER SEQUENCE audit_logs_id_seq OWNER TO audit_owner;

-- Now meaningful: courtflow_app and audit_writer are both non-owner,
-- non-superuser roles, so FORCE actually subjects them to the policies below
-- (audit_logs_insert_only / audit_logs_insert / audit_logs_select from
-- 001_init_schema.sql + 005_fix_audit_rls_insert.sql).
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Re-affirm least privilege now that ownership has moved: courtflow_app may
-- only ever SELECT (for the owner-facing audit log viewer); audit_writer
-- keeps its existing INSERT-only grant. Neither role — nor PUBLIC — ever
-- receives UPDATE, DELETE, or TRUNCATE, and TRUNCATE additionally requires
-- table ownership that neither role holds.
REVOKE ALL ON audit_logs FROM PUBLIC;
GRANT SELECT ON audit_logs TO courtflow_app;
GRANT INSERT ON audit_logs TO audit_writer;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO audit_writer;

-- ── Give courtflow_app the same day-to-day access `courtflow` already had
--    (implicitly, as owner) on every OTHER table, so pointing the app's
--    connection at courtflow_app is a drop-in replacement. audit_logs is
--    deliberately excluded — handled above.
GRANT USAGE ON SCHEMA public TO courtflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO courtflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO courtflow_app;
REVOKE INSERT, UPDATE, DELETE ON audit_logs FROM courtflow_app;

-- Keep future tables/sequences (created by later migrations, which continue
-- to run as the `courtflow` owner) automatically visible to courtflow_app
-- without needing another grants migration each time.
ALTER DEFAULT PRIVILEGES FOR ROLE courtflow IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO courtflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE courtflow IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO courtflow_app;
