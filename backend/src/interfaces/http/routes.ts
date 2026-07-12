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

  // ── Users (customer list for staff) ───────────────────────────
  const users = Router();
  users.use(authenticate);
  users.get('/', requireRole('receptionist', 'owner'), authCtrl.listCustomers);
  app.use('/api/users', users);

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
  dashboard.get('/schedule', courtCtrl.getDailySchedule);
  app.use('/api/dashboard', dashboard);
}
