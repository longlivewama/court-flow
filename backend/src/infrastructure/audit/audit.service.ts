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
import { logger } from '../../shared/logger';

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
    logger.error({ err }, 'Fire-and-forget audit log insert failed');
  }
}

/**
 * Strict, transactional audit write. Runs on the caller's transaction client
 * so the audit row commits (or rolls back) atomically with the operation it
 * records. Unlike auditLog(), a failure here THROWS — use this when an
 * unaudited operation must not be allowed to proceed.
 */
export async function auditLogStrict(client: PoolClient, entry: AuditEntry): Promise<void> {
  // The caller's transaction client authenticates as courtflow_app, which
  // (migration 018) has no INSERT on audit_logs — only audit_writer does.
  // Migration 022 grants courtflow_app non-inheriting membership in
  // audit_writer specifically so this function can assume it for exactly
  // this one statement; SET LOCAL confines the elevation to the current
  // transaction, and RESET ROLE drops back to courtflow_app immediately
  // afterward so every other statement in the caller's transaction — before
  // or after this call — keeps running under ordinary least-privilege
  // courtflow_app, even when multiple audit calls are interleaved with
  // non-audit writes in the same transaction.
  await client.query('SET LOCAL ROLE audit_writer');
  try {
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
  } finally {
    // Best-effort: if the INSERT above failed, the transaction is already
    // aborted and this is a no-op until the caller rolls back — never let a
    // RESET failure hide the real error.
    await client.query('RESET ROLE').catch(() => {});
  }
}

// ── Standard action types ─────────────────────────────────────
export const AUDIT_ACTIONS = {
  // Auth
  USER_REGISTERED:         'USER_REGISTERED',
  CLUB_REGISTERED:         'CLUB_REGISTERED',
  USER_LOGIN:              'USER_LOGIN',
  USER_LOGIN_FAILED:       'USER_LOGIN_FAILED',
  USER_LOCKED_OUT:         'USER_LOCKED_OUT',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
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
  // Equipment rental
  EQUIPMENT_CREATED:       'EQUIPMENT_CREATED',
  EQUIPMENT_UPDATED:       'EQUIPMENT_UPDATED',
  EQUIPMENT_DELETED:       'EQUIPMENT_DELETED',
  // VIP subscriptions
  SUBSCRIPTION_CREATED:    'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_REVOKED:    'SUBSCRIPTION_REVOKED',
  // Staff management
  USER_STATUS_CHANGED:     'USER_STATUS_CHANGED',
  STAFF_CREATED:           'STAFF_CREATED',
  STAFF_REMOVED:           'STAFF_REMOVED',
  STAFF_PERMISSIONS_UPDATED: 'STAFF_PERMISSIONS_UPDATED',
  // Club expenses
  EXPENSE_CREATED:         'EXPENSE_CREATED',
  EXPENSE_UPDATED:         'EXPENSE_UPDATED',
  EXPENSE_DELETED:         'EXPENSE_DELETED',
  // Tournaments
  TOURNAMENT_CREATED:      'TOURNAMENT_CREATED',
  TOURNAMENT_UPDATED:      'TOURNAMENT_UPDATED',
  TOURNAMENT_TEAM_REGISTERED:   'TOURNAMENT_TEAM_REGISTERED',
  TOURNAMENT_FEE_RECORDED:      'TOURNAMENT_FEE_RECORDED',
  TOURNAMENT_BRACKET_GENERATED: 'TOURNAMENT_BRACKET_GENERATED',
  TOURNAMENT_RESULT_RECORDED:   'TOURNAMENT_RESULT_RECORDED',
  // Coaching
  COACH_CREATED:            'COACH_CREATED',
  COACH_UPDATED:            'COACH_UPDATED',
  TRAINING_SESSION_CREATED: 'TRAINING_SESSION_CREATED',
  TRAINING_SESSION_UPDATED: 'TRAINING_SESSION_UPDATED',
  TRAINING_SESSION_PAID:    'TRAINING_SESSION_PAID',
  // Payment gateway webhook
  PAYMENT_WEBHOOK_PROCESSED:   'PAYMENT_WEBHOOK_PROCESSED',
  PAYMENT_WEBHOOK_INSUFFICIENT: 'PAYMENT_WEBHOOK_INSUFFICIENT',
  TOURNAMENT_FEE_PAID_ONLINE:  'TOURNAMENT_FEE_PAID_ONLINE',
  // Waitlist / anti-scalping slot holds
  WAITLIST_JOINED:           'WAITLIST_JOINED',
  SLOT_HOLD_CREATED:         'SLOT_HOLD_CREATED',
  SLOT_HOLD_CLAIMED:         'SLOT_HOLD_CLAIMED',
  // Lost & Found
  LOST_ITEM_LOGGED:          'LOST_ITEM_LOGGED',
  LOST_ITEM_UPDATED:         'LOST_ITEM_UPDATED',
  LOST_ITEM_CLAIM_SUBMITTED: 'LOST_ITEM_CLAIM_SUBMITTED',
  LOST_ITEM_CLAIM_DECIDED:   'LOST_ITEM_CLAIM_DECIDED',
  // Sensitive-data read access (PHASE 3 item 11)
  RECEIPT_VIEWED:               'RECEIPT_VIEWED',
  FINANCIAL_REPORT_DOWNLOADED:  'FINANCIAL_REPORT_DOWNLOADED',
  CUSTOMER_PII_EXPORTED:        'CUSTOMER_PII_EXPORTED',
} as const;
