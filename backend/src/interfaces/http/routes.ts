/**
 * API Route Registration
 * Maps all HTTP routes to controllers with RBAC middleware.
 */
import { Express, Router } from 'express';
import { authenticate, requireRole, loginLimiter, registerLimiter, passwordLimiter, uploadLimiter } from './middleware/auth.middleware';
import { requireTenant, requireClubResource } from './middleware/tenant.middleware';

// Controllers
import * as authCtrl    from './controllers/auth.controller';
import * as bookingCtrl from './controllers/booking.controller';
import * as courtCtrl   from './controllers/court.controller';
import * as reportCtrl  from './controllers/report.controller';
import * as auditCtrl   from './controllers/audit.controller';
import * as refundCtrl  from './controllers/refund.controller';
import * as equipmentCtrl    from './controllers/equipment.controller';
import * as subscriptionCtrl from './controllers/subscription.controller';
import * as paymentCtrl      from './controllers/payment.controller';
import * as analyticsCtrl    from './controllers/analytics.controller';
import * as expenseCtrl      from './controllers/expense.controller';
import * as financeCtrl      from './controllers/finance.controller';
import * as tournamentCtrl   from './controllers/tournament.controller';
import * as coachingCtrl     from './controllers/coaching.controller';
import * as lostFoundCtrl    from './controllers/lostfound.controller';
import * as webhookCtrl      from './controllers/payment-webhook.controller';
import * as waitlistCtrl     from './controllers/waitlist.controller';

