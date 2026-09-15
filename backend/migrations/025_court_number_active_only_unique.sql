-- ============================================================
--  Migration 025: Court numbers unique among ACTIVE courts only (CF-QA-05).
--
--  Root cause: `courts_club_id_number_key` was a plain UNIQUE(club_id,
--  number) constraint with no regard for is_active — so once a court was
--  deactivated (DELETE /api/courts/:id, a soft-delete that only flips
--  is_active to false), its number could never be reused by any future
--  court, active or not, forever. Combined with `courtUpdateSchema` never
--  having accepted `isActive` at all (silently stripped by zod, so `PATCH
--  {isActive:true}` was a silent no-op 200 with nothing changed), there was
--  also no way to bring the same court back either. Together: deactivating
--  a court for e.g. renovation permanently burned that number with no way
--  back — verified live against the actual dev database (0 pre-existing
--  duplicate (club_id, number) pairs, active or not, so this migration
--  cannot conflict with any real data; see the pre-flight query below,
--  which every operator applying this to another environment should also
--  run first).
--
--  Pre-flight check (run before applying to any other database — if this
--  returns any rows, resolve them manually before proceeding, since two
--  ACTIVE courts sharing a number would violate the new partial index):
--    SELECT club_id, number, count(*) FROM courts
--    WHERE is_active = true GROUP BY club_id, number HAVING count(*) > 1;
--
--  Fix: replace the global UNIQUE constraint with a partial unique INDEX
--  scoped to is_active = true. Postgres has no "partial constraint" via
--  ALTER TABLE ADD CONSTRAINT — only CREATE UNIQUE INDEX supports a WHERE
--  clause — so this necessarily becomes an index rather than a named
--  constraint; behavior at the app layer (courtCtrl's existing 23505 ->
--  ConflictError translation) is unaffected, since a partial unique index
--  violation raises the exact same 23505 error code as a constraint would.
--  Inactive courts may now freely share a number with each other or with
--  history — only ACTIVE courts within the same club are ever compared.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'courts_club_id_number_key' AND table_name = 'courts'
  ) THEN
    ALTER TABLE courts DROP CONSTRAINT courts_club_id_number_key;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS courts_club_id_number_active_key
  ON courts (club_id, number)
  WHERE is_active = true;
