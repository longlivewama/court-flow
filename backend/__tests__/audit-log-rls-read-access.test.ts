/**
 * CF-QA-01 (CRITICAL) — GET /api/audit returned zero rows for every tenant,
 * always. Root cause: 001_init_schema.sql's audit_logs_insert_only policy was
 * `AS RESTRICTIVE FOR ALL USING (FALSE)` — `FOR ALL` makes a RESTRICTIVE
 * policy apply to SELECT too, and RESTRICTIVE policies AND with PERMISSIVE
 * ones rather than replacing them, so the permissive audit_logs_select
 * policy's `USING (TRUE)` was always ANDed down to FALSE. Dormant while the
 * app ran as the superuser `courtflow` (unconditionally bypasses RLS);
 * activated the moment migration 018 moved reads to non-superuser
 * `courtflow_app`. Fixed by migration 024, which replaces the single
 * overreaching policy with two precise ones scoped to FOR UPDATE / FOR
 * DELETE only, leaving the existing SELECT/INSERT policies untouched.
 *
 * A mocked-pool jest test structurally cannot catch this class of bug — RLS
 * is evaluated by real Postgres, not by db.query(). This suite guards two
 * different things at two different levels:
 *
 *   1. A static source-level check that the exact mistake (a RESTRICTIVE
 *      `FOR ALL` policy on audit_logs) cannot silently reappear in a future
 *      migration — the fast, always-runs-in-CI half.
 *   2. A live-Postgres check against a disposable, throwaway container that
 *      actually applies every migration in order and proves the real
 *      role-level read/write/update/delete behavior. Opt-in only (set
 *      RUN_LIVE_DB_TESTS=1), matching this repo's existing convention for
 *      this exact class of check — see booking-overlap-exclusion-migration.
 *      test.ts's header: live-container verification is documented and was
 *      run (three consecutive clean passes, ~5.1-5.2s each, plus an explicit
 *      before/after check reproducing CF-QA-01 and confirming the fix — see
 *      migration 024's own commit history) but deliberately isn't part of
 *      the default `npm test` gate. Reproduced firsthand while building this
 *      suite: it is perfectly reliable in isolation but flakes under `npm
 *      test`'s full parallel run, where ~27 other test files' worker
 *      processes compete for CPU against this test's 24 sequential `docker
 *      exec` calls — contention, not a real migration failure (re-running
 *      the exact same file alone immediately after a failure always passed).
 */
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const FIX_MIGRATION = path.join(MIGRATIONS_DIR, '024_fix_audit_log_select_rls.sql');

describe('migration 024 — audit_logs RLS no longer blocks SELECT', () => {
  test('no RESTRICTIVE policy covering audit_logs uses FOR ALL (the exact CF-QA-01 mistake) in any migration from 024 onward', () => {
    // Migration 001 is intentionally excluded: it contains the original
    // defect verbatim (by definition — that's what 024 fixes) and, per this
    // repo's migration-immutability rule, can never be edited to remove it
    // retroactively. The live-Postgres test below is what actually proves
    // the fixed *end state*; this static check only guards against a FUTURE
    // migration reintroducing the same mistake on top of the fix.
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => {
        const n = parseInt(f.slice(0, 3), 10);
        return !Number.isNaN(n) && n >= 24;
      });
    expect(files.length).toBeGreaterThan(0); // guard against the filter itself silently matching nothing
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // Find every CREATE POLICY ... ON audit_logs block and check none of
      // them are both RESTRICTIVE and FOR ALL — the original 001 defect.
      const policyBlocks = sql.match(/CREATE POLICY[\s\S]*?ON audit_logs[\s\S]*?;/gi) ?? [];
      for (const block of policyBlocks) {
        const isRestrictive = /AS\s+RESTRICTIVE/i.test(block);
        const isForAll = /FOR\s+ALL/i.test(block);
        if (isRestrictive && isForAll) {
          throw new Error(
            `${file} creates a RESTRICTIVE ... FOR ALL policy on audit_logs — ` +
            `this is the exact CF-QA-01 defect (blocks SELECT along with UPDATE/DELETE). ` +
            `Block:\n${block}`
          );
        }
      }
    }
  });

  test('migration 024 drops the old policy and adds precisely-scoped UPDATE/DELETE blocks', () => {
    const sql = fs.readFileSync(FIX_MIGRATION, 'utf8');
    expect(sql).toMatch(/DROP POLICY IF EXISTS audit_logs_insert_only ON audit_logs/i);
    expect(sql).toMatch(/CREATE POLICY audit_logs_block_update[\s\S]*AS\s+RESTRICTIVE[\s\S]*FOR\s+UPDATE[\s\S]*USING\s*\(\s*FALSE\s*\)/i);
    expect(sql).toMatch(/CREATE POLICY audit_logs_block_delete[\s\S]*AS\s+RESTRICTIVE[\s\S]*FOR\s+DELETE[\s\S]*USING\s*\(\s*FALSE\s*\)/i);
    // Must not touch grants/roles — this is a pure RLS-policy fix. Strip
    // `-- ...` line comments first so mentions of GRANT/REVOKE in the
    // explanatory header (discussing what *other* migrations already did)
    // don't false-positive against actual executable statements.
    const executableSql = sql.replace(/--.*$/gm, '');
    expect(executableSql).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
  });

  test('audit.controller.ts still scopes every read by the caller\'s own club_id (app-layer tenant isolation, unaffected by the RLS fix)', () => {
    const controllerSrc = fs.readFileSync(
      path.resolve(__dirname, '../src/interfaces/http/controllers/audit.controller.ts'),
      'utf8'
    );
    expect(controllerSrc).toMatch(/clubIdOf\(req\)/);
    expect(controllerSrc).toMatch(/club_id = \$1/);
  });
});

