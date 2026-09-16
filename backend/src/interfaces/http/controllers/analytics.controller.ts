/**
 * Analytics Controller – owner-facing business intelligence.
 *
 * GET /api/analytics/overview?range_days=30
 *
 * Returns everything the Analytics screen charts in one round-trip:
 *   kpis                     – headline numbers for the range, each with a
 *                               vs.-previous-period delta (+ MRR from subscriptions)
 *   bookingsPerDay           – daily bookings + collected revenue (line/area chart)
 *   revenueByCourt           – collected revenue split per court (donut)
 *   occupancyByCourt         – booked hours vs. available open hours per court
 *   revenueByMonth           – collected revenue trend, last 6 calendar months
 *   customerGrowth           – new customer registrations, last 6 calendar months
 *   dayOfWeekDemand          – booking volume by weekday (Mon–Sun)
 *   peakHours                – booking volume by hour of day (06:00–22:00)
 *   paymentMethodDistribution – collected revenue split by payment method
 *   topCustomers              – top 10 customers by collected revenue in range
 *
 * "Collected revenue" is deposit + remainder on staff-verified bookings only
 * (confirmed / checked_in / completed / no_show) — the same canonical
 * definition used by the financial summary and P&L (see
 * domain/analytics/revenue.ts), so every screen agrees on the numbers.
 *
 * Day/month buckets use CourtFlow's 06:00-Cairo "operational day" (see
 * operationalDayExpr) — matching report.controller.ts and finance.controller.ts
 * — so a 2 AM booking lands on the same day/month on every screen.
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import {
  VERIFIED_STATUSES_SQL as VERIFIED,
  COLLECTED_SQL as COLLECTED,
  operationalDayExpr,
  operationalDateKey,
} from '../../../domain/analytics/revenue';

const TZ = 'Africa/Cairo';

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Percentage change vs. a previous-period value. null when previous is 0 (undefined %, avoid noise/div-by-zero). */
function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Rate as a 0–100 percentage, one decimal. 0 when the denominator is 0 (nothing to rate). */
function pctRate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