export function registerRoutes(app: Express): void {
  // ── Health check ────────────────────────────────────────────
  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Auth routes ─────────────────────────────────────────────
  const auth = Router();
  auth.post('/register',      registerLimiter, authCtrl.register);
  auth.post('/register-club', registerLimiter, authCtrl.registerClub);
  auth.post('/verify-email',  authCtrl.verifyEmail);
  auth.post('/login',         loginLimiter, authCtrl.login);
  auth.post('/refresh',       authCtrl.refresh);
  auth.post('/logout',        authenticate, authCtrl.logout);
  app.use('/api/auth', auth);

  // ── Users (customer list for staff + teammate management) ─────
  const users = Router();
  users.use(authenticate, requireTenant);
  users.get('/', requireRole('receptionist', 'owner'), authCtrl.listCustomers);
  // /staff must be declared BEFORE any /:id route pattern
  users.get('/staff',            requireRole('owner'), authCtrl.listStaff);
  users.patch('/:id/status',     requireRole('owner'), requireClubResource('users'), authCtrl.setUserStatus);
  app.use('/api/users', users);

  // ── Equipment rental catalogue ────────────────────────────────
  const equipment = Router();
  equipment.use(authenticate, requireTenant);
  equipment.get('/',        equipmentCtrl.listEquipment);
  equipment.post('/',       requireRole('owner'), equipmentCtrl.createEquipment);
  equipment.patch('/:id',   requireRole('owner'), requireClubResource('equipment'), equipmentCtrl.updateEquipment);
  equipment.delete('/:id',  requireRole('owner'), requireClubResource('equipment'), equipmentCtrl.deleteEquipment);
  app.use('/api/equipment', equipment);

  // ── VIP weekly subscriptions ──────────────────────────────────
  const subscriptions = Router();
  subscriptions.use(authenticate, requireTenant);
  subscriptions.get('/',              subscriptionCtrl.listSubscriptions);
  subscriptions.post('/',             requireRole('customer', 'receptionist', 'owner', 'admin'), subscriptionCtrl.createSubscriptionHandler);
  subscriptions.patch('/:id/revoke',  requireRole('owner'), requireClubResource('subscriptions'), subscriptionCtrl.revokeSubscription);
  app.use('/api/subscriptions', subscriptions);

  // ── Payment gateway webhook ───────────────────────────────────
  // Unauthenticated by design (the gateway has no user session); secured by
  // HMAC signature + replay window + idempotency inside the handler. Must be
  // registered BEFORE the authenticated /api/payments router below.
  app.post('/api/payments/webhook', webhookCtrl.handlePaymentWebhook);

  // ── Payments ledger ───────────────────────────────────────────
  const payments = Router();
  payments.use(authenticate, requireTenant, requireRole('receptionist', 'owner'));
  payments.get('/', paymentCtrl.listPayments);
  app.use('/api/payments', payments);

  // ── Waitlist (anti-scalping) ──────────────────────────────────
  const waitlist = Router();
  waitlist.use(authenticate, requireTenant);
  waitlist.post('/',      requireRole('customer'), waitlistCtrl.joinWaitlist);
  waitlist.get('/me',     requireRole('customer'), waitlistCtrl.myWaitlist);
  waitlist.delete('/:id', requireRole('customer'), requireClubResource('waitlist_entries'), waitlistCtrl.leaveWaitlist);
  app.use('/api/waitlist', waitlist);

  // ── Analytics (owner only) ────────────────────────────────────
  const analytics = Router();
  analytics.use(authenticate, requireTenant, requireRole('owner'));
  analytics.get('/overview',   analyticsCtrl.getAnalyticsOverview);
  analytics.get('/financials', financeCtrl.getFinancials);
  app.use('/api/analytics', analytics);

  // ── Club expenses (owner only) ────────────────────────────────
  const expenses = Router();
  expenses.use(authenticate, requireTenant, requireRole('owner'));
  expenses.get('/',        expenseCtrl.listExpenses);
  expenses.post('/',       expenseCtrl.createExpense);
  expenses.patch('/:id',   requireClubResource('expenses'), expenseCtrl.updateExpense);
  expenses.delete('/:id',  requireClubResource('expenses'), expenseCtrl.deleteExpense);
  app.use('/api/expenses', expenses);

  // ── Tournaments & brackets ────────────────────────────────────
  const tournaments = Router();
  tournaments.use(authenticate, requireTenant);
  tournaments.get('/',                    tournamentCtrl.listTournaments);
  tournaments.post('/',                   requireRole('owner'), tournamentCtrl.createTournament);
  tournaments.get('/:id',                 requireClubResource('tournaments'), tournamentCtrl.getTournament);
  tournaments.patch('/:id',               requireRole('owner'), requireClubResource('tournaments'), tournamentCtrl.updateTournament);
  tournaments.post('/:id/teams',          requireRole('customer', 'receptionist', 'owner', 'admin'), requireClubResource('tournaments'), tournamentCtrl.registerTeam);
  tournaments.post('/:id/teams/:teamId/pay', requireRole('customer', 'receptionist', 'owner', 'admin'), requireClubResource('tournaments'), tournamentCtrl.recordTeamPayment);
  tournaments.post('/:id/bracket',        requireRole('owner'), requireClubResource('tournaments'), tournamentCtrl.generateBracket);
  tournaments.patch('/:id/matches/:matchId', requireRole('owner'), requireClubResource('tournaments'), tournamentCtrl.recordMatchResult);
  app.use('/api/tournaments', tournaments);

  // ── Coaching & training ledger ────────────────────────────────
  const coaching = Router();
  coaching.use(authenticate, requireTenant);
  // Coach viewport: own profile + allocated sessions + personal earnings only.
  // Coaches deliberately do NOT get /coaches or /sessions — those expose the
  // club-wide ledger (club_share, other coaches' payouts).
  coaching.get('/me',             requireRole('coach', 'owner'), coachingCtrl.getMyCoachingView);
  coaching.get('/coaches',        requireRole('receptionist', 'owner'), coachingCtrl.listCoaches);
  coaching.post('/coaches',       requireRole('owner'), coachingCtrl.createCoach);
  coaching.patch('/coaches/:id',  requireRole('owner'), requireClubResource('coaches'), coachingCtrl.updateCoach);
  coaching.get('/sessions',       requireRole('receptionist', 'owner'), coachingCtrl.listSessions);
  coaching.post('/sessions',      requireRole('receptionist', 'owner'), coachingCtrl.createSession);
  coaching.patch('/sessions/:id', requireRole('receptionist', 'owner'), requireClubResource('training_sessions'), coachingCtrl.updateSession);
  coaching.post('/sessions/:id/pay', requireRole('receptionist', 'owner'), requireClubResource('training_sessions'), coachingCtrl.markSessionPaid);
  app.use('/api/coaching', coaching);

  // ── Lost & Found board ────────────────────────────────────────
  const lostFound = Router();
  lostFound.use(authenticate, requireTenant);
  lostFound.get('/',           lostFoundCtrl.listItems);
  lostFound.post('/',          requireRole('receptionist', 'owner'), uploadLimiter, lostFoundCtrl.photoUploadMiddleware, lostFoundCtrl.createItem);
  lostFound.get('/:id/photo',  requireClubResource('lost_found_items'), lostFoundCtrl.getItemPhoto);
  lostFound.patch('/:id',      requireRole('receptionist', 'owner'), requireClubResource('lost_found_items'), lostFoundCtrl.updateItem);
  lostFound.post('/:id/claims',  requireRole('customer'), requireClubResource('lost_found_items'), lostFoundCtrl.submitClaim);
  lostFound.get('/:id/claims',   requireRole('receptionist', 'owner'), requireClubResource('lost_found_items'), lostFoundCtrl.listClaims);
  lostFound.patch('/:id/claims/:claimId', requireRole('receptionist', 'owner'), requireClubResource('lost_found_items'), lostFoundCtrl.decideClaim);
  app.use('/api/lost-found', lostFound);

  // ── Booking routes ──────────────────────────────────────────
  const bookings = Router();
  bookings.use(authenticate, requireTenant);
  bookings.get('/',                 requireRole('customer', 'receptionist', 'owner', 'admin'), bookingCtrl.listBookings);
  // /me must be declared BEFORE /:id so it isn't matched as a booking id
  bookings.get('/me',               requireRole('customer', 'receptionist', 'owner', 'admin'), bookingCtrl.listBookings);
  // financial-summary must also be declared BEFORE /:id
  bookings.get('/financial-summary',  requireRole('receptionist', 'owner'), bookingCtrl.getFinancialSummary);
  // analytics-plots must also be declared BEFORE /:id
  bookings.get('/analytics-plots',    requireRole('owner'), bookingCtrl.getAnalyticsPlots);
  bookings.post('/',                requireRole('customer', 'receptionist', 'owner', 'admin'), bookingCtrl.createBookingHandler);
  bookings.get('/:id',              requireClubResource('bookings'), bookingCtrl.getBooking);
  bookings.post('/:id/receipt',
    requireRole('customer'),
    requireClubResource('bookings'),
    uploadLimiter,
    bookingCtrl.receiptUploadMiddleware,
    bookingCtrl.uploadReceiptHandler
  );
  // View the uploaded receipt (staff verify any; customers only their own — enforced in handler)
  bookings.get('/:id/receipt', requireClubResource('bookings'), bookingCtrl.getReceiptHandler);
  bookings.patch('/:id/verify',   requireRole('receptionist', 'owner'), requireClubResource('bookings'), bookingCtrl.verifyDepositHandler);
  bookings.patch('/:id/checkin',  requireRole('receptionist', 'owner'), requireClubResource('bookings'), bookingCtrl.checkinHandler);
  bookings.patch('/:id/cancel',   requireClubResource('bookings'), bookingCtrl.cancelBookingHandler);
  bookings.patch('/:id/settle',   requireRole('receptionist', 'owner'), requireClubResource('bookings'), bookingCtrl.settlePaymentHandler);
  // Permanent deletion — the most destructive endpoint in the API, owner only
  bookings.delete('/:id',         requireRole('owner'), requireClubResource('bookings'), bookingCtrl.deleteBookingHandler);
  app.use('/api/bookings', bookings);


  // ── Court routes ─────────────────────────────────────────────
  const courts = Router();
  courts.use(authenticate, requireTenant);
  courts.get('/',      courtCtrl.listCourts);
  // Must be declared BEFORE /:id so 'availability-grid' isn't matched as a court id
  courts.get('/availability-grid', courtCtrl.getAvailabilityGrid);
  courts.get('/:id',   requireClubResource('courts'), courtCtrl.getCourt);
  courts.post('/',     requireRole('owner'), courtCtrl.createCourt);
  courts.patch('/:id', requireRole('owner'), requireClubResource('courts'), courtCtrl.updateCourt);
  courts.delete('/:id',requireRole('owner'), requireClubResource('courts'), courtCtrl.deleteCourt);

  courts.get('/:id/availability', requireClubResource('courts'), courtCtrl.getCourtAvailability);
  courts.post('/blocked-periods', requireRole('owner'), courtCtrl.createBlockedPeriod);
  courts.delete('/blocked-periods/:bpId', requireRole('owner'), requireClubResource('blocked_periods', 'bpId'), courtCtrl.deleteBlockedPeriod);
  app.use('/api/courts', courts);

  // ── Refund routes ─────────────────────────────────────────────
  const refunds = Router();
  refunds.use(authenticate, requireTenant);
  refunds.post('/',          requireRole('receptionist'), refundCtrl.createRefundRequest);
  refunds.get('/',           requireRole('owner', 'receptionist'), refundCtrl.listRefunds);
  refunds.patch('/:id',      requireRole('owner'), requireClubResource('refunds'), refundCtrl.approveOrRejectRefund);
  app.use('/api/refunds', refunds);

  // ── Report routes (owner only) ──────────────────────────────
  const reports = Router();
  reports.use(authenticate, requireTenant, requireRole('owner'));
  reports.post('/generate',  reportCtrl.generateReport);
  reports.get('/',           reportCtrl.listReports);
  reports.get('/:id/download', requireClubResource('report_jobs'), reportCtrl.downloadReport);
  app.use('/api/reports', reports);

  // ── Audit log routes (owner only) ───────────────────────────
  const audit = Router();
  audit.use(authenticate, requireTenant, requireRole('owner'));
  audit.get('/',  auditCtrl.listAuditLogs);
  app.use('/api/audit', audit);

  // ── Club settings ──────────────────────────────
  const settings = Router();
  settings.use(authenticate, requireTenant);
  settings.get('/',                      requireRole('owner'), courtCtrl.getClubSettings);
  settings.patch('/',                    requireRole('owner'), courtCtrl.updateClubSettings);
  // We need to un-protect settings root for these specific routes if settings router requires owner, or just add the roles
  settings.get('/working-hours',         requireRole('customer', 'receptionist', 'owner', 'admin'), courtCtrl.getWorkingHours);
  settings.put('/working-hours',         requireRole('owner', 'admin'), courtCtrl.upsertWorkingHours);
  app.use('/api/settings', settings);

  // ── Dashboard data endpoints ─────────────────────────────────
  const dashboard = Router();
  dashboard.use(authenticate, requireTenant);
  dashboard.get('/today',   requireRole('owner', 'receptionist'), bookingCtrl.listBookings);
  // Staff-only: exposes every customer's name/phone/email + admin_notes for the
  // day. Must NOT be reachable by a customer token (BOLA / PII disclosure).
  dashboard.get('/schedule', requireRole('owner', 'receptionist'), courtCtrl.getDailySchedule);
  app.use('/api/dashboard', dashboard);
}
