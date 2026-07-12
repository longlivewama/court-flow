/**
 * Email Service – Nodemailer wrapper with template-based emails.
 * All emails are sent via SMTP; retries handled with exponential back-off.
 */
import nodemailer from 'nodemailer';
import { logger } from '../../shared/logger';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Africa/Cairo';
const MAX_RETRIES = 3;

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendWithRetry(
  options: nodemailer.SendMailOptions,
  attempt = 1
): Promise<void> {
  try {
    await transporter.sendMail(options);
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 1000;
      logger.warn({ attempt, err }, `Email send failed, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return sendWithRetry(options, attempt + 1);
    }
    logger.error({ err, options }, 'Email send failed after all retries');
    throw err;
  }
}

function formatDateTime(date: Date): string {
  return format(toZonedTime(date, TIMEZONE), 'dd/MM/yyyy HH:mm');
}

function baseTemplate(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0a0a0a; color:#e5e5e5; margin:0; padding:0; }
  .container { max-width:600px; margin:40px auto; background:#111; border:1px solid #222; border-radius:8px; overflow:hidden; }
  .header { background:#000; padding:24px 32px; border-bottom:1px solid #222; }
  .header h1 { color:#fff; margin:0; font-size:20px; font-weight:600; letter-spacing:-0.5px; }
  .header span { color:#666; font-size:12px; }
  .body { padding:32px; }
  .body p { color:#aaa; line-height:1.6; margin:0 0 16px; }
  .detail-row { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #1a1a1a; }
  .detail-label { color:#666; font-size:14px; }
  .detail-value { color:#e5e5e5; font-size:14px; font-weight:500; }
  .badge { display:inline-block; padding:4px 12px; border-radius:100px; font-size:12px; font-weight:600; }
  .badge-green  { background:rgba(74,222,128,0.1); color:#4ade80; }
  .badge-red    { background:rgba(248,113,113,0.1); color:#f87171; }
  .badge-yellow { background:rgba(250,204,21,0.1);  color:#facc15; }
  .footer { padding:24px 32px; border-top:1px solid #222; text-align:center; }
  .footer p { color:#555; font-size:12px; margin:0; }
  .amount { font-size:28px; font-weight:700; color:#fff; font-variant-numeric:tabular-nums; }
  .cta { display:inline-block; margin-top:16px; padding:12px 24px; background:#fff; color:#000; 
         text-decoration:none; border-radius:6px; font-weight:600; font-size:14px; }
</style></head>
<body>
  <div class="container">
    <div class="header">
      <h1>CourtFlow</h1>
      <span>Padel Club Management</span>
    </div>
    <div class="body">
      <h2 style="color:#fff;margin:0 0 8px;font-size:18px;">${title}</h2>
      ${body}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} CourtFlow · All timestamps in Africa/Cairo timezone</p>
    </div>
  </div>
</body>
</html>`;
}

export const emailService = {
  async sendVerificationEmail(opts: {
    to: string; firstName: string; verificationLink: string;
  }): Promise<void> {
    const body = `
      <p>Hi ${opts.firstName}, welcome to CourtFlow!</p>
      <p>Please verify your email address to activate your account:</p>
      <a href="${opts.verificationLink}" class="cta">Verify Email Address</a>
      <p style="margin-top:24px;font-size:12px;color:#555">This link expires in 24 hours.</p>`;
    await sendWithRetry({
      from:    process.env.EMAIL_FROM,
      to:      opts.to,
      subject: 'Verify your CourtFlow account',
      html:    baseTemplate('Email Verification', body),
    });
  },

  async sendBookingConfirmation(opts: {
    to: string; firstName: string; bookingId: string;
    startTime: Date; depositAmount: number; totalPrice: number;
  }): Promise<void> {
    // pg returns NUMERIC/DECIMAL columns as strings to avoid precision loss,
    // so depositAmount/totalPrice may be strings at runtime despite the type.
    const depositAmount = Number(opts.depositAmount);
    const totalPrice    = Number(opts.totalPrice);
    const body = `
      <p>Hi ${opts.firstName}, your booking is confirmed!</p>
      <div style="margin:20px 0;">
        <div class="detail-row"><span class="detail-label">Booking ID</span><span class="detail-value">${opts.bookingId.slice(0,8).toUpperCase()}</span></div>
        <div class="detail-row"><span class="detail-label">Date & Time</span><span class="detail-value">${formatDateTime(opts.startTime)}</span></div>
        <div class="detail-row"><span class="detail-label">Deposit Paid</span><span class="detail-value">EGP ${depositAmount.toFixed(2)}</span></div>
        <div class="detail-row"><span class="detail-label">Remaining Balance</span><span class="detail-value">EGP ${(totalPrice - depositAmount).toFixed(2)}</span></div>
      </div>
      <p>Please arrive on time. The remaining balance is due at the club.</p>`;
    await sendWithRetry({
      from:    process.env.EMAIL_FROM,
      to:      opts.to,
      subject: 'Your court booking is confirmed – CourtFlow',
      html:    baseTemplate('Booking Confirmed', body),
    });
  },

  async sendPaymentRejected(opts: {
    to: string; firstName: string; bookingId: string; reason: string;
  }): Promise<void> {
    const body = `
      <p>Hi ${opts.firstName}, your payment receipt for booking <strong>${opts.bookingId.slice(0,8).toUpperCase()}</strong> was rejected.</p>
      <div style="background:#1a0a0a;border:1px solid #3a0a0a;border-radius:6px;padding:16px;margin:20px 0;">
        <p style="color:#f87171;margin:0;"><strong>Reason:</strong> ${opts.reason}</p>
      </div>
      <p>Please re-upload a clear photo or PDF of your bank transfer receipt.</p>`;
    await sendWithRetry({
      from:    process.env.EMAIL_FROM,
      to:      opts.to,
      subject: 'Payment receipt rejected – Action required',
      html:    baseTemplate('Receipt Rejected', body),
    });
  },

  async sendBookingCancellation(opts: {
    to: string; firstName: string; bookingId: string;
    startTime: Date; refundStatus: string;
  }): Promise<void> {
    const body = `
      <p>Hi ${opts.firstName}, your booking has been cancelled.</p>
      <div style="margin:20px 0;">
        <div class="detail-row"><span class="detail-label">Booking ID</span><span class="detail-value">${opts.bookingId.slice(0,8).toUpperCase()}</span></div>
        <div class="detail-row"><span class="detail-label">Original Date</span><span class="detail-value">${formatDateTime(opts.startTime)}</span></div>
        <div class="detail-row"><span class="detail-label">Refund Status</span><span class="detail-value">${opts.refundStatus}</span></div>
      </div>`;
    await sendWithRetry({
      from:    process.env.EMAIL_FROM,
      to:      opts.to,
      subject: 'Booking cancellation – CourtFlow',
      html:    baseTemplate('Booking Cancelled', body),
    });
  },

  async sendBookingReminder(opts: {
    to: string; firstName: string; bookingId: string;
    startTime: Date; reminderType: string;
  }): Promise<void> {
    const body = `
      <p>Hi ${opts.firstName}, this is a reminder for your upcoming court booking.</p>
      <div style="text-align:center;padding:20px 0;">
        <div class="amount">${formatDateTime(opts.startTime)}</div>
        <p style="color:#666;margin-top:8px;">${opts.reminderType === '24h' ? '24 hours' : '2 hours'} from now</p>
      </div>
      <p>Booking ID: ${opts.bookingId.slice(0,8).toUpperCase()}</p>`;
    await sendWithRetry({
      from:    process.env.EMAIL_FROM,
      to:      opts.to,
      subject: `Reminder: Court booking in ${opts.reminderType} – CourtFlow`,
      html:    baseTemplate('Booking Reminder', body),
    });
  },

  async sendNoShowNotice(opts: {
    to: string; firstName: string; bookingId: string; startTime: Date;
  }): Promise<void> {
    const body = `
      <p>Hi ${opts.firstName}, your booking for <strong>${formatDateTime(opts.startTime)}</strong> has been marked as a <strong>No Show</strong> because check-in was not completed within the grace period.</p>
      <p>If you believe this is an error, please contact the club directly.</p>`;
    await sendWithRetry({
      from:    process.env.EMAIL_FROM,
      to:      opts.to,
      subject: 'No-Show recorded for your booking – CourtFlow',
      html:    baseTemplate('No Show Recorded', body),
    });
  },

  async sendPasswordReset(opts: {
    to: string; firstName: string; resetLink: string;
  }): Promise<void> {
    const body = `
      <p>Hi ${opts.firstName}, you requested a password reset.</p>
      <a href="${opts.resetLink}" class="cta">Reset Password</a>
      <p style="margin-top:24px;font-size:12px;color:#555">This link expires in 1 hour and can only be used once.</p>`;
    await sendWithRetry({
      from:    process.env.EMAIL_FROM,
      to:      opts.to,
      subject: 'Password reset request – CourtFlow',
      html:    baseTemplate('Reset Your Password', body),
    });
  },
};