export async function getAnalyticsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rangeDays = Math.min(Math.max(parseInt((req.query.range_days as string) ?? '30', 10) || 30, 7), 365);
    const clubId = clubIdOf(req);

    // ── KPIs (current + previous period, in one pass) ──────────────
    const { rows: kpiRows } = await db.query(
      `SELECT
         COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED} AND b.start_time >= NOW() - ($2 || ' days')::interval), 0)::numeric AS revenue,
         COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED} AND b.start_time <  NOW() - ($2 || ' days')::interval), 0)::numeric AS revenue_prev,
         COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired') AND b.start_time >= NOW() - ($2 || ' days')::interval)::int AS bookings,
         COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired') AND b.start_time <  NOW() - ($2 || ' days')::interval)::int AS bookings_prev,
         COUNT(DISTINCT b.customer_id) FILTER (WHERE b.start_time >= NOW() - ($2 || ' days')::interval)::int AS unique_customers,
         COUNT(*) FILTER (WHERE b.status = 'cancelled' AND b.start_time >= NOW() - ($2 || ' days')::interval)::int AS cancellations,
         COUNT(*) FILTER (WHERE b.status = 'cancelled' AND b.start_time <  NOW() - ($2 || ' days')::interval)::int AS cancellations_prev,
         COUNT(*) FILTER (WHERE b.status <> 'draft' AND b.start_time >= NOW() - ($2 || ' days')::interval)::int AS non_draft,
         COUNT(*) FILTER (WHERE b.status <> 'draft' AND b.start_time <  NOW() - ($2 || ' days')::interval)::int AS non_draft_prev,
         COUNT(*) FILTER (WHERE b.status = 'no_show' AND b.start_time >= NOW() - ($2 || ' days')::interval)::int AS no_shows,
         COUNT(*) FILTER (WHERE b.status = 'no_show' AND b.start_time <  NOW() - ($2 || ' days')::interval)::int AS no_shows_prev,
         COUNT(*) FILTER (WHERE b.status IN ${VERIFIED} AND b.start_time >= NOW() - ($2 || ' days')::interval)::int AS verified_eligible,
         COUNT(*) FILTER (WHERE b.status IN ${VERIFIED} AND b.start_time <  NOW() - ($2 || ' days')::interval)::int AS verified_eligible_prev
       FROM bookings b
       WHERE b.club_id = $1
         AND b.deleted_at IS NULL
         AND b.start_time >= NOW() - ($2 || ' days')::interval * 2`,
      [clubId, rangeDays]
    );
    const k = kpiRows[0];
    const revenue = Number(k.revenue), revenuePrev = Number(k.revenue_prev);
    const bookings = k.bookings as number, bookingsPrev = k.bookings_prev as number;
    const cancellations = k.cancellations as number, cancellationsPrev = k.cancellations_prev as number;
    const nonDraft = k.non_draft as number, nonDraftPrev = k.non_draft_prev as number;
    const noShows = k.no_shows as number, noShowsPrev = k.no_shows_prev as number;
    const verifiedEligible = k.verified_eligible as number, verifiedEligiblePrev = k.verified_eligible_prev as number;

    const avgBookingValue = bookings > 0 ? Math.round((revenue / bookings) * 100) / 100 : 0;
    const avgBookingValuePrev = bookingsPrev > 0 ? Math.round((revenuePrev / bookingsPrev) * 100) / 100 : 0;
    const cancellationRate = pctRate(cancellations, nonDraft);
    const cancellationRatePrev = pctRate(cancellationsPrev, nonDraftPrev);
    const noShowRate = pctRate(noShows, verifiedEligible);
    const noShowRatePrev = pctRate(noShowsPrev, verifiedEligiblePrev);

    // ── Subscriptions (unchanged) ───────────────────────────────────
    const { rows: subRows } = await db.query(
      `SELECT COUNT(*)::int AS active,
              COALESCE(SUM(weekly_price * 4), 0)::numeric AS mrr
       FROM subscriptions WHERE club_id = $1 AND status = 'active'`,
      [clubId]
    );

    // ── New vs. returning customers ──────────────────────────────────
    // "New" = account created within the range. "Returning" = booked (a real,
    // non-cancelled/expired booking) within the range but existed before it.
    const { rows: custRows } = await db.query(
      `WITH cohort AS (
         SELECT u.id, u.created_at,
                BOOL_OR(
                  b.start_time >= NOW() - ($2 || ' days')::interval
                  AND b.status NOT IN ('cancelled','expired')
                ) AS booked_in_range
         FROM users u
         LEFT JOIN bookings b ON b.customer_id = u.id AND b.deleted_at IS NULL
         WHERE u.club_id = $1 AND u.role = 'customer'
         GROUP BY u.id, u.created_at
       )
       SELECT
         COUNT(*) FILTER (WHERE created_at >= NOW() - ($2 || ' days')::interval)::int AS new_customers,
         COUNT(*) FILTER (WHERE booked_in_range AND created_at < NOW() - ($2 || ' days')::interval)::int AS returning_customers
       FROM cohort`,
      [clubId, rangeDays]
    );

    // ── Bookings + revenue per day (operational-day bucketed) ───────
    const { rows: dailyRows } = await db.query(
      `SELECT (${operationalDayExpr('b.start_time', TZ)})::date AS day,
              COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings,
              COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED}), 0)::numeric AS revenue
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.start_time >= NOW() - ($2 || ' days')::interval
       GROUP BY day ORDER BY day`,
      [clubId, rangeDays]
    );

    // Dense series: charts need every day present even with zero bookings.
    // Keys are operational-day labels, matching the SQL's grouping above.
    const dayMap = new Map<string, { bookings: number; revenue: number }>(
      dailyRows.map((r) => [
        r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
        { bookings: r.bookings, revenue: Number(r.revenue) },
      ])
    );
    const bookingsPerDay = Array.from({ length: rangeDays }, (_, i) => {
      const instant = new Date(Date.now() - (rangeDays - 1 - i) * 24 * 60 * 60 * 1000);
      const key = operationalDateKey(instant, TZ);
      const hit = dayMap.get(key);
      return { date: key, bookings: hit?.bookings ?? 0, revenue: hit?.revenue ?? 0 };
    });

    // ── Revenue + occupancy per court ────────────────────────────
    const { rows: courtRows } = await db.query(
      `SELECT c.id, c.name, c.number,
              COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED}), 0)::numeric AS revenue,
              COALESCE(SUM(b.duration_minutes)
                FILTER (WHERE b.status NOT IN ('cancelled','expired')), 0)::int AS booked_minutes,
              COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings
       FROM courts c
       LEFT JOIN bookings b
         ON b.court_id = c.id
        AND b.deleted_at IS NULL
        AND b.start_time >= NOW() - ($2 || ' days')::interval
       WHERE c.club_id = $1 AND c.is_active = TRUE
       GROUP BY c.id, c.name, c.number
       ORDER BY c.number`,
      [clubId, rangeDays]
    );

    // Available open hours per court over the range, from configured working hours
    const { rows: whRows } = await db.query<{ open_time: string; close_time: string; is_closed: boolean }>(
      `SELECT open_time, close_time, is_closed FROM working_hours WHERE club_id = $1`,
      [clubId]
    );
    const weeklyOpenMinutes = whRows.reduce((sum, wh) => {
      if (wh.is_closed) return sum;
      const [oh, om] = wh.open_time.split(':').map(Number);
      const [ch, cm] = wh.close_time.split(':').map(Number);
      let open = oh * 60 + om, close = ch * 60 + cm;
      if (close === open) return sum + 24 * 60;            // 24-hour day
      if (close <= open) close += 24 * 60;                 // overnight shift
      return sum + (close - open);
    }, 0);
    // Fall back to 14 open hours/day when hours are unconfigured
    const openMinutesInRange = weeklyOpenMinutes > 0
      ? (weeklyOpenMinutes / 7) * rangeDays
      : 14 * 60 * rangeDays;

    const revenueByCourt = courtRows.map((r) => ({
      courtId: r.id, name: r.name, number: r.number, revenue: Number(r.revenue),
    }));
    const occupancyByCourt = courtRows.map((r) => ({
      courtId: r.id, name: r.name, number: r.number,
      bookedHours: Math.round((r.booked_minutes / 60) * 10) / 10,
      bookings:    r.bookings,
      occupancyPct: Math.min(
        Math.round((r.booked_minutes / openMinutesInRange) * 1000) / 10,
        100
      ),
    }));

    // ── 6-month revenue + growth trends (operational-month bucketed) ─
    const { rows: monthRows } = await db.query(
      `SELECT TO_CHAR(DATE_TRUNC('month', ${operationalDayExpr('b.start_time', TZ)}), 'YYYY-MM') AS month,
              COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED}), 0)::numeric AS revenue,
              COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.start_time >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
       GROUP BY month ORDER BY month`,
      [clubId]
    );

    const { rows: growthRows } = await db.query(
      `SELECT TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE '${TZ}'), 'YYYY-MM') AS month,
              COUNT(*)::int AS new_customers
       FROM users
       WHERE club_id = $1 AND role = 'customer'
         AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
       GROUP BY month ORDER BY month`,
      [clubId]
    );

    // Dense 6-month series
    const monthKeys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      monthKeys.push(d.toISOString().slice(0, 7));
    }
    const revMap    = new Map(monthRows.map((r) => [r.month, r]));
    const growthMap = new Map(growthRows.map((r) => [r.month, r.new_customers]));

    // ── Day-of-week demand (Mon–Sun, Cairo local) ────────────────────
    const { rows: dowRows } = await db.query(
      `SELECT EXTRACT(ISODOW FROM b.start_time AT TIME ZONE '${TZ}')::int AS dow,
              COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.start_time >= NOW() - ($2 || ' days')::interval
       GROUP BY dow ORDER BY dow`,
      [clubId, rangeDays]
    );
    const dowMap = new Map<number, number>(dowRows.map((r: { dow: number; bookings: number }) => [r.dow, r.bookings]));
    const dayOfWeekDemand = DOW_LABELS.map((label, i) => ({ day: label, bookings: dowMap.get(i + 1) ?? 0 }));

    // ── Peak hours (moved from GET /api/bookings/analytics-plots) ───
    // Fixed: both the range filter AND the hour bucket now key off
    // start_time (when the slot occurs), not created_at (when it was booked)
    // — the old endpoint mixed the two, misrepresenting actual peak demand.
    const { rows: peakRows } = await db.query(
      `SELECT EXTRACT(HOUR FROM (b.start_time AT TIME ZONE '${TZ}'))::int AS hour_slot,
              COUNT(*)::int AS bookings_count
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.status IN ('confirmed','checked_in','completed')
         AND b.start_time >= NOW() - ($2 || ' days')::interval
       GROUP BY hour_slot ORDER BY hour_slot`,
      [clubId, rangeDays]
    );
    const hourMap = new Map<number, number>(peakRows.map((r: { hour_slot: number; bookings_count: number }) => [r.hour_slot, r.bookings_count]));
    const peakHours = Array.from({ length: 17 }, (_, i) => {
      const h = i + 6; // 06:00 … 22:00
      return { hour: `${String(h).padStart(2, '0')}:00`, bookingsCount: hourMap.get(h) ?? 0 };
    });

    // ── Payment method distribution (moved from analytics-plots) ────
    // Also aligned to start_time (when the slot occurs) so its date filter
    // matches every other chart on this screen, instead of the old
    // created_at-based window.
    const { rows: distRows } = await db.query(
      `SELECT
         COALESCE(SUM(b.deposit_amount) FILTER (WHERE b.deposit_method = 'CASH'), 0)::numeric +
         COALESCE(SUM(b.remainder_amount) FILTER (WHERE b.remainder_method = 'CASH'), 0)::numeric AS cash,
         COALESCE(SUM(b.deposit_amount) FILTER (WHERE b.deposit_method = 'VODAFONE_CASH'), 0)::numeric +
         COALESCE(SUM(b.remainder_amount) FILTER (WHERE b.remainder_method = 'VODAFONE_CASH'), 0)::numeric AS vodafone_cash,
         COALESCE(SUM(b.deposit_amount) FILTER (WHERE b.deposit_method = 'INSTAPAY'), 0)::numeric +
         COALESCE(SUM(b.remainder_amount) FILTER (WHERE b.remainder_method = 'INSTAPAY'), 0)::numeric AS instapay
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.status IN ${VERIFIED}
         AND b.start_time >= NOW() - ($2 || ' days')::interval`,
      [clubId, rangeDays]
    );
    const dr = distRows[0];
    const paymentMethodDistribution = [
      { name: 'CASH',          value: Number(dr.cash) },
      { name: 'VODAFONE_CASH', value: Number(dr.vodafone_cash) },
      { name: 'INSTAPAY',      value: Number(dr.instapay) },
    ];

    // ── Top 10 customers by collected revenue in range ───────────────
    const { rows: topCustomerRows } = await db.query(
      `SELECT u.id, u.first_name, u.last_name,
              COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings,
              COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED}), 0)::numeric AS revenue
       FROM users u
       JOIN bookings b ON b.customer_id = u.id AND b.deleted_at IS NULL
         AND b.start_time >= NOW() - ($2 || ' days')::interval
       WHERE u.club_id = $1 AND u.role = 'customer'
       GROUP BY u.id, u.first_name, u.last_name
       HAVING COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled','expired')) > 0
       ORDER BY revenue DESC
       LIMIT 10`,
      [clubId, rangeDays]
    );
    const topCustomers = topCustomerRows.map((r) => ({
      customerId: r.id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      bookings: r.bookings,
      revenue: Number(r.revenue),
    }));

    res.json({
      rangeDays,
      generatedAt: new Date().toISOString(),
      kpis: {
        revenue, revenuePrevPeriod: revenuePrev, revenueDeltaPct: pctDelta(revenue, revenuePrev),
        bookings, bookingsPrevPeriod: bookingsPrev, bookingsDeltaPct: pctDelta(bookings, bookingsPrev),
        avgBookingValue, avgBookingValuePrevPeriod: avgBookingValuePrev,
        avgBookingValueDeltaPct: pctDelta(avgBookingValue, avgBookingValuePrev),
        uniqueCustomers:     kpiRows[0].unique_customers,
        cancellations, cancellationRate, cancellationRatePrevPeriod: cancellationRatePrev,
        cancellationRateDeltaPct: pctDelta(cancellationRate, cancellationRatePrev),
        noShows, noShowRate, noShowRatePrevPeriod: noShowRatePrev,
        noShowRateDeltaPct: pctDelta(noShowRate, noShowRatePrev),
        newCustomers:        custRows[0].new_customers,
        returningCustomers:  custRows[0].returning_customers,
        activeSubscriptions: subRows[0].active,
        mrr:                 Number(subRows[0].mrr),
      },
      bookingsPerDay,
      revenueByCourt,
      occupancyByCourt,
      revenueByMonth: monthKeys.map((m) => ({
        month:    m,
        revenue:  Number(revMap.get(m)?.revenue ?? 0),
        bookings: revMap.get(m)?.bookings ?? 0,
      })),
      customerGrowth: monthKeys.map((m) => ({
        month:        m,
        newCustomers: growthMap.get(m) ?? 0,
      })),
      dayOfWeekDemand,
      peakHours,
      paymentMethodDistribution,
      topCustomers,
    });
  } catch (err) { next(err); }
}
