/**
 * Google Sheets Service – real-time operational backup ledger.
 *
 * Every owner-approved booking is upserted as one row into the club's
 * connected spreadsheet (clubs.sheets_spreadsheet_id, migration 015) so
 * front-desk staff see all owner-approved matches instantly — the Channel
 * column records whether the WhatsApp notification was dispatched, skipped,
 * or failed. Clubs without a connected sheet are skipped silently.
 *
 * Auth is the official service-account flow against the Sheets v4 REST API:
 * a locally signed RS256 JWT (via the existing jsonwebtoken dependency) is
 * exchanged for a short-lived access token — no extra SDK dependency.
 *
 * Configuration (all server-side env):
 *   GOOGLE_SHEETS_CLIENT_EMAIL – service-account email (sheet shared with it)
 *   GOOGLE_SHEETS_PRIVATE_KEY  – service-account PEM key ('\n' escapes allowed)
 *   GOOGLE_SHEETS_TAB          – worksheet tab name (default Bookings)
 */
import jwt from 'jsonwebtoken';
import { query } from '../database/client';
import { logger } from '../../shared/logger';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const MAX_RETRIES = 3;

const HEADER_ROW = [
  'Booking Ref', 'Status', 'Member', 'Phone', 'Court', 'Session', 'Confirmed At', 'Channel',
];

export interface LedgerBookingRow {
  name: string;
  phone: string;
  courtName: string;
  timeslot: string;
  confirmedAt: string;
  channel: string;
}

function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY);
}

// Sheets evaluates USER_ENTERED cells starting with =, +, -, or @ as formulas
// (CWE-1236). Member-supplied fields (name, phone) must be neutralized before
// they reach the API so a crafted first name can't execute a formula in
// front-desk staff's spreadsheet.
function neutralizeFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

// ── Service-account access token, cached until shortly before expiry ──────
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;

  const privateKey = (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const assertion = jwt.sign(
    { scope: SCOPE },
    privateKey,
    {
      algorithm: 'RS256',
      issuer: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      audience: TOKEN_URL,
      expiresIn: '1h',
    }
  );

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token exchange failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function sheetsFetch(path: string, init: RequestInit, attempt = 1): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    const delay = Math.pow(2, attempt) * 1000;
    logger.warn({ attempt, path }, `Google Sheets API rate limited, retrying in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
    return sheetsFetch(path, init, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Sheets API error (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Resolve the club's connected spreadsheet, or null when the sync should be
// skipped silently (Sheets not configured, or the club has no sheet linked).
async function resolveSpreadsheetId(clubId: string, bookingId: string): Promise<string | null> {
  if (!isConfigured()) {
    logger.debug({ bookingId }, 'Google Sheets not configured; skipping ledger sync');
    return null;
  }

  const clubs = await query<{ sheets_spreadsheet_id: string | null }>(
    `SELECT sheets_spreadsheet_id FROM clubs WHERE id = $1`,
    [clubId]
  );
  const spreadsheetId = clubs[0]?.sheets_spreadsheet_id;
  if (!spreadsheetId) {
    logger.debug({ clubId, bookingId }, 'Club has no connected spreadsheet; skipping ledger sync');
    return null;
  }
  return spreadsheetId;
}

// Build the 8-column ledger row. The member-supplied name/phone are the only
// untrusted cells, so they alone pass through neutralizeFormula — everything
// else is server-derived and safe.
function buildLedgerValues(bookingRef: string, status: string, row: LedgerBookingRow): string[] {
  return [
    bookingRef, status, neutralizeFormula(row.name), neutralizeFormula(row.phone),
    row.courtName, row.timeslot, row.confirmedAt, row.channel,
  ];
}

// Upsert a row keyed on Booking Ref (column A): an existing row is updated in
// place, otherwise it is appended (with a header row on the sheet's first write).
async function upsertByRef(
  spreadsheetId: string,
  tab: string,
  bookingRef: string,
  values: string[]
): Promise<void> {
  const existing = (await sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(`${tab}!A:A`)}`,
    { method: 'GET' }
  )) as { values?: string[][] };
  const refs = existing.values ?? [];
  const rowIndex = refs.findIndex((cells) => cells[0] === bookingRef);

  if (rowIndex >= 0) {
    const range = `${tab}!A${rowIndex + 1}:H${rowIndex + 1}`;
    await sheetsFetch(
      `/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values: [values] }) }
    );
  } else {
    const rows = refs.length === 0 ? [HEADER_ROW, values] : [values];
    await sheetsFetch(
      `/${spreadsheetId}/values/${encodeURIComponent(`${tab}!A:H`)}:append` +
        `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: rows }) }
    );
  }
}

export const sheetsService = {
  /**
   * Mirror a freshly-created booking into the club's fail-safe ledger with a
   * 'PENDING_APPROVAL' status, the instant it is booked — so owners/staff see
   * every reservation in the backup sheet even before the deposit is verified
   * (and even if the main server later drops). Upserts on Booking Ref, so the
   * later owner-approval sync updates this same row in place rather than
   * duplicating it.
   */
  async syncPendingBooking(
    clubId: string,
    bookingId: string,
    row: LedgerBookingRow
  ): Promise<void> {
    const spreadsheetId = await resolveSpreadsheetId(clubId, bookingId);
    if (!spreadsheetId) return;

    const tab = process.env.GOOGLE_SHEETS_TAB ?? 'Bookings';
    const bookingRef = bookingId.slice(0, 8).toUpperCase();
    await upsertByRef(spreadsheetId, tab, bookingRef, buildLedgerValues(bookingRef, 'PENDING_APPROVAL', row));

    logger.info({ bookingId, clubId }, 'Pending booking mirrored to club fail-safe ledger spreadsheet');
  },

  /**
   * Upsert the owner-approved booking into the club's connected spreadsheet.
   * Keyed on Booking Ref (column A): an existing row is updated in place,
   * otherwise the row is appended (with a header row on first write).
   */
  async syncOwnerConfirmedBooking(
    clubId: string,
    bookingId: string,
    row: LedgerBookingRow
  ): Promise<void> {
    const spreadsheetId = await resolveSpreadsheetId(clubId, bookingId);
    if (!spreadsheetId) return;

    const tab = process.env.GOOGLE_SHEETS_TAB ?? 'Bookings';
    const bookingRef = bookingId.slice(0, 8).toUpperCase();
    await upsertByRef(spreadsheetId, tab, bookingRef, buildLedgerValues(bookingRef, 'CONFIRMED', row));

    logger.info({ bookingId, clubId }, 'Owner-confirmed booking synced to club ledger spreadsheet');
  },
};
