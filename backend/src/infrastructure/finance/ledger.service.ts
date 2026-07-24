/**
 * Financial Ledger service.
 *
 * A thin, reusable writer over the append-only `ledger_entries` table. Every
 * money-moving side effect that is NOT a plain booking collection (refunds,
 * forfeited deposits, future manual adjustments) records one immutable row
 * here so the Finance dashboard has a single, auditable source of truth for
 * cancellation accounting.
 *
 * The table rejects UPDATE/DELETE at the database level (see migration 016), so
 * there is deliberately no update/delete API here — corrections are made by
 * appending a reversing entry, never by editing history.
 */
import { PoolClient } from 'pg';

export const LEDGER_ENTRY_TYPES = {
  /** Money paid back to the customer (DEBIT — leaves the club). */
  REFUND:                   'REFUND',
  /** A deposit kept by the club on a late cancellation (CREDIT — retained). */
  FORFEIT_INCOME:           'FORFEIT_INCOME',
  /** Generic manual correction hook (either direction). */
  CANCELLATION_ADJUSTMENT:  'CANCELLATION_ADJUSTMENT',
} as const;

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface LedgerEntryInput {
  clubId:         string;
  entryType:      string;
  direction:      LedgerDirection;
  amount:         number;
  bookingId?:     string | null;
  paymentId?:     string | null;
  courtName?:     string | null;
  reason?:        string | null;
  metadata?:      Record<string, unknown> | null;
  createdBy?:     string | null;
  createdByRole?: string | null;
}

/**
 * Append a ledger entry inside an existing transaction. Use this (never a
 * fire-and-forget variant) so the entry commits atomically with the state
 * change that produced it — a refund row and the booking update are all-or-
 * nothing.
 */
export async function recordLedgerEntryStrict(
  client: PoolClient,
  e: LedgerEntryInput
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_entries
       (club_id, entry_type, direction, amount, booking_id, payment_id,
        court_name, reason, metadata, created_by, created_by_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      e.clubId, e.entryType, e.direction, e.amount,
      e.bookingId ?? null, e.paymentId ?? null,
      e.courtName ?? null, e.reason ?? null,
      e.metadata ? JSON.stringify(e.metadata) : null,
      e.createdBy ?? null, e.createdByRole ?? null,
    ]
  );
  return rows[0].id;
}
