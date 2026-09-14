/**
 * Regression test for the critical "permission denied for table audit_logs"
 * bug: auditLogStrict() runs on the caller's transaction client, which
 * authenticates as courtflow_app — a role migration 018 deliberately denies
 * INSERT on audit_logs (only audit_writer may write). Migration 022 grants
 * courtflow_app non-inheriting membership in audit_writer specifically so
 * auditLogStrict can SET LOCAL ROLE audit_writer for just the INSERT, then
 * RESET ROLE immediately after so the rest of the caller's transaction keeps
 * running under ordinary least-privilege courtflow_app. This test locks that
 * exact statement sequence against a mocked PoolClient (live-verified
 * separately against the real courtflow_app/audit_writer roles in Docker).
 */
import { auditLogStrict } from '../src/infrastructure/audit/audit.service';

function makeClient(behavior?: { failOn?: string }) {
  const calls: string[] = [];
  return {
    calls,
    query: jest.fn((text: string) => {
      calls.push(text);
      if (behavior?.failOn && text.includes(behavior.failOn)) {
        return Promise.reject(new Error(`simulated failure: ${text}`));
      }
      return Promise.resolve({ rows: [] });
    }),
  };
}

describe('auditLogStrict — scoped role elevation', () => {
  it('elevates to audit_writer via SET LOCAL ROLE, inserts, then RESET ROLE', async () => {
    const client = makeClient();

    await auditLogStrict(client as any, {
      clubId: 'club-1',
      actionType: 'BOOKING_CREATED',
      entityType: 'booking',
      entityId: 'booking-1',
    });

    expect(client.calls[0]).toBe('SET LOCAL ROLE audit_writer');
    expect(client.calls[1]).toMatch(/INSERT INTO audit_logs/);
    expect(client.calls[2]).toBe('RESET ROLE');
  });

  it('still resets role (best-effort) and propagates the original error when the INSERT fails', async () => {
    const client = makeClient({ failOn: 'INSERT INTO audit_logs' });

    await expect(
      auditLogStrict(client as any, {
        clubId: 'club-1',
        actionType: 'BOOKING_CREATED',
        entityType: 'booking',
        entityId: 'booking-1',
      })
    ).rejects.toThrow(/simulated failure/);

    expect(client.calls[0]).toBe('SET LOCAL ROLE audit_writer');
    expect(client.calls[1]).toMatch(/INSERT INTO audit_logs/);
    expect(client.calls[2]).toBe('RESET ROLE');
  });

  it('never swallows the original INSERT error even if RESET ROLE itself fails', async () => {
    const client = makeClient();
    client.query = jest.fn((text: string) => {
      client.calls.push(text);
      if (text.includes('INSERT INTO audit_logs')) return Promise.reject(new Error('insert failed'));
      if (text === 'RESET ROLE') return Promise.reject(new Error('reset failed too'));
      return Promise.resolve({ rows: [] });
    });

    await expect(
      auditLogStrict(client as any, {
        clubId: 'club-1',
        actionType: 'BOOKING_CREATED',
        entityType: 'booking',
      })
    ).rejects.toThrow('insert failed');
  });
});
