/**
 * Immutable Audit Log Service.
 * Uses the INSERT-only database connection pool (audit_writer role).
 * All audit writes are fire-and-forget; errors are logged but never thrown.
 *
 * For destructive operations where the audit record is a hard requirement
 * (e.g. permanent booking deletion), use auditLogStrict() with the operation's
 * own transaction client instead: it commits atomically with the operation and
 * THROWS on failure, rolling the whole transaction back.
 */
import { PoolClient } from 'pg';
import { auditDb } from '../../infrastructure/database/client';

export interface AuditEntry {
  clubId:         string;
  userId?:        string;
  userRole?:      string;
  ipAddress?:     string;
  deviceInfo?:    string;
  actionType:     string;
  entityType:     string;
  entityId?:      string;
  previousValues?: Record<string, unknown>;
  newValues?:      Record<string, unknown>;
  reason?:         string;
}

const AUDIT_INSERT_SQL = `
  INSERT INTO audit_logs
    (club_id, user_id, user_role, ip_address, device_info,
     action_type, entity_type, entity_id, previous_values, new_values, reason)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
`;

export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await auditDb.query(AUDIT_INSERT_SQL, [
      entry.clubId,
      entry.userId ?? null,
      entry.userRole ?? null,
      entry.ipAddress ?? null,
      entry.deviceInfo ?? null,
      entry.actionType,
      entry.entityType,
      entry.entityId ?? null,
      entry.previousValues ? JSON.stringify(entry.previousValues) : null,
      entry.newValues      ? JSON.stringify(entry.newValues)      : null,
      entry.reason ?? null,
    ]);
  } catch (err) {
    // Never let audit failure break the main request flow
    console.error('Audit log failed:', err);
  }
}

/**
 * Strict, transactional audit write. Runs on the caller's transaction client
 * so the audit row commits (or rolls back) atomically with the operation it
 * records. Unlike auditLog(), a failure here THROWS — use this when an
 * unaudited operation must not be allowed to proceed.
 */
export async function auditLogStrict(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(AUDIT_INSERT_SQL, [
    entry.clubId,
    entry.userId ?? null,
    entry.userRole ?? null,
    entry.ipAddress ?? null,
    entry.deviceInfo ?? null,
    entry.actionType,
    entry.entityType,
    entry.entityId ?? null,
    entry.previousValues ? JSON.stringify(entry.previousValues) : null,
    entry.newValues      ? JSON.stringify(entry.newValues)      : null,
    entry.reason ?? null,
  ]);
}

// ── Standard action types ─────────────────────────────────────
export const AUDIT_ACTIONS = {
  // Auth
  USER_REGISTERED:         'USER_REGISTERED',
  USER_LOGIN:              'USER_LOGIN',
  USER_LOGIN_FAILED:       'USER_LOGIN_FAILED',
  USER_LOCKED_OUT:         'USER_LOCKED_OUT',
  USER_PASSWORD_RESET:     'USER_PASSWORD_RESET',
  USER_EMAIL_VERIFIED:     'USER_EMAIL_VERIFIED',
  USER_LOGOUT:             'USER_LOGOUT',
  TOKEN_REVOKED:           'TOKEN_REVOKED',
  // Bookings
  BOOKING_CREATED:         'BOOKING_CREATED',
  BOOKING_CONFIRMED:       'BOOKING_CONFIRMED',
  BOOKING_CANCELLED:       'BOOKING_CANCELLED',
  BOOKING_CHECKED_IN:      'BOOKING_CHECKED_IN',
  BOOKING_COMPLETED:       'BOOKING_COMPLETED',
  BOOKING_NO_SHOW:         'BOOKING_NO_SHOW',
  BOOKING_EXPIRED:         'BOOKING_EXPIRED',
  BOOKING_DELETED:         'BOOKING_DELETED',
  // Payments
  RECEIPT_UPLOADED:        'RECEIPT_UPLOADED',
  DEPOSIT_APPROVED:        'DEPOSIT_APPROVED',
  DEPOSIT_REJECTED:        'DEPOSIT_REJECTED',
  BALANCE_RECORDED:        'BALANCE_RECORDED',
  // Refunds
  REFUND_REQUESTED:        'REFUND_REQUESTED',
  REFUND_APPROVED:         'REFUND_APPROVED',
  REFUND_REJECTED:         'REFUND_REJECTED',
  // Courts
  COURT_CREATED:           'COURT_CREATED',
  COURT_UPDATED:           'COURT_UPDATED',
  COURT_DELETED:           'COURT_DELETED',
  COURT_STATUS_CHANGED:    'COURT_STATUS_CHANGED',
  // Settings
  SETTINGS_UPDATED:        'SETTINGS_UPDATED',
  WORKING_HOURS_UPDATED:   'WORKING_HOURS_UPDATED',
  BLOCKED_PERIOD_CREATED:  'BLOCKED_PERIOD_CREATED',
  BLOCKED_PERIOD_DELETED:  'BLOCKED_PERIOD_DELETED',
  // Reports
  REPORT_GENERATED:        'REPORT_GENERATED',
} as const;
