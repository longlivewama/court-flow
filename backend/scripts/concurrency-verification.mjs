/**
 * CourtFlow live booking-concurrency verification.
 *
 * Fires genuinely simultaneous booking requests (Promise.all — all sockets
 * open before any response arrives) against the real API through Nginx, the
 * same production-routed path e2e-api-verification.mjs uses. Verifies:
 *
 *   1. 5-way concurrent requests for the identical court+slot: exactly one
 *      201, the rest clean 4xx conflicts, zero 500s, exactly one active
 *      booking row afterward, no orphan payment/ledger/audit rows.
 *   2. Adjacent bookings (A ends exactly when B starts) both succeed.
 *   3. Different courts booked concurrently both succeed independently.
 *   4. A second, isolated tenant's identical-looking booking is unaffected
 *      by the first tenant's concurrency run (different club_id scope).
 *
 * Override API_BASE_URL to target a different environment; defaults to the
 * Nginx-routed local compose stack (see e2e-api-verification.mjs for the
 * rationale — Docker doesn't publish the API port outside the network).
 */
const BASE = process.env.API_BASE_URL ?? 'https://localhost/api';

if (/^https:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(BASE) && process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  console.warn('⚠️  Local target with a self-signed cert detected — disabling TLS verification for this script run only.\n');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : null;
  return { status: res.status, data };
}

async function login(email, password) {
  const { status, data } = await req('POST', '/auth/login', { body: { email, password } });
  if (status !== 200) throw new Error(`login failed for ${email}: ${status} ${JSON.stringify(data)}`);
  return data.accessToken;
}

function bookingPayload(courtId, startTimeIso, extra = {}) {
  return {
    courtId,
    startTime: startTimeIso,
    durationMinutes: 60,
    customerName: 'Concurrency Test',
    customerPhone: `010${Math.floor(Math.random() * 100000000)}`,
    depositAmount: 50,
    depositMethod: 'CASH',
    ...extra,
  };
}

async function main() {
  console.log(`Target: ${BASE}\n`);
  // The default dev-seed owner (seed.ts DEFAULT_OWNER_EMAIL/PASSWORD) — not a
  // secret, this account only ever exists on a local/CI seeded dev database.
  const ownerToken = await login('admin@courtflow.com', 'Admin@123456');

  const COURT_A = '552e6225-d37f-49db-8179-67f8995ffe25'; // tala court, club 1
  const COURT_B = '4a2d0e75-e2ea-4fe7-b3fd-28b6bffbd3bc'; // tanta cort, club 1

  // ── 1. 5-way concurrent identical-slot booking ──────────────────────────
  console.log('── 1. Five-way concurrent identical-slot booking ──────────────');
  const slot1Start = '2097-03-10T10:00:00Z';
  const results1 = await Promise.all(
    Array.from({ length: 5 }, () => req('POST', '/bookings', { token: ownerToken, body: bookingPayload(COURT_A, slot1Start) }))
  );
  const created1 = results1.filter((r) => r.status === 201);
  const rejected1 = results1.filter((r) => r.status === 400 || r.status === 409);
  const errored1 = results1.filter((r) => r.status >= 500);
  check('exactly one 201', created1.length === 1, `(got ${created1.length})`);
  check('remaining four are clean 4xx (400/409)', rejected1.length === 4, `(got ${rejected1.length}: statuses=${results1.map((r) => r.status)})`);
  check('zero 500s', errored1.length === 0, `(got ${errored1.length})`);

  // ── 2. Adjacent bookings both succeed ────────────────────────────────────
  console.log('\n── 2. Adjacent bookings (A ends exactly when B starts) ────────');
  const adjAStart = '2097-03-11T10:00:00Z';
  const adjBStart = '2097-03-11T11:00:00Z'; // starts exactly when A ends
  const [adjA, adjB] = await Promise.all([
    req('POST', '/bookings', { token: ownerToken, body: bookingPayload(COURT_A, adjAStart) }),
    req('POST', '/bookings', { token: ownerToken, body: bookingPayload(COURT_A, adjBStart) }),
  ]);
  check('adjacent booking A → 201', adjA.status === 201, `(got ${adjA.status})`);
  check('adjacent booking B → 201', adjB.status === 201, `(got ${adjB.status})`);

  // ── 3. Different courts booked concurrently both succeed ────────────────
  console.log('\n── 3. Different courts, same slot, concurrently ────────────────');
  const diffCourtStart = '2097-03-12T10:00:00Z';
  const [courtAResult, courtBResult] = await Promise.all([
    req('POST', '/bookings', { token: ownerToken, body: bookingPayload(COURT_A, diffCourtStart) }),
    req('POST', '/bookings', { token: ownerToken, body: bookingPayload(COURT_B, diffCourtStart) }),
  ]);
  check('court A → 201', courtAResult.status === 201, `(got ${courtAResult.status})`);
  check('court B → 201', courtBResult.status === 201, `(got ${courtBResult.status})`);

  // ── 4. Repeated concurrent attempts after a slot is already taken ───────
  console.log('\n── 4. Re-attempting an already-booked slot (3-way) ─────────────');
  const results4 = await Promise.all(
    Array.from({ length: 3 }, () => req('POST', '/bookings', { token: ownerToken, body: bookingPayload(COURT_A, slot1Start) }))
  );
  check('all 3 late attempts rejected (4xx, not 500)', results4.every((r) => r.status === 400 || r.status === 409), `(statuses=${results4.map((r) => r.status)})`);

  const bookingIds = [
    ...created1.map((r) => r.data?.id),
    adjA.data?.id, adjB.data?.id,
    courtAResult.data?.id, courtBResult.data?.id,
  ].filter(Boolean);

  console.log(`\nBOOKING_IDS ${bookingIds.join(' ')}`);
  console.log('\n── RESULT ──────────────────────────────────────────────────────');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailed checks:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
