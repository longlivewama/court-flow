/**
 * API Route Registration
 * Maps all HTTP routes to controllers with RBAC middleware.
 */
import { Express, Router } from 'express';
import { authenticate, requireRole, loginLimiter, registerLimiter, passwordLimiter, uploadLimiter } from './middleware/auth.middleware';

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
  auth.post('/verify-email',  authCtrl.verifyEmail);
  auth.post('/login',         loginLimiter, authCtrl.login);
  auth.post('/refresh',       authCtrl.refresh);
  auth.post('/logout',        authenticate, authCtrl.logout);
  app.use('/api/auth', auth);

  // ── Users (customer list for staff + teammate management) ─────
  const users = Router();
  users.use(authenticate);
  users.get('/', requireRole('receptionist', 'owner'), authCtrl.listCustomers);
  // /staff must be declared BEFORE any /:id route pattern
  users.get('/staff',            requireRole('owner'), authCtrl.listStaff);
  users.patch('/:id/status',     requireRole('owner'), authCtrl.setUserStatus);
  app.use('/api/users', users);

  // ── Equipment rental catalogue ────────────────────────────────
  const equipment = Router();
  equipment.use(authenticate);
  equipment.get('/',        equipmentCtrl.listEquipment);
  equipment.post('/',       requireRole('owner'), equipmentCtrl.createEquipment);
  equipment.patch('/:id',   requireRole('owner'), equipmentCtrl.updateEquipment);
  equipment.delete('/:id',  requireRole('owner'), equipmentCtrl.deleteEquipment);
  app.use('/api/equipment', equipment);

  // ── VIP weekly subscriptions ──────────────────────────────────
  const subscriptions = Router();
  subscriptions.use(authenticate);
  subscriptions.get('/',              subscriptionCtrl.listSubscriptions);
  subscriptions.post('/',             requireRole('customer', 'receptionist', 'owner', 'admin'), subscriptionCtrl.createSubscriptionHandler);
  subscriptions.patch('/:id/revoke',  requireRole('owner'), subscriptionCtrl.revokeSubscription);
  app.use('/api/subscriptions', subscriptions);

  // ── Payment gateway webhook ───────────────────────────────────
  // Unauthenticated by design (the gateway has no user session); secured by
  // HMAC signature + replay window + idempotency inside the handler. Must be
  // registered BEFORE the authenticated /api/payments router below.
  app.post('/api/payments/webhook', webhookCtrl.handlePaymentWebhook);

  // ── Payments ledger ───────────────────────────────────────────
  const payments = Router();
  payments.use(authenticate, requireRole('receptionist', 'owner'));
  payments.get('/', paymentCtrl.listPayments);
  app.use('/api/payments', payments);

  // ── Waitlist (anti-scalping) ──────────────────────────────────
  const waitlist = Router();
  waitlist.use(authenticate);
  waitlist.post('/',      requireRole('customer'), waitlistCtrl.joinWaitlist);
  waitlist.get('/me',     requireRole('customer'), waitlistCtrl.myWaitlist);
  waitlist.delete('/:id', requireRole('customer'), waitlistCtrl.leaveWaitlist);
  app.use('/api/waitlist', waitlist);

  // ── Analytics (owner only) ────────────────────────────────────
  const analytics = Router();
  analytics.use(authenticate, requireRole('owner'));
  analytics.get('/overview',   analyticsCtrl.getAnalyticsOverview);
  analytics.get('/financials', financeCtrl.getFinancials);
  app.use('/api/analytics', analytics);

  // ── Club expenses (owner only) ────────────────────────────────
  const expenses = Router();
  expenses.use(authenticate, requireRole('owner'));
  expenses.get('/',        expenseCtrl.listExpenses);
  expenses.post('/',       expenseCtrl.createExpense);
  expenses.patch('/:id',   expenseCtrl.updateExpense);
  expenses.delete('/:id',  expenseCtrl.deleteExpense);
  app.use('/api/expenses', expenses);

  // ── Tournaments & brackets ────────────────────────────────────
  const tournaments = Router();
  tournaments.use(authenticate);
  tournaments.get('/',                    tournamentCtrl.listTournaments);
  tournaments.post('/',                   requireRole('owner'), tournamentCtrl.createTournament);
  tournaments.get('/:id',                 tournamentCtrl.getTournament);
  tournaments.patch('/:id',               requireRole('owner'), tournamentCtrl.updateTournament);
  tournaments.post('/:id/teams',          requireRole('customer', 'receptionist', 'owner', 'admin'), tournamentCtrl.registerTeam);
  tournaments.post('/:id/teams/:teamId/pay', requireRole('customer', 'receptionist', 'owner', 'admin'), tournamentCtrl.recordTeamPayment);
  tournaments.post('/:id/bracket',        requireRole('owner'), tournamentCtrl.generateBracket);
  tournaments.patch('/:id/matches/:matchId', requireRole('owner'), tournamentCtrl.recordMatchResult);
  app.use('/api/tournaments', tournaments);

  // ── Coaching & training ledger ────────────────────────────────
  const coaching = Router();
  coaching.use(authenticate);
  coaching.get('/coaches',        requireRole('receptionist', 'owner'), coachingCtrl.listCoaches);
  coaching.post('/coaches',       requireRole('owner'), coachingCtrl.createCoach);
  coaching.patch('/coaches/:id',  requireRole('owner'), coachingCtrl.updateCoach);
  coaching.get('/sessions',       requireRole('receptionist', 'owner'), coachingCtrl.listSessions);
  coaching.post('/sessions',      requireRole('receptionist', 'owner'), coachingCtrl.createSession);
  coaching.patch('/sessions/:id', requireRole('receptionist', 'owner'), coachingCtrl.updateSession);
  coaching.post('/sessions/:id/pay', requireRole('receptionist', 'owner'), coachingCtrl.markSessionPaid);
  app.use('/api/coaching', coaching);

  // ── Lost & Found board ────────────────────────────────────────
  const lostFound = Router();
  lostFound.use(authenticate);
  lostFound.get('/',           lostFoundCtrl.listItems);
  lostFound.post('/',          requireRole('receptionist', 'owner'), uploadLimiter, lostFoundCtrl.photoUploadMiddleware, lostFoundCtrl.createItem);
  lostFound.get('/:id/photo',  lostFoundCtrl.getItemPhoto);
  lostFound.patch('/:id',      requireRole('receptionist', 'owner'), lostFoundCtrl.updateItem);
  lostFound.post('/:id/claims',  requireRole('customer'), lostFoundCtrl.submitClaim);
  lostFound.get('/:id/claims',   requireRole('receptionist', 'owner'), lostFoundCtrl.listClaims);
  lostFound.patch('/:id/claims/:claimId', requireRole('receptionist', 'owner'), lostFoundCtrl.decideClaim);
  app.use('/api/lost-found', lostFound);

  // ── Booking routes ──────────────────────────────────────────
  const bookings = Router();
  bookings.use(authenticate);
  bookings.get('/',                 requireRole('customer', 'receptionist', 'owner', 'admin'), bookingCtrl.listBookings);
  // /me must be declared BEFORE /:id so it isn't matched as a booking id
  bookings.get('/me',               requireRole('customer', 'receptionist', 'owner', 'admin'), bookingCtrl.listBookings);
  // financial-summary must also be declared BEFORE /:id
  bookings.get('/financial-summary',  requireRole('receptionist', 'owner'), bookingCtrl.getFinancialSummary);
  // analytics-plots must also be declared BEFORE /:id
  bookings.get('/analytics-plots',    requireRole('owner'), bookingCtrl.getAnalyticsPlots);
  bookings.post('/',                requireRole('customer', 'receptionist', 'owner', 'admin'), bookingCtrl.createBookingHandler);
  bookings.get('/:id',              bookingCtrl.getBooking);
  bookings.post('/:id/receipt',
    requireRole('customer'),
    uploadLimiter,
    bookingCtrl.receiptUploadMiddleware,
    bookingCtrl.uploadReceiptHandler
  );
  // View the uploaded receipt (staff verify any; customers only their own — enforced in handler)
  bookings.get('/:id/receipt', bookingCtrl.getReceiptHandler);
  bookings.patch('/:id/verify',   requireRole('receptionist', 'owner'), bookingCtrl.verifyDepositHandler);
  bookings.patch('/:id/checkin',  requireRole('receptionist', 'owner'), bookingCtrl.checkinHandler);
  bookings.patch('/:id/cancel',   bookingCtrl.cancelBookingHandler);
  bookings.patch('/:id/settle',   requireRole('receptionist', 'owner'), bookingCtrl.settlePaymentHandler);
  // Permanent deletion — the most destructive endpoint in the API, owner only
  bookings.delete('/:id',         requireRole('owner'), bookingCtrl.deleteBookingHandler);
  app.use('/api/bookings', bookings);


  // ── Court routes ─────────────────────────────────────────────
  const courts = Router();
  courts.use(authenticate);
  courts.get('/',      courtCtrl.listCourts);
  // Must be declared BEFORE /:id so 'availability-grid' isn't matched as a court id
  courts.get('/availability-grid', courtCtrl.getAvailabilityGrid);
  courts.get('/:id',   courtCtrl.getCourt);
  courts.post('/',     requireRole('owner'), courtCtrl.createCourt);
  courts.patch('/:id', requireRole('owner'), courtCtrl.updateCourt);
  courts.delete('/:id',requireRole('owner'), courtCtrl.deleteCourt);

  courts.get('/:id/availability', courtCtrl.getCourtAvailability);
  courts.post('/blocked-periods', requireRole('owner'), courtCtrl.createBlockedPeriod);
  courts.delete('/blocked-periods/:bpId', requireRole('owner'), courtCtrl.deleteBlockedPeriod);
  app.use('/api/courts', courts);

  // ── Refund routes ─────────────────────────────────────────────
  const refunds = Router();
  refunds.use(authenticate);
  refunds.post('/',          requireRole('receptionist'), refundCtrl.createRefundRequest);
  refunds.get('/',           requireRole('owner', 'receptionist'), refundCtrl.listRefunds);
  refunds.patch('/:id',      requireRole('owner'), refundCtrl.approveOrRejectRefund);
  app.use('/api/refunds', refunds);

  // ── Report routes (owner only) ──────────────────────────────
  const reports = Router();
  reports.use(authenticate, requireRole('owner'));
  reports.post('/generate',  reportCtrl.generateReport);
  reports.get('/',           reportCtrl.listReports);
  reports.get('/:id/download', reportCtrl.downloadReport);
  app.use('/api/reports', reports);

  // ── Audit log routes (owner only) ───────────────────────────
  const audit = Router();
  audit.use(authenticate, requireRole('owner'));
  audit.get('/',  auditCtrl.listAuditLogs);
  app.use('/api/audit', audit);

  // ── Club settings ──────────────────────────────
  const settings = Router();
  settings.use(authenticate);
  settings.get('/',                      requireRole('owner'), courtCtrl.getClubSettings);
  settings.patch('/',                    requireRole('owner'), courtCtrl.updateClubSettings);
  // We need to un-protect settings root for these specific routes if settings router requires owner, or just add the roles
  settings.get('/working-hours',         requireRole('customer', 'receptionist', 'owner', 'admin'), courtCtrl.getWorkingHours);
  settings.put('/working-hours',         requireRole('owner', 'admin'), courtCtrl.upsertWorkingHours);
  app.use('/api/settings', settings);

  // ── Dashboard data endpoints ─────────────────────────────────
  const dashboard = Router();
  dashboard.use(authenticate);
  dashboard.get('/today',   requireRole('owner', 'receptionist'), bookingCtrl.listBookings);
  // Staff-only: exposes every customer's name/phone/email + admin_notes for the
  // day. Must NOT be reachable by a customer token (BOLA / PII disclosure).
  dashboard.get('/schedule', requireRole('owner', 'receptionist'), courtCtrl.getDailySchedule);
  app.use('/api/dashboard', dashboard);
}
