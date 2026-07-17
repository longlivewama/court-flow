/**
 * Report Controller – on-demand PDF, Excel, and CSV report generation.
 * Small reports: synchronous. Large reports: queued as background jobs.
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../../../infrastructure/database/client';
import { clubIdOf } from '../../../shared/tenant';
import { auditLog, AUDIT_ACTIONS } from '../../../infrastructure/audit/audit.service';
import { ValidationError, NotFoundError } from '../../../shared/errors';
import { v4 as uuidv4 } from 'uuid';


type ReportType = 'daily_revenue' | 'weekly_revenue' | 'monthly_revenue' | 'court_utilization'
  | 'booking_history' | 'customer_activity' | 'payment_history' | 'cancellation_report' | 'noshow_report';

// ── POST /api/reports/generate ────────────────────────────────
export async function generateReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type, format, filters } = req.body as {
      type: ReportType;
      format: 'pdf' | 'excel' | 'csv';
      filters: Record<string, string>;
    };

    const validTypes: ReportType[] = [
      'daily_revenue', 'weekly_revenue', 'monthly_revenue', 'court_utilization',
      'booking_history', 'customer_activity', 'payment_history', 'cancellation_report', 'noshow_report'
    ];
    if (!validTypes.includes(type)) throw new ValidationError(`Invalid report type: ${type}`);
    if (!['pdf', 'excel', 'csv'].includes(format)) throw new ValidationError('Format must be pdf, excel, or csv');

    // Insert report job
    const { rows } = await db.query(
      `INSERT INTO report_jobs (club_id, requested_by, type, format, filters, status)
       VALUES ($1,$2,$3,$4,$5,'queued') RETURNING id`,
      [clubIdOf(req), req.user!.sub, type, format, JSON.stringify(filters ?? {})]
    );
    const jobId = rows[0].id;

    await auditLog({ clubId: clubIdOf(req), userId: req.user!.sub, userRole: 'owner',
      actionType: AUDIT_ACTIONS.REPORT_GENERATED, entityType: 'report_job', entityId: jobId,
      newValues: { type, format, filters } });

    // For small reports, process synchronously
    const data = await fetchReportData(clubIdOf(req), type, filters);

    let content: Buffer;
    let contentType: string;
    let fileName: string;

    if (format === 'csv') {
      content = generateCsv(data);
      contentType = 'text/csv';
      fileName = `${type}_${Date.now()}.csv`;
    } else if (format === 'excel') {
      content = await generateExcel(data, type);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      fileName = `${type}_${Date.now()}.xlsx`;
    } else {
      content = await generatePdf(data, type);
      contentType = 'application/pdf';
      fileName = `${type}_${Date.now()}.pdf`;
    }

    await db.query(
      `UPDATE report_jobs SET status='completed', completed_at=NOW() WHERE id=$1`,
      [jobId]
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(content);
  } catch (err) { next(err); }
}

// ── GET /api/reports ──────────────────────────────────────────
export async function listReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT * FROM report_jobs WHERE club_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [clubIdOf(req)]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// ── GET /api/reports/:id/download ─────────────────────────────
export async function downloadReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT * FROM report_jobs WHERE id=$1 AND club_id=$2`,
      [req.params.id, clubIdOf(req)]
    );
    if (!rows.length) throw new NotFoundError('Report', req.params.id);
    if (rows[0].status !== 'completed') throw new ValidationError('Report is not yet ready');
    res.json({ storageKey: rows[0].storage_key });
  } catch (err) { next(err); }
}

// ── Report data fetchers ──────────────────────────────────────
async function fetchReportData(clubId: string, type: ReportType, filters: Record<string, string>): Promise<unknown[]> {
  const from = filters.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to   = filters.to   ?? new Date().toISOString();

  const QUERIES: Record<ReportType, { sql: string; params: unknown[] }> = {
    daily_revenue: {
      sql: `SELECT DATE(b.start_time AT TIME ZONE 'Africa/Cairo') AS date,
              COUNT(*) AS bookings, SUM(p.total_amount) AS revenue,
              SUM(p.deposit_amount) AS deposits_collected
            FROM bookings b JOIN payments p ON p.booking_id=b.id
            WHERE b.club_id=$1 AND b.status IN ('confirmed','checked_in','completed')
              AND b.start_time BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1`,
      params: [clubId, from, to],
    },
    weekly_revenue: {
      sql: `SELECT DATE_TRUNC('week', b.start_time AT TIME ZONE 'Africa/Cairo') AS week,
              COUNT(*) AS bookings, SUM(p.total_amount) AS revenue
            FROM bookings b JOIN payments p ON p.booking_id=b.id
            WHERE b.club_id=$1 AND b.status IN ('confirmed','checked_in','completed')
              AND b.start_time BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1`,
      params: [clubId, from, to],
    },
    monthly_revenue: {
      sql: `SELECT TO_CHAR(b.start_time AT TIME ZONE 'Africa/Cairo','MM/YYYY') AS month,
              COUNT(*) AS bookings, SUM(p.total_amount) AS revenue
            FROM bookings b JOIN payments p ON p.booking_id=b.id
            WHERE b.club_id=$1 AND b.status IN ('confirmed','checked_in','completed')
              AND b.start_time BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1`,
      params: [clubId, from, to],
    },
    court_utilization: {
      sql: `SELECT c.name, c.number,
              COUNT(b.id) AS bookings,
              SUM(b.duration_minutes) AS total_minutes_booked
            FROM courts c
            LEFT JOIN bookings b ON b.court_id=c.id AND b.status IN ('confirmed','checked_in','completed')
              AND b.start_time BETWEEN $2 AND $3
            WHERE c.club_id=$1
            GROUP BY c.id, c.name, c.number ORDER BY c.number`,
      params: [clubId, from, to],
    },
    booking_history: {
      sql: `SELECT b.id, b.status, b.start_time, b.end_time, b.duration_minutes, b.total_price,
              c.name AS court, u.first_name, u.last_name, u.email, p.status AS payment_status
            FROM bookings b JOIN courts c ON c.id=b.court_id
            JOIN users u ON u.id=b.customer_id
            LEFT JOIN payments p ON p.booking_id=b.id
            WHERE b.club_id=$1 AND b.start_time BETWEEN $2 AND $3
            ORDER BY b.start_time DESC`,
      params: [clubId, from, to],
    },
    customer_activity: {
      sql: `SELECT u.id, u.email, u.first_name, u.last_name,
              COUNT(b.id) AS total_bookings,
              COUNT(b.id) FILTER (WHERE b.status='completed') AS completed,
              COUNT(b.id) FILTER (WHERE b.status='no_show') AS no_shows,
              COUNT(b.id) FILTER (WHERE b.status='cancelled') AS cancellations
            FROM users u LEFT JOIN bookings b ON b.customer_id=u.id AND b.start_time BETWEEN $2 AND $3
            WHERE u.club_id=$1 AND u.role='customer'
            GROUP BY u.id ORDER BY total_bookings DESC`,
      params: [clubId, from, to],
    },
    payment_history: {
      sql: `SELECT p.id, p.status, p.deposit_amount, p.total_amount, p.verified_at,
              b.start_time, c.name AS court, u.first_name, u.last_name
            FROM payments p JOIN bookings b ON b.id=p.booking_id
            JOIN courts c ON c.id=b.court_id JOIN users u ON u.id=p.customer_id
            WHERE p.club_id=$1 AND b.start_time BETWEEN $2 AND $3
            ORDER BY p.created_at DESC`,
      params: [clubId, from, to],
    },
    cancellation_report: {
      sql: `SELECT b.id, b.cancellation_reason, b.cancelled_at, b.start_time,
              c.name AS court, u.first_name, u.last_name
            FROM bookings b JOIN courts c ON c.id=b.court_id JOIN users u ON u.id=b.customer_id
            WHERE b.club_id=$1 AND b.status='cancelled' AND b.cancelled_at BETWEEN $2 AND $3
            ORDER BY b.cancelled_at DESC`,
      params: [clubId, from, to],
    },
    noshow_report: {
      sql: `SELECT b.id, b.start_time, b.noshow_at, c.name AS court, u.first_name, u.last_name
            FROM bookings b JOIN courts c ON c.id=b.court_id JOIN users u ON u.id=b.customer_id
            WHERE b.club_id=$1 AND b.status='no_show' AND b.noshow_at BETWEEN $2 AND $3
            ORDER BY b.noshow_at DESC`,
      params: [clubId, from, to],
    },
  };

  const q = QUERIES[type];
  const { rows } = await db.query(q.sql, q.params);
  return rows;
}

function generateCsv(data: unknown[]): Buffer {
  if (!data.length) return Buffer.from('No data\n');
  const headers = Object.keys(data[0] as object).join(',');
  const rows = data.map((row) =>
    Object.values(row as object).map((v) => JSON.stringify(v ?? '')).join(',')
  );
  return Buffer.from([headers, ...rows].join('\n'), 'utf-8');
}

async function generateExcel(data: unknown[], title: string): Promise<Buffer> {
  const xlsx = await import('xlsx');
  const ws   = xlsx.utils.json_to_sheet(data as object[]);
  const wb   = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function generatePdf(data: unknown[], title: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc  = await PDFDocument.create();
  const page = doc.addPage([842, 595]); // A4 landscape
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawText(`CourtFlow – ${title.replace(/_/g, ' ').toUpperCase()}`, {
    x: 40, y: 555, size: 16, font: bold, color: rgb(0, 0, 0),
  });
  page.drawText(`Generated: ${new Date().toISOString()}`, {
    x: 40, y: 535, size: 10, font, color: rgb(0.4, 0.4, 0.4),
  });

  if (data.length) {
    const cols = Object.keys(data[0] as object);
    const colWidth = Math.min(100, (842 - 80) / cols.length);
    let y = 510;

    // Header row
    cols.forEach((col, i) => {
      page.drawText(col.slice(0, 14), { x: 40 + i * colWidth, y, size: 8, font: bold, color: rgb(0, 0, 0) });
    });
    y -= 5;
    page.drawLine({ start: { x: 40, y }, end: { x: 802, y }, thickness: 0.5, color: rgb(0, 0, 0) });
    y -= 12;

    for (const row of data.slice(0, 40)) {
      if (y < 40) break;
      Object.values(row as object).forEach((val, i) => {
        const str = String(val ?? '').slice(0, 16);
        page.drawText(str, { x: 40 + i * colWidth, y, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
      });
      y -= 14;
    }
  }

  return Buffer.from(await doc.save());
}
