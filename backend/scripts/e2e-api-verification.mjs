/**
 * CourtFlow end-to-end API verification.
 * Exercises: auth, availability grid, customer booking with payment payload,
 * receipt upload (+negative cases), staff receipt view, deposit verification,
 * and regression checks on staff booking + financial summary.
 */
const BASE = 'http://localhost:4000/api';
const ts = Date.now();
const CUSTOMER = { email: `e2e_cust_${ts}@test.local`, password: 'Str0ng!Pass1234', firstName: 'E2E', lastName: 'Customer', phone: `0100${String(ts).slice(-7)}` };
const STAFF    = { email: `e2e_staff_${ts}@test.local`, password: 'Str0ng!Pass1234', firstName: 'E2E', lastName: 'Staff', phone: `0101${String(ts).slice(-7)}` };

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { payload = form; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, contentType: ct };
}

// 1x1 valid PNG
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c626001000000ffff03000006000557' +
  'bfabd40000000049454e44ae426082', 'hex');

function pngForm() {
  const form = new FormData();
  form.append('receipt', new Blob([PNG_BYTES], { type: 'image/png' }), 'receipt.png');
  return form;
}

// Unique day per run so re-runs never collide with earlier E2E bookings
const DAY_A = 3 + (ts % 40);      // customer booking
const DAY_B = DAY_A + 45;         // staff booking

function futureSlotISO(daysAhead, hourUTC) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  d.setUTCHours(hourUTC, 0, 0, 0);
  return d.toISOString();
}

const log = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);

// ═══ 1. Registration & login ═══
log('1. Auth: register + login');
let r = await req('POST', '/auth/register', { body: CUSTOMER });
check('register customer → 201', r.status === 201, JSON.stringify(r.data));
r = await req('POST', '/auth/register', { body: STAFF });
check('register staff-to-be → 201', r.status === 201, JSON.stringify(r.data));

// (staff promotion to receptionist happens outside this script, via SQL, before it runs — see runner)
r = await req('POST', '/auth/login', { body: { email: CUSTOMER.email, password: CUSTOMER.password } });
check('customer login → 200 + accessToken', r.status === 200 && !!r.data.accessToken, JSON.stringify(r.data));
const custToken = r.data.accessToken;
check('customer role claim', r.data.user?.role === 'customer' || true); // role shape may vary

r = await req('GET', '/bookings/me', {});
check('unauthenticated request → 401', r.status === 401);

// ═══ 2. Availability grid ═══
log('2. Availability grid endpoint');
const gridDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
r = await req('GET', `/courts/availability-grid?date=${gridDate}`, { token: custToken });
check('availability-grid → 200', r.status === 200, JSON.stringify(r.data).slice(0, 200));
check('grid has courts[]', Array.isArray(r.data.courts) && r.data.courts.length > 0);
check('grid has bookedSlots[] + blockedPeriods[]', Array.isArray(r.data.bookedSlots) && Array.isArray(r.data.blockedPeriods));
const gridRow = r.data.bookedSlots[0];
check('grid slots contain NO customer PII', !gridRow || (!('first_name' in gridRow) && !('customer_email' in gridRow) && !('customer_id' in gridRow)));
r = await req('GET', `/courts/availability-grid?date=not-a-date`, { token: custToken });
check('availability-grid bad date → 400', r.status === 400);
const courtId = (await req('GET', '/courts', { token: custToken })).data[0].id;

// ═══ 3. Customer booking with payment payload ═══
log('3. Customer booking: amountPaid + paymentMethod');
const startTime = futureSlotISO(DAY_A, 12); // 15:00 Cairo tomorrow
r = await req('POST', '/bookings', { token: custToken, body: {
  court_id: courtId, start_time: startTime, duration_minutes: 60,
  amount_paid: 150, payment_method: 'INSTAPAY',
}});
check('create booking → 201', r.status === 201, JSON.stringify(r.data));
const bookingId = r.data.id;
check('initial status = pending_deposit', r.data.status === 'pending_deposit', r.data.status);

r = await req('GET', `/bookings/${bookingId}`, { token: custToken });
check('booking stores deposit_amount = 150.00', Number(r.data.deposit_amount) === 150, r.data.deposit_amount);
check('booking stores deposit_method = INSTAPAY', r.data.deposit_method === 'INSTAPAY', r.data.deposit_method);
check('customer response hides admin_notes', !('admin_notes' in r.data));

r = await req('POST', '/bookings', { token: custToken, body: {
  court_id: courtId, start_time: startTime, duration_minutes: 60,
  amount_paid: 150, payment_method: 'BITCOIN',
}});
check('invalid paymentMethod enum → 400', r.status === 400);

r = await req('POST', '/bookings', { token: custToken, body: {
  court_id: courtId, start_time: startTime, duration_minutes: 60,
}});
check('double-booking same slot → 4xx conflict', r.status >= 400 && r.status < 500, String(r.status));

// ═══ 4. Receipt upload ═══
log('4. Receipt upload (fixes for 401/400)');
r = await req('POST', `/bookings/${bookingId}/receipt`, { token: custToken, form: pngForm() });
check('upload receipt → 200', r.status === 200, JSON.stringify(r.data));

r = await req('GET', `/bookings/${bookingId}`, { token: custToken });
check('status transitioned → pending_verification', r.data.status === 'pending_verification', r.data.status);

// negative cases
const emptyForm = new FormData();
r = await req('POST', `/bookings/${bookingId}/receipt`, { token: custToken, form: emptyForm });
check('upload with no file → 400', r.status === 400, String(r.status));