describe('migration 024 — live Postgres role-level proof', () => {
  const dockerAvailable = (() => {
    if (process.env.RUN_LIVE_DB_TESTS !== '1') return false;
    try {
      execSync('docker info', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  const maybeTest = dockerAvailable ? test : test.skip;
  const CONTAINER = 'cf_jest_audit_rls_check';

  maybeTest(
    'fresh DB: courtflow_app can SELECT audit_logs but still cannot UPDATE/DELETE/INSERT; audit_writer can still INSERT but not SELECT',
    () => {
      try {
        spawnSync('docker', ['rm', '-f', CONTAINER]); // best-effort, ignore result
        const run = spawnSync('docker', [
          'run', '--rm', '-d', '--name', CONTAINER,
          '-e', 'POSTGRES_USER=courtflow',
          '-e', 'POSTGRES_PASSWORD=jest_local_only',
          '-e', 'POSTGRES_DB=courtflow',
          'postgres:16-alpine',
        ]);
        expect(run.status).toBe(0);

        // Wait for readiness (a few short polls, generous ceiling).
        let ready = false;
        for (let i = 0; i < 30; i++) {
          const check = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'courtflow']);
          if (check.status === 0) { ready = true; break; }
          spawnSync('sleep', ['1']);
        }
        expect(ready).toBe(true);

        const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
        for (const file of files) {
          const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file));
          const apply = spawnSync(
            'docker',
            ['exec', '-i', CONTAINER, 'psql', '-U', 'courtflow', '-d', 'courtflow', '-v', 'ON_ERROR_STOP=1'],
            { input: sql }
          );
          if (apply.status !== 0) {
            throw new Error(`Migration ${file} failed on fresh DB:\n${apply.stderr?.toString()}`);
          }
        }

        const seedClub = spawnSync(
          'docker',
          ['exec', '-i', CONTAINER, 'psql', '-U', 'courtflow', '-d', 'courtflow'],
          { input: Buffer.from(
            `INSERT INTO audit_logs (club_id, action_type, entity_type, reason) ` +
            `VALUES ('11111111-1111-1111-1111-111111111111','TEST_ACTION','test_entity','jest fixture');`
          ) }
        );
        expect(seedClub.status).toBe(0);

        const asAppSelect = spawnSync(
          'docker',
          ['exec', '-i', CONTAINER, 'psql', '-U', 'courtflow_app', '-d', 'courtflow', '-t', '-c',
            `SELECT count(*) FROM audit_logs WHERE club_id='11111111-1111-1111-1111-111111111111';`]
        );
        expect(asAppSelect.stdout.toString().trim()).toBe('1'); // the bug: this used to be 0

        const asAppUpdate = spawnSync(
          'docker',
          ['exec', '-i', CONTAINER, 'psql', '-U', 'courtflow_app', '-d', 'courtflow', '-c',
            `UPDATE audit_logs SET reason='TAMPERED' WHERE club_id='11111111-1111-1111-1111-111111111111';`]
        );
        expect(asAppUpdate.status).not.toBe(0);
        expect(asAppUpdate.stderr.toString()).toMatch(/permission denied/i);

        const asAppDelete = spawnSync(
          'docker',
          ['exec', '-i', CONTAINER, 'psql', '-U', 'courtflow_app', '-d', 'courtflow', '-c',
            `DELETE FROM audit_logs WHERE club_id='11111111-1111-1111-1111-111111111111';`]
        );
        expect(asAppDelete.status).not.toBe(0);
        expect(asAppDelete.stderr.toString()).toMatch(/permission denied/i);

        const asAppDirectInsert = spawnSync(
          'docker',
          ['exec', '-i', CONTAINER, 'psql', '-U', 'courtflow_app', '-d', 'courtflow', '-c',
            `INSERT INTO audit_logs (club_id, action_type, entity_type) VALUES ('11111111-1111-1111-1111-111111111111','SHOULD_FAIL','x');`]
        );
        expect(asAppDirectInsert.status).not.toBe(0);

        const asWriterInsert = spawnSync(
          'docker',
          ['exec', '-i', CONTAINER, 'psql', '-U', 'audit_writer', '-d', 'courtflow', '-c',
            `INSERT INTO audit_logs (club_id, action_type, entity_type) VALUES ('11111111-1111-1111-1111-111111111111','WRITER_TEST','x');`]
        );
        expect(asWriterInsert.status).toBe(0);

        const asWriterSelect = spawnSync(
          'docker',
          ['exec', '-i', CONTAINER, 'psql', '-U', 'audit_writer', '-d', 'courtflow', '-c',
            `SELECT * FROM audit_logs LIMIT 1;`]
        );
        expect(asWriterSelect.status).not.toBe(0); // audit_writer never had SELECT — unaffected by this fix
      } finally {
        spawnSync('docker', ['rm', '-f', CONTAINER]);
      }
    },
    120_000
  );
});
