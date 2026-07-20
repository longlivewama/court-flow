/**
 * WhatsApp Service – outbound-only Meta WhatsApp Cloud API wrapper.
 *
 * Single trigger: the owner-approved booking confirmation, dispatched from the
 * verify-deposit use case AFTER the owner/receptionist approves the escrow
 * deposit on the dashboard ledger. No inbound webhooks, no chatbot flows,
 * no deposit-link reminders.
 *
 * Configuration (all server-side env):
 *   WHATSAPP_ACCESS_TOKEN         – Cloud API bearer token
 *   WHATSAPP_PHONE_NUMBER_ID      – sending phone-number ID
 *   WHATSAPP_API_VERSION          – Graph API version (default v20.0)
 *   WHATSAPP_DEFAULT_COUNTRY_CODE – prefix for local numbers with a leading 0
 *                                   (default 20, Egypt)
 */
import { query } from '../database/client';
import { logger } from '../../shared/logger';

const GRAPH_BASE = 'https://graph.facebook.com';
const API_VERSION = process.env.WHATSAPP_API_VERSION ?? 'v20.0';
const MAX_RETRIES = 3;

// Graph API codes that mean "throttled" – retried with back-off and logged
// distinctly so rate-limit pressure is visible in the logs.
const RATE_LIMIT_CODES = new Set([4, 80007, 130429]);

export interface OwnerConfirmedClientData {
  phone: string;
  name: string;
  courtName: string;
  timeslot: string;
}

interface GraphError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
}

interface GraphSendResponse {
  messages?: { id: string }[];
  error?: GraphError;
}

function isConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Normalise to the digits-only E.164 form the Cloud API expects.
 * A leading 0 (local format) is swapped for the default country code.
 * Returns null when the number is unusable.
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const cc = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? '20';
  const normalized = digits.startsWith('0') ? cc + digits.slice(1) : digits;
  return normalized.length >= 10 && normalized.length <= 15 ? normalized : null;
}

function buildConfirmationBody(opts: {
  clubName: string; name: string; courtName: string; timeslot: string; bookingRef: string;
}): string {
  return [
    `🏆 *${opts.clubName}* — Booking Confirmed`,
    '',
    `Dear ${opts.name}, your reservation has been reviewed and approved by the club.`,
    '',
    `📍 *Court:* ${opts.courtName}`,
    `🗓 *Session:* ${opts.timeslot}`,
    `🔖 *Booking Ref:* ${opts.bookingRef}`,
    '',
    '✅ *Check-in summary*',
    '• Deposit verified — your slot is secured on the club ledger',
    '• Remaining balance is settled at the front desk',
    '• Arrive 10 minutes early and quote your booking ref to check in',
    '',
    '_We look forward to hosting you courtside._',
  ].join('\n');
}

async function postWithRetry(to: string, body: string, attempt = 1): Promise<void> {
  const url = `${GRAPH_BASE}/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as GraphSendResponse;
  if (res.ok && payload.messages?.length) return;

  const graphErr = payload.error;
  const rateLimited = res.status === 429 || (graphErr && RATE_LIMIT_CODES.has(graphErr.code));

  if (rateLimited && attempt < MAX_RETRIES) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.pow(2, attempt) * 1000;
    logger.warn(
      { attempt, code: graphErr?.code, status: res.status },
      `WhatsApp API rate limited, retrying in ${delay}ms`
    );
    await new Promise((r) => setTimeout(r, delay));
    return postWithRetry(to, body, attempt + 1);
  }

  throw new Error(
    `WhatsApp send failed (HTTP ${res.status}): ${graphErr?.message ?? 'unknown Graph API error'}`
  );
}

export const whatsappService = {
  /**
   * Dispatch the premium booking confirmation to the member.
   * Call ONLY after the owner has approved the deposit on the dashboard
   * ledger (verify-deposit use case, 'approve' branch, post-commit).
   *
   * Returns true when the message was dispatched — the caller uses this to
   * annotate the Channel column of the Sheets backup ledger.
   */
  async sendOwnerConfirmedBooking(
    clubId: string,
    bookingId: string,
    clientData: OwnerConfirmedClientData
  ): Promise<boolean> {
    if (!isConfigured()) {
      logger.warn({ bookingId }, 'WhatsApp not configured; skipping confirmation dispatch');
      return false;
    }

    const to = normalizePhone(clientData.phone);
    if (!to) {
      logger.warn({ bookingId }, 'Member has no valid WhatsApp number on file; skipping dispatch');
      return false;
    }

    const clubs = await query<{ name: string }>(
      `SELECT name FROM clubs WHERE id = $1`,
      [clubId]
    );
    const clubName = clubs[0]?.name ?? 'CourtFlow';

    await postWithRetry(to, buildConfirmationBody({
      clubName,
      name: clientData.name,
      courtName: clientData.courtName,
      timeslot: clientData.timeslot,
      bookingRef: bookingId.slice(0, 8).toUpperCase(),
    }));

    logger.info({ bookingId, clubId }, 'Owner-confirmed booking dispatched via WhatsApp');
    return true;
  },
};
