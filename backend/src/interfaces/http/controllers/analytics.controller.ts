/**
 * Analytics Controller – owner-facing business intelligence.
 *
 * GET /api/analytics/overview?range_days=30
 *
 * Returns everything the Analytics screen charts in one round-trip:
 *   kpis             – headline numbers for the range (+ MRR from subscriptions)
 *   bookingsPerDay   – daily bookings + collected revenue (line/area chart)
 *   revenueByCourt   – collected revenue split per court (donut)
 *   occupancyByCourt – booked hours vs. available open hours per court
 *   revenueByMonth   – collected revenue trend, last 6 calendar months
 *   customerGrowth   – new customer registrations, last 6 calendar months
 *
 * "Collected revenue" is deposit + remainder on staff-verified bookings only
 * (confirmed / checked_in / completed / no_show) — the same definition used by
 * the financial summary, so every screen agrees on the numbers.
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';

const TZ = 'Africa/Cairo';

const VERIFIED = `('confirmed','checked_in','completed','no_show')`;
const COLLECTED = `(
  COALESCE(b.deposit_amount,0)  * (b.deposit_method   IS NOT NULL AND b.deposit_method   <> 'NONE')::int +
  COALESCE(b.remainder_amount,0)* (b.remainder_method IS NOT NULL AND b.remainder_method <> 'NONE')::int
)`;

export async function getAnalyticsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rangeDays = Math.min(Math.max(parseInt((req.query.range_days as string) ?? '30', 10) || 30, 7), 365);

    // ── KPIs ─────────────────────────────────────────────────────
    const { rows: kpiRows } = await db.query(
      `SELECT
         COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED}), 0)::numeric AS revenue,
         COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int           AS bookings,
         COUNT(DISTINCT b.customer_id)::int                                             AS unique_customers,
         COUNT(*) FILTER (WHERE b.status = 'cancelled')::int                            AS cancellations
       FROM bookings b
       WHERE b.club_id = $1
         AND b.deleted_at IS NULL
         AND b.start_time >= NOW() - ($2 || ' days')::interval`,
      [clubIdOf(req), rangeDays]
    );

    const { rows: subRows } = await db.query(
      `SELECT COUNT(*)::int AS active,
              COALESCE(SUM(weekly_price * 4), 0)::numeric AS mrr
       FROM subscriptions WHERE club_id = $1 AND status = 'active'`,
      [clubIdOf(req)]
    );

    const { rows: custRows } = await db.query(
      `SELECT COUNT(*)::int AS new_customers
       FROM users
       WHERE club_id = $1 AND role = 'customer'
         AND created_at >= NOW() - ($2 || ' days')::interval`,
      [clubIdOf(req), rangeDays]
    );

    // ── Bookings + revenue per day ───────────────────────────────
    const { rows: dailyRows } = await db.query(
      `SELECT (b.start_time AT TIME ZONE '${TZ}')::date AS day,
              COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings,
              COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED}), 0)::numeric AS revenue
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.start_time >= NOW() - ($2 || ' days')::interval
       GROUP BY day ORDER BY day`,
      [clubIdOf(req), rangeDays]
    );

    // Dense series: charts need every day present even with zero bookings
    const dayMap = new Map<string, { bookings: number; revenue: number }>(
      dailyRows.map((r) => [
        r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
        { bookings: r.bookings, revenue: Number(r.revenue) },
      ])
    );
    const bookingsPerDay = Array.from({ length: rangeDays }, (_, i) => {
      const d = new Date(Date.now() - (rangeDays - 1 - i) * 24 * 60 * 60 * 1000);
      const key = d.toLocaleDateString('sv', { timeZone: TZ });
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
      [clubIdOf(req), rangeDays]
    );

    // Available open hours per court over the range, from configured working hours
    const { rows: whRows } = await db.query<{ open_time: string; close_time: string; is_closed: boolean }>(
      `SELECT open_time, close_time, is_closed FROM working_hours WHERE club_id = $1`,
      [clubIdOf(req)]
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

    // ── 6-month revenue + growth trends ──────────────────────────
    const { rows: monthRows } = await db.query(
      `SELECT TO_CHAR(DATE_TRUNC('month', b.start_time AT TIME ZONE '${TZ}'), 'YYYY-MM') AS month,
              COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.status IN ${VERIFIED}), 0)::numeric AS revenue,
              COUNT(*) FILTER (WHERE b.status NOT IN ('cancelled','expired'))::int AS bookings
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.start_time >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
       GROUP BY month ORDER BY month`,
      [clubIdOf(req)]
    );

    const { rows: growthRows } = await db.query(
      `SELECT TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE '${TZ}'), 'YYYY-MM') AS month,
              COUNT(*)::int AS new_customers
       FROM users
       WHERE club_id = $1 AND role = 'customer'
         AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
       GROUP BY month ORDER BY month`,
      [clubIdOf(req)]
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

    res.json({
      rangeDays,
      generatedAt: new Date().toISOString(),
      kpis: {
        revenue:             Number(kpiRows[0].revenue),
        bookings:            kpiRows[0].bookings,
        uniqueCustomers:     kpiRows[0].unique_customers,
        cancellations:       kpiRows[0].cancellations,
        newCustomers:        custRows[0].new_customers,
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
    });
  } catch (err) { next(err); }
}
