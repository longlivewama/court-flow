-- ============================================================
--  Migration 026: No duplicate ACTIVE waitlist entries (CF-QA-09).
--
--  Root cause: joinWaitlist() (waitlist.controller.ts) had no uniqueness
--  check at all — the same customer could POST /api/waitlist repeatedly for
--  the identical club/court/time window and get a fresh row every time.
--  Low severity (data-quality/spam potential on waitlist_entries, not a
--  security issue), but real: verified live, 0 rows rejected before this
--  fix.
--
--  Uniqueness key: (club_id, user_id, court_id, desired_start, desired_end),
--  scoped to ACTIVE entries only (fulfilled_at IS NULL) — a customer whose
--  earlier entry was already fulfilled (matched to a slot hold) must still
--  be able to join again later, including for the exact same window.
--
--  court_id is nullable ("any court" — see joinSchema's comment). Postgres
--  never treats two NULLs as equal in a unique index, so a plain unique
--  index on the raw column would let a customer stack unlimited duplicate
--  "any court" entries for the same window — the exact case this fix must
--  also catch. COALESCE'd to a fixed sentinel UUID inside the index
--  expression normalizes that case without touching the real column or its
--  FK constraint (this is a pure expression index, not a column change).
--
--  Pre-flight check (run before applying to any other database — if this
--  returns rows, decide how to reconcile them manually before proceeding):
--    SELECT club_id, user_id,
--           COALESCE(court_id, '00000000-0000-0000-0000-000000000000'::uuid) AS court_key,
--           desired_start, desired_end, count(*)
--    FROM waitlist_entries WHERE fulfilled_at IS NULL
--    GROUP BY club_id, user_id, court_key, desired_start, desired_end
--    HAVING count(*) > 1;
--  Verified live against the actual dev database: 0 rows, safe to apply.
--
--  This is the DATABASE half of a defense-in-depth pair — the APPLICATION
--  half (waitlist.controller.ts catching this index's 23505 and translating
--  it to a clean ConflictError, matching the pattern already used for
--  courts/refunds elsewhere in this codebase) ships in the same change.
--  The index alone is also what makes two concurrent identical join
--  requests resolve to exactly one winner: both can pass an app-level
--  pre-check race, but only one INSERT can ever commit.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_no_duplicate_active
  ON waitlist_entries (
    club_id,
    user_id,
    COALESCE(court_id, '00000000-0000-0000-0000-000000000000'::uuid),
    desired_start,
    desired_end
  )
  WHERE fulfilled_at IS NULL;