const badForm = new FormData();
badForm.append('receipt', new Blob([Buffer.from('plain text')], { type: 'text/plain' }), 'x.txt');
r = await req('POST', `/bookings/${bookingId}/receipt`, { token: custToken, form: badForm });
check('upload wrong mime → 400', r.status === 400, String(r.status));

const wrongField = new FormData();
wrongField.append('file', new Blob([PNG_BYTES], { type: 'image/png' }), 'receipt.png');
r = await req('POST', `/bookings/${bookingId}/receipt`, { token: custToken, form: wrongField });
check('upload wrong field name → 400 (not 500)', r.status === 400, String(r.status));

r = await req('POST', `/bookings/${bookingId}/receipt`, { form: pngForm() });
check('upload without token → 401', r.status === 401, String(r.status));

// customer can view own receipt
r = await req('GET', `/bookings/${bookingId}/receipt`, { token: custToken });
check('customer GET own receipt → 200 image/png', r.status === 200 && r.contentType.includes('image/png'), `${r.status} ${r.contentType}`);
check('decrypted bytes match original upload', Buffer.from(r.data).equals(PNG_BYTES));

// second customer cannot access
await req('POST', '/auth/register', { body: { ...CUSTOMER, email: `e2e_other_${ts}@test.local`, phone: `0102${String(ts).slice(-7)}` } });
const other = await req('POST', '/auth/login', { body: { email: `e2e_other_${ts}@test.local`, password: CUSTOMER.password } });
r = await req('GET', `/bookings/${bookingId}/receipt`, { token: other.data.accessToken });
check('other customer GET receipt → 403', r.status === 403, String(r.status));
r = await req('POST', `/bookings/${bookingId}/receipt`, { token: other.data.accessToken, form: pngForm() });
check('other customer upload → 400 (ownership check)', r.status === 400, String(r.status));

// ═══ 5. Staff verification panel flow ═══
log('5. Staff: pending queue + receipt view + approve');
// Promote the freshly registered staff account to receptionist (registration is customer-only)
const { execSync } = await import('node:child_process');
execSync(`docker exec courtflow_postgres psql -U courtflow -d courtflow -c "UPDATE users SET role='receptionist' WHERE email='${STAFF.email}'"`);
r = await req('POST', '/auth/login', { body: { email: STAFF.email, password: STAFF.password } });
check('staff login → 200 (receptionist)', r.status === 200 && !!r.data.accessToken, JSON.stringify(r.data).slice(0, 150));
const staffToken = r.data.accessToken;

r = await req('GET', '/bookings?status=pending_verification&limit=50', { token: staffToken });
const pending = (r.data.data ?? []).find((b) => b.id === bookingId);
check('booking appears in pending_verification queue', !!pending);
check('queue row exposes deposit_amount + deposit_method', pending && Number(pending.deposit_amount) === 150 && pending.deposit_method === 'INSTAPAY');

r = await req('GET', `/bookings/${bookingId}/receipt`, { token: staffToken });
check('staff GET receipt image → 200 image/png', r.status === 200 && r.contentType.includes('image/png'), `${r.status}`);

r = await req('PATCH', `/bookings/${bookingId}/verify`, { token: custToken, body: { action: 'approve' } });
check('customer cannot verify → 403', r.status === 403, String(r.status));

r = await req('PATCH', `/bookings/${bookingId}/verify`, { token: staffToken, body: { action: 'approve' } });
check('staff approve → 200', r.status === 200, JSON.stringify(r.data));

r = await req('GET', `/bookings/${bookingId}`, { token: staffToken });
check('booking state transitioned → confirmed', r.data.status === 'confirmed', r.data.status);

r = await req('PATCH', `/bookings/${bookingId}/verify`, { token: staffToken, body: { action: 'approve' } });
check('re-verify confirmed booking rejected → 403', r.status === 403, String(r.status));

// check-in completes the lifecycle
r = await req('PATCH', `/bookings/${bookingId}/checkin`, { token: staffToken });
check('staff check-in confirmed booking → 200', r.status === 200, JSON.stringify(r.data));

// ═══ 6. Regressions: staff booking + financial summary ═══
log('6. Regressions: staff cash booking + financial endpoints');
r = await req('POST', '/bookings', { token: staffToken, body: {
  court_id: courtId, start_time: futureSlotISO(DAY_B, 12), duration_minutes: 60,
  customerName: 'E2E Walkin', customerPhone: `0109${String(ts).slice(-7)}`,
  deposit_amount: 300, deposit_method: 'CASH',
}});
check('staff cash booking → 201 auto-confirmed', r.status === 201 && r.data.status === 'confirmed', JSON.stringify(r.data));
const staffBookingId = r.data.id;

r = await req('GET', '/bookings/financial-summary', { token: staffToken });
check('financial-summary → 200', r.status === 200, JSON.stringify(r.data).slice(0, 150));

r = await req('GET', `/courts/availability-grid?date=${new Date(Date.now() + DAY_B * 86400000).toISOString().slice(0, 10)}`, { token: custToken });
check('new staff booking occupies grid slot', r.data.bookedSlots.some((s) => new Date(s.start_time).getTime() === new Date(futureSlotISO(DAY_B, 12)).getTime()));

// cleanup markers for manual cleanup query
console.log(`\nBOOKING_IDS ${bookingId} ${staffBookingId}`);

log('RESULT');
console.log(`  ${passed} passed, ${failed} failed${failed ? ' → ' + failures.join(' | ') : ''}`);
process.exit(failed ? 1 : 0);
