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

export const sheetsService = {
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
    if (!isConfigured()) {
      logger.debug({ bookingId }, 'Google Sheets not configured; skipping ledger sync');
      return;
    }

    const clubs = await query<{ sheets_spreadsheet_id: string | null }>(
      `SELECT sheets_spreadsheet_id FROM clubs WHERE id = $1`,
      [clubId]
    );
    const spreadsheetId = clubs[0]?.sheets_spreadsheet_id;
    if (!spreadsheetId) {
      logger.debug({ clubId, bookingId }, 'Club has no connected spreadsheet; skipping ledger sync');
      return;
    }

    const tab = process.env.GOOGLE_SHEETS_TAB ?? 'Bookings';
    const bookingRef = bookingId.slice(0, 8).toUpperCase();
    const values = [
      bookingRef, 'CONFIRMED', row.name, row.phone,
      row.courtName, row.timeslot, row.confirmedAt, row.channel,
    ];

    // Locate an existing row for this booking (column A holds the refs).
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

    logger.info({ bookingId, clubId }, 'Owner-confirmed booking synced to club ledger spreadsheet');
  },
};
