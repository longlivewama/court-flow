-- ============================================================
--  Migration 023: Row-Level Security defense-in-depth for tenant-owned
--  tables (CF-QA-005).
--
--  Application-level tenant scoping — `WHERE club_id = $1` on every domain
--  query, `requireClubResource()` in tenant.middleware.ts — remains the
--  PRIMARY isolation boundary and is completely unchanged by this
--  migration. This adds a second, database-enforced layer on top of it, so
--  a single missed `WHERE club_id` filter in application code becomes a
--  database-level empty-result / rejected-write instead of a silent
--  cross-tenant leak.
--
--  Session variable, set transaction-locally (never globally — see
--  backend/src/shared/tenant-context.ts and client.ts's applyTenantContext,
--  which use `set_config(..., true)`, the parameterized equivalent of
--  `SET LOCAL`, immediately after BEGIN on every transaction and every
--  db.query() call promoted into its own short transaction). Being
--  transaction-local is essential: `db`'s connection pool (courtflow_app,
--  migration 018) is shared across concurrent requests from different
--  tenants, and a plain session-wide `SET` would leak one tenant's scope
--  onto whichever unrelated request reuses that connection next.
--
--  Policy design — deliberately conservative "unset → allow":
--
--    USING (
--      current_setting('app.current_club_id', true) IS NULL
--      OR current_setting('app.current_club_id', true) = ''
--      OR club_id::text = current_setting('app.current_club_id', true)
--    )
--
--  Compares club_id as text, not `current_setting(...)::uuid` — Postgres
--  does not guarantee left-to-right short-circuit evaluation of OR
--  subexpressions in a query plan (unlike CASE, which does), so a cast in
--  the third branch can still execute even when an earlier branch would
--  already make the expression true. Concretely: the first time a
--  connection ever sets this custom GUC via `SET LOCAL`, Postgres reverts
--  it to `''` (not NULL) once that transaction ends — the placeholder
--  default for a custom GUC with no session-level value — so any later
--  query on that connection with no active tenant context would hit
--  `''::uuid` if the comparison were cast that way, which raises `invalid
--  input syntax for type uuid`. Casting the column to text instead
--  (`club_id::text`, always safe — every uuid has a valid text form) avoids
--  the failure mode entirely, regardless of evaluation order: an empty or
--  NULL current_setting() can never equal a real club_id's text form, so
--  both the permissive branches and the actual tenant check hold without
--  relying on short-circuiting.
--
--  The session variable is ONLY ever set by (a) authenticated HTTP
--  requests, via auth.middleware.ts's runWithTenant() wrapping the rest of
--  the request in AsyncLocalStorage, and (b) the cron jobs' per-club loop
--  bodies (infrastructure/cron/index.ts), which already process exactly
--  one club per iteration. Every other caller — the migration runner
--  itself (superuser, would bypass RLS regardless), seed scripts, and the
--  payment webhook (deliberately unauthenticated, since it must look up a
--  booking by the gateway's opaque reference *before* it knows which club
--  that booking belongs to) — never sets it, and continues to behave
--  exactly as before this migration: scoped entirely by its own explicit
--  `WHERE club_id = ...` SQL, already covered by tenant-isolation.test.ts
--  and this session's live cross-tenant testing.
--
--  What this newly catches: any AUTHENTICATED request-path query that
--  omits its club_id filter — the highest-value target, since that's the
--  overwhelming majority of traffic and where a coding mistake would put a
--  logged-in staff member from one club in front of another club's data.
--
--  Scope — tables with their own direct club_id column only (17 of the
--  business tables). Deliberately excludes:
--    * audit_logs — already has its own, stricter RLS (migration 018),
--      governed by role (courtflow_app/audit_writer/audit_owner), not by
--      this club-scoped mechanism. Untouched.
--    * clubs — this IS the tenant registry (identified by its own `id`,
--      has no club_id column to scope by); out of scope by definition.
--    * relationship-owned tables without their own club_id column
--      (refunds → via payments/bookings; tournament_teams, tournament_matches
--      → via tournaments; payment_webhook_events → via bookings;
--      booking_equipment, receipts → via bookings; lost_found_claims → via
--      lost_found_items) — these need EXISTS-based policies, a materially
--      different and higher-overhead shape that deserves its own dedicated
--      migration + live cross-tenant test pass rather than being folded in
--      here. Verified currently safe at the application level (every query
--      against them is reached only through an already club-scoped parent
--      lookup or join) — see COURTFLOW_PRODUCTION_REMEDIATION_REPORT.md for
--      the per-table detail.
--
--  courtflow_app is NOBYPASSRLS (migration 018) and owns none of these
--  tables (courtflow, the superuser, does) — FORCE is applied anyway,
--  matching migration 018's own reasoning, so a future non-superuser
--  owner change doesn't silently reopen the bypass.
-- ============================================================

DO $$
DECLARE
  t text;
  policy_using text := format(
    $pol$
      current_setting('app.current_club_id', true) IS NULL
      OR current_setting('app.current_club_id', true) = ''
      OR club_id::text = current_setting('app.current_club_id', true)
    $pol$
  );
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'blocked_periods', 'bookings', 'coaches', 'courts', 'equipment',
    'expenses', 'ledger_entries', 'lost_found_items', 'payments',
    'report_jobs', 'slot_holds', 'subscriptions', 'tournaments',
    'training_sessions', 'users', 'waitlist_entries', 'working_hours'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
      t, policy_using, policy_using
    );
  END LOOP;
END
$$;
