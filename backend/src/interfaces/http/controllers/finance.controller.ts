/**
 * Finance Controller – owner P&L view.
 *
 * GET /api/analytics/financials?range_days=30
 *
 * Aggregates every revenue stream against every cost stream and returns the
 * club's net profit plus computed, data-driven recommendations:
 *
 *   revenue   – verified booking collections (court time + equipment rentals),
 *               tournament registration fees actually received, and paid
 *               training sessions (gross, i.e. what the client handed over)
 *   costs     – logged operating expenses + coach commission payouts
 *   netProfit – revenue.total − costs.total
 *
 * Equipment-rental income is *inside* booking collections (add-ons are part
 * of the booking bill), so it is reported as a sub-metric, never re-added.
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';

const CLUB_ID = process.env.CLUB_ID!;
const TZ = 'Africa/Cairo';

const VERIFIED = `('confirmed','checked_in','completed','no_show')`;
const COLLECTED = `(
  COALESCE(b.deposit_amount,0)  * (b.deposit_method   IS NOT NULL AND b.deposit_method   <> 'NONE')::int +
  COALESCE(b.remainder_amount,0)* (b.remainder_method IS NOT NULL AND b.remainder_method <> 'NONE')::int
)`;

interface Recommendation {
  severity: 'positive' | 'warning' | 'info';
  text:     string;
}

export async function getFinancials(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rangeDays = Math.min(Math.max(parseInt((req.query.range_days as string) ?? '30', 10) || 30, 7), 365);

    // ── Revenue: bookings (current + previous window for trend math) ──
    const { rows: bookingRows } = await db.query(
      `SELECT
         COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.start_time >= NOW() - ($2 || ' days')::interval), 0)::numeric AS current,
         COALESCE(SUM(${COLLECTED}) FILTER (WHERE b.start_time <  NOW() - ($2 || ' days')::interval), 0)::numeric AS previous
       FROM bookings b
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.status IN ${VERIFIED}
         AND b.start_time >= NOW() - ($2 || ' days')::interval * 2`,
      [CLUB_ID, rangeDays]
    );

    // Equipment rental income inside those bookings, split per category
    const { rows: rentalRows } = await db.query(
      `SELECT e.category,
              COALESCE(SUM(be.subtotal) FILTER (WHERE b.start_time >= NOW() - ($2 || ' days')::interval), 0)::numeric AS current,
              COALESCE(SUM(be.subtotal) FILTER (WHERE b.start_time <  NOW() - ($2 || ' days')::interval), 0)::numeric AS previous
       FROM booking_equipment be
       JOIN bookings b ON b.id = be.booking_id
       JOIN equipment e ON e.id = be.equipment_id
       WHERE b.club_id = $1 AND b.deleted_at IS NULL
         AND b.status IN ${VERIFIED}
         AND b.start_time >= NOW() - ($2 || ' days')::interval * 2
       GROUP BY e.category`,
      [CLUB_ID, rangeDays]
    );

    // ── Revenue: tournament registration fees ─────────────────────
    const { rows: tournamentRows } = await db.query(
      `SELECT
         COALESCE(SUM(tt.amount_paid) FILTER (WHERE tt.paid_at >= NOW() - ($2 || ' days')::interval), 0)::numeric AS collected,
         COALESCE(SUM(GREATEST(tt.amount_due - tt.amount_paid, 0)), 0)::numeric AS outstanding,
         COUNT(*) FILTER (WHERE tt.amount_paid < tt.amount_due)::int             AS unpaid_teams
       FROM tournament_teams tt
       JOIN tournaments t ON t.id = tt.tournament_id
       WHERE t.club_id = $1 AND t.status <> 'cancelled'`,
      [CLUB_ID, rangeDays]
    );

    // ── Revenue: training sessions ─────────────────────────────────
    const { rows: trainingRows } = await db.query(
      `SELECT
         COALESCE(SUM(ts.price)       FILTER (WHERE ts.is_paid AND ts.paid_at >= NOW() - ($2 || ' days')::interval), 0)::numeric AS collected,
         COALESCE(SUM(ts.coach_share) FILTER (WHERE ts.is_paid AND ts.paid_at >= NOW() - ($2 || ' days')::interval), 0)::numeric AS coach_payouts,
         COALESCE(SUM(ts.club_share)  FILTER (WHERE ts.is_paid AND ts.paid_at >= NOW() - ($2 || ' days')::interval), 0)::numeric AS club_share,
         COALESCE(SUM(ts.price) FILTER (WHERE NOT ts.is_paid AND ts.status <> 'cancelled'), 0)::numeric AS uncollected,
         COUNT(*)  FILTER (WHERE NOT ts.is_paid AND ts.status <> 'cancelled')::int AS unpaid_sessions
       FROM training_sessions ts
       WHERE ts.club_id = $1`,
      [CLUB_ID, rangeDays]
    );

    // ── Costs: operating expenses ──────────────────────────────────
    const { rows: expenseRows } = await db.query(
      `SELECT category, COALESCE(SUM(amount), 0)::numeric AS total
       FROM expenses
       WHERE club_id = $1 AND expense_date >= CURRENT_DATE - ($2 || ' days')::interval
       GROUP BY category ORDER BY total DESC`,
      [CLUB_ID, rangeDays]
    );

    // ── Monthly P&L series (last 6 calendar months) ────────────────
    const { rows: monthlyRevenue } = await db.query(
      `SELECT month, SUM(amount)::numeric AS revenue FROM (
         SELECT TO_CHAR(DATE_TRUNC('month', b.start_time AT TIME ZONE '${TZ}'), 'YYYY-MM') AS month,
                ${COLLECTED} AS amount
         FROM bookings b
         WHERE b.club_id = $1 AND b.deleted_at IS NULL AND b.status IN ${VERIFIED}
           AND b.start_time >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
         UNION ALL
         SELECT TO_CHAR(DATE_TRUNC('month', tt.paid_at AT TIME ZONE '${TZ}'), 'YYYY-MM'), tt.amount_paid
         FROM tournament_teams tt
         JOIN tournaments t ON t.id = tt.tournament_id
         WHERE t.club_id = $1 AND tt.paid_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
         UNION ALL
         SELECT TO_CHAR(DATE_TRUNC('month', ts.paid_at AT TIME ZONE '${TZ}'), 'YYYY-MM'), ts.price
         FROM training_sessions ts
         WHERE ts.club_id = $1 AND ts.is_paid
           AND ts.paid_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
       ) AS streams
       GROUP BY month`,
      [CLUB_ID]
    );

    const { rows: monthlyCosts } = await db.query(
      `SELECT month, SUM(amount)::numeric AS costs FROM (
         SELECT TO_CHAR(DATE_TRUNC('month', e.expense_date), 'YYYY-MM') AS month, e.amount
         FROM expenses e
         WHERE e.club_id = $1
           AND e.expense_date >= (DATE_TRUNC('month', NOW()) - INTERVAL '5 months')::date
         UNION ALL
         SELECT TO_CHAR(DATE_TRUNC('month', ts.paid_at AT TIME ZONE '${TZ}'), 'YYYY-MM'), ts.coach_share
         FROM training_sessions ts
         WHERE ts.club_id = $1 AND ts.is_paid
           AND ts.paid_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
       ) AS outflows
       GROUP BY month`,
      [CLUB_ID]
    );

    const monthKeys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      monthKeys.push(d.toISOString().slice(0, 7));
    }
    const revMap  = new Map(monthlyRevenue.map((r) => [r.month, Number(r.revenue)]));
    const costMap = new Map(monthlyCosts.map((r) => [r.month, Number(r.costs)]));
    const monthly = monthKeys.map((m) => {
      const revenue = revMap.get(m) ?? 0;
      const costs   = costMap.get(m) ?? 0;
      return { month: m, revenue, expenses: costs, netProfit: revenue - costs };
    });

    // ── Assemble totals ────────────────────────────────────────────
    const bookings          = Number(bookingRows[0].current);
    const bookingsPrev      = Number(bookingRows[0].previous);
    const tournaments       = Number(tournamentRows[0].collected);
    const tournamentOutstanding = Number(tournamentRows[0].outstanding);
    const training          = Number(trainingRows[0].collected);
    const coachPayouts      = Number(trainingRows[0].coach_payouts);
    const trainingClubShare = Number(trainingRows[0].club_share);
    const trainingUncollected = Number(trainingRows[0].uncollected);

    const rentalsCurrent  = rentalRows.reduce((s, r) => s + Number(r.current), 0);
    const rentalsPrevious = rentalRows.reduce((s, r) => s + Number(r.previous), 0);

    const expensesByCategory = expenseRows.map((r) => ({ category: r.category as string, total: Number(r.total) }));
    const operatingExpenses  = expensesByCategory.reduce((s, e) => s + e.total, 0);

    const totalRevenue = bookings + tournaments + training;
    const totalCosts   = operatingExpenses + coachPayouts;
    const netProfit    = totalRevenue - totalCosts;
    const marginPct    = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0;

    // ── Computed recommendations ───────────────────────────────────
    const recommendations: Recommendation[] = [];

    // Rental trend per category → restock advice
    for (const r of rentalRows) {
      const cur = Number(r.current), prev = Number(r.previous);
      if (prev >= 100 && cur >= prev * 1.2) {
        const pct = Math.round(((cur - prev) / prev) * 100);
        const label = r.category === 'racket' ? 'Racket rentals' : `${r.category[0].toUpperCase()}${r.category.slice(1)} rentals`;
        recommendations.push({
          severity: 'positive',
          text: `${label} are up ${pct}% vs. the previous ${rangeDays} days (EGP ${Math.round(cur).toLocaleString()}). Consider buying more stock to capture the demand.`,
        });
      } else if (prev >= 100 && cur <= prev * 0.6) {
        const pct = Math.round(((prev - cur) / prev) * 100);
        recommendations.push({
          severity: 'info',
          text: `${r.category[0].toUpperCase()}${r.category.slice(1)} rental income dropped ${pct}% vs. the previous period — review pricing or visibility in the booking flow.`,
        });
      }
    }

    if (bookingsPrev > 0) {
      const delta = Math.round(((bookings - bookingsPrev) / bookingsPrev) * 100);
      if (delta <= -15) {
        recommendations.push({
          severity: 'warning',
          text: `Court revenue is down ${Math.abs(delta)}% vs. the previous ${rangeDays} days. Consider off-peak promotions or a member re-engagement push.`,
        });
      } else if (delta >= 15) {
        recommendations.push({
          severity: 'positive',
          text: `Court revenue is up ${delta}% vs. the previous ${rangeDays} days — momentum is strong.`,
        });
      }
    }

    if (tournamentOutstanding > 0) {
      recommendations.push({
        severity: 'warning',
        text: `EGP ${Math.round(tournamentOutstanding).toLocaleString()} in tournament registration fees is still outstanding across ${tournamentRows[0].unpaid_teams} team(s). Collect before the first match.`,
      });
    }

    if (trainingUncollected > 0) {
      recommendations.push({
        severity: 'warning',
        text: `${trainingRows[0].unpaid_sessions} training session(s) worth EGP ${Math.round(trainingUncollected).toLocaleString()} are unpaid — settle them from the Coaching ledger.`,
      });
    }

    if (operatingExpenses > 0 && expensesByCategory[0] && expensesByCategory[0].total / operatingExpenses > 0.45) {
      const top = expensesByCategory[0];
      recommendations.push({
        severity: 'info',
        text: `${top.category[0].toUpperCase()}${top.category.slice(1)} makes up ${Math.round((top.total / operatingExpenses) * 100)}% of operating expenses (EGP ${Math.round(top.total).toLocaleString()}) — the biggest lever for cost control.`,
      });
    }

    if (totalRevenue > 0 && netProfit < 0) {
      recommendations.push({
        severity: 'warning',
        text: `The club is operating at a loss of EGP ${Math.round(Math.abs(netProfit)).toLocaleString()} over the last ${rangeDays} days. Costs exceed collected revenue — review the expense ledger.`,
      });
    } else if (totalRevenue > 0 && marginPct >= 40) {
      recommendations.push({
        severity: 'positive',
        text: `Net margin is a healthy ${marginPct}%. A good moment to reinvest — equipment stock, court maintenance, or a new tournament.`,
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        severity: 'info',
        text: 'Not enough movement in this range to compute recommendations yet — log expenses and keep collecting payments to unlock insights.',
      });
    }

    res.json({
      rangeDays,
      generatedAt: new Date().toISOString(),
      totals: {
        revenue: {
          bookings,
          tournaments,
          training,
          total: totalRevenue,
          rentalsWithinBookings: rentalsCurrent,
          rentalsPreviousPeriod: rentalsPrevious,
        },
        costs: {
          operatingExpenses,
          coachPayouts,
          total: totalCosts,
        },
        trainingClubShare,
        tournamentOutstanding,
        netProfit,
        marginPct,
      },
      expensesByCategory,
      monthly,
      recommendations,
    });
  } catch (err) { next(err); }
}
