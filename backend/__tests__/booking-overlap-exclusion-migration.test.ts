/**
 * Phase 8 — DB-level defense-in-depth exclusion constraint.
 *
 * The actual overlap/boundary/cancelled-status/different-court/reschedule/
 * overnight behavior of migration 021's EXCLUDE constraint was verified live
 * against a disposable Postgres 16 container (not part of this jest run —
 * see the migration file's header comment for the exact test script). This
 * test guards against silent drift between the migration's WHERE clause and
 * the application-level conflict check it's meant to mirror: if someone adds
 * a new booking_status and updates one without the other, a booking in that
 * status could either wrongly block new bookings (blocked at the DB layer
 * but not the app layer, confusing a legitimate booking with a 500) or wrongly
 * fail to block them (the DB backstop silently stops matching the app rule).
 */
import fs from 'fs';
import path from 'path';

const MIGRATION_PATH = path.resolve(__dirname, '../migrations/021_booking_overlap_exclusion.sql');
const VALIDATOR_PATH = path.resolve(__dirname, '../src/domain/booking/booking.validator.ts');

function extractStatusList(source: string, pattern: RegExp): string[] {
  const match = source.match(pattern);
  if (!match) throw new Error(`Pattern not found: ${pattern}`);
  return match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
}

describe('migration 021 — status scope matches the app-level conflict check', () => {
  test('the EXCLUDE constraint WHERE clause lists the exact same "active" statuses as booking.validator.ts', () => {
    const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const validatorSrc  = fs.readFileSync(VALIDATOR_PATH, 'utf8');

    const migrationStatuses = extractStatusList(
      migrationSql,
      /status IN \(([^)]+)\)\s*\n\s*AND deleted_at IS NULL/
    );
    const validatorStatuses = extractStatusList(validatorSrc, /AND status IN \(([^)]+)\)/);

    expect(migrationStatuses).toEqual(validatorStatuses);
  });

  test('terminal statuses (cancelled, completed, no_show, expired) are explicitly excluded from the constraint scope', () => {
    const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const migrationStatuses = extractStatusList(
      migrationSql,
      /status IN \(([^)]+)\)\s*\n\s*AND deleted_at IS NULL/
    );
    for (const terminal of ['cancelled', 'completed', 'no_show', 'expired']) {
      expect(migrationStatuses).not.toContain(terminal);
    }
  });

  test('the migration requires btree_gist and guards the ADD CONSTRAINT so it is safe to re-run', () => {
    const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(migrationSql).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist/);
    expect(migrationSql).toMatch(/pg_constraint WHERE conname = 'bookings_no_overlap_per_court'/);
  });

  test('uses tstzrange with the && overlap operator, matching the half-open [start, end) semantics used everywhere else', () => {
    const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(migrationSql).toMatch(/tstzrange\(start_time, end_time\) WITH &&/);
  });
});
