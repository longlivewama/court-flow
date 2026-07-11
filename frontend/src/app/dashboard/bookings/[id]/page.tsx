'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  Calendar, Clock, MapPin, AlertCircle, ArrowLeft, CreditCard,
  CheckCircle2, XCircle, AlertTriangle, Zap, StickyNote,
  ChevronDown, Loader2, BadgeCheck, Wallet, TrendingDown, UploadCloud, Trash2,
} from 'lucide-react';
import { StateChip, BookingStatus } from '@/components/StateChip';

const TIMEZONE = 'Africa/Cairo';

type DepositStatus = 'NOT_PAID' | 'DEPOSIT_PAID' | 'FULLY_PAID';
type PaymentMethod = 'CASH' | 'VODAFONE_CASH' | 'INSTAPAY' | 'NONE';

interface BookingDetails {
  id: string;
  status: BookingStatus;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  total_price: number;
  deposit_amount: number;
  deposit_method: PaymentMethod;
  remainder_amount: number;
  remainder_method: PaymentMethod;
  remaining_balance: number;
  first_name?: string;
  last_name?: string;
  customer_email?: string;
  court_name: string;
  court_number: number;
  payment_status: string;
  cancellation_reason?: string;
  created_at: string;
  // Phase 2 financial fields
  deposit_status: DepositStatus;
  payment_method: PaymentMethod;
  amount_paid: number;
  discount_amount: number;
  admin_notes?: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────
function methodLabel(m: string) {
  if (!m || m === 'NONE') return 'N/A';
  return m.replace(/_/g, ' ');
}

// ── Financial Summary Banner ──────────────────────────────────────────────────
function FinancialSummaryBanner({ booking }: { booking: BookingDetails }) {
  const depositAmt   = Number(booking.deposit_amount ?? 0);
  const remainderAmt = Number(booking.remainder_amount ?? 0);
  const totalPrice   = Number(booking.total_price ?? 0);
  const discount     = Number(booking.discount_amount ?? 0);
  const netPrice     = Math.max(totalPrice - discount, 0);
  const totalPaid    = depositAmt + remainderAmt;
  const unpaid       = Math.max(netPrice - totalPaid, 0);

  const isFullyPaid  = unpaid <= 0 && netPrice > 0;
  const hasDeposit   = depositAmt > 0;
  const hasRemainder = remainderAmt > 0;
  const hasUnpaid    = unpaid > 0;

  const accentColor = isFullyPaid ? '#22c55e' : hasUnpaid ? '#ef4444' : '#eab308';
  const bgColor = isFullyPaid
    ? 'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(16,185,129,0.06) 100%)'
    : hasUnpaid
      ? 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(220,38,38,0.06) 100%)'
      : 'linear-gradient(135deg, rgba(234,179,8,0.12) 0%, rgba(245,158,11,0.06) 100%)';

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.05 }}
      style={{
        background: bgColor,
        border: `1px solid ${accentColor}33`,
        borderRadius: 14,
        padding: '16px 20px',
        marginBottom: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <Wallet size={16} style={{ color: accentColor }} />
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: accentColor }}>
          Financial Summary
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {/* Deposit pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 14px', borderRadius: 999,
          background: hasDeposit ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${hasDeposit ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
        }}>
          <CheckCircle2 size={13} style={{ color: hasDeposit ? '#22c55e' : 'var(--text-tertiary)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: hasDeposit ? '#22c55e' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {hasDeposit
              ? `Deposit Paid: EGP ${depositAmt.toFixed(2)} via ${methodLabel(booking.deposit_method)}`
              : 'No Deposit Paid'}
          </span>
        </div>

        {/* Remainder pill */}
        {hasRemainder && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '6px 14px', borderRadius: 999,
            background: 'rgba(139,92,246,0.15)',
            border: '1px solid rgba(139,92,246,0.3)',
          }}>
            <CheckCircle2 size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#8b5cf6', fontFamily: 'var(--font-mono)' }}>
              {`Remainder Paid: EGP ${remainderAmt.toFixed(2)} via ${methodLabel(booking.remainder_method)}`}
            </span>
          </div>
        )}

        {/* Unpaid remainder pill */}
        {hasUnpaid && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '6px 14px', borderRadius: 999,
            background: 'rgba(239,68,68,0.18)',
            border: '1px solid rgba(239,68,68,0.4)',
          }}>
            <TrendingDown size={13} style={{ color: '#ef4444', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>
              {`Remaining Balance UNPAID: EGP ${unpaid.toFixed(2)}`}
            </span>
          </div>
        )}

        {/* Fully paid pill */}
        {isFullyPaid && !hasUnpaid && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '6px 14px', borderRadius: 999,
            background: 'rgba(34,197,94,0.18)',
            border: '1px solid rgba(34,197,94,0.4)',
          }}>
            <BadgeCheck size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', fontFamily: 'var(--font-mono)' }}>
              Fully Settled ✓
            </span>
          </div>
        )}
      </div>

      {discount > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          Net price after EGP {discount.toFixed(2)} discount:{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>EGP {netPrice.toFixed(2)}</strong>
        </div>
      )}
    </motion.div>
  );
}

// ── Deposit Status Badge ──────────────────────────────────────────────────────
function DepositStatusBadge({ status }: { status: DepositStatus }) {
  const config = {
    NOT_PAID: {
      label: 'Unpaid / Pending Deposit',
      icon: <XCircle size={13} />,
      bg: '#ef4444',
      ring: 'rgba(239,68,68,0.25)',
      text: '#fff',
    },
    DEPOSIT_PAID: {
      label: 'Deposit Paid / Partial',
      icon: <AlertTriangle size={13} />,
      bg: '#eab308',
      ring: 'rgba(234,179,8,0.25)',
      text: '#1a1a1a',
    },
    FULLY_PAID: {
      label: 'Fully Settled',
      icon: <CheckCircle2 size={13} />,
      bg: '#22c55e',
      ring: 'rgba(34,197,94,0.25)',
      text: '#fff',
    },
  } as const;

  const { label, icon, bg, ring, text } = config[status] ?? config['NOT_PAID'];

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        background: bg,
        color: text,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.02em',
        boxShadow: `0 0 0 3px ${ring}`,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
    </motion.span>
  );
}

// ── Settle Form ───────────────────────────────────────────────────────────────
interface SettleFormProps {
  booking: BookingDetails;
  onSuccess: () => void;
}

function SettleForm({ booking, onSuccess }: SettleFormProps) {
  // Deposit fields
  const [depositAmount, setDepositAmount]     = useState<string>(String(Number(booking.deposit_amount ?? 0)));
  const [depositMethod, setDepositMethod]     = useState<PaymentMethod>(
    booking.deposit_method && booking.deposit_method !== 'NONE' ? booking.deposit_method : 'CASH'
  );
  // Remainder fields
  const [remainderAmount, setRemainderAmount] = useState<string>(String(Number(booking.remainder_amount ?? 0)));
  const [remainderMethod, setRemainderMethod] = useState<PaymentMethod>(
    booking.remainder_method && booking.remainder_method !== 'NONE' ? booking.remainder_method : 'CASH'
  );
  // Other
  const [discount, setDiscount]       = useState<string>(String(Number(booking.discount_amount ?? 0)));
  const [adminNotes, setAdminNotes]   = useState<string>(booking.admin_notes ?? '');
  const [loading, setLoading]         = useState(false);
  const [feedback, setFeedback]       = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const totalPrice = Number(booking.total_price);
  const netPrice   = Math.max(totalPrice - Number(discount || 0), 0);
  const totalPaid  = Number(depositAmount || 0) + Number(remainderAmount || 0);
  const unpaid     = Math.max(netPrice - totalPaid, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);
    try {
      await api.patch(`/bookings/${booking.id}/settle`, {
        depositAmount:   Number(depositAmount),
        depositMethod,
        remainderAmount: Number(remainderAmount),
        remainderMethod,
        discountAmount:  Number(discount),
        adminNotes:      adminNotes || null,
      });
      setFeedback({ type: 'ok', msg: 'Payment settled successfully!' });
      setTimeout(() => onSuccess(), 800);
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err?.response?.data?.message ?? 'Settlement failed. Please retry.' });
    } finally {
      setLoading(false);
    }
  }

  function quickSettleCash() {
    setDepositAmount(String(netPrice));
    setDepositMethod('CASH');
    setRemainderAmount('0');
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-tertiary)',
    marginBottom: 6,
    display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box',
  };

  const sectionHeadStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-tertiary)',
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
    marginBottom: 10,
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Quick settle button */}
      <motion.button
        type="button"
        onClick={quickSettleCash}
        whileHover={{ scale: 1.015 }}
        whileTap={{ scale: 0.975 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          padding: '11px 0',
          borderRadius: 10,
          background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
          letterSpacing: '0.01em',
        }}
      >
        <Zap size={16} />
        Quick Settle — Full Cash (EGP {netPrice.toFixed(2)})
      </motion.button>

      {/* ── Deposit Section ────────────────────────────────── */}
      <div>
        <div style={sectionHeadStyle}>💰 Deposit Payment</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Deposit Amount (EGP)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Deposit Method</label>
            <div style={{ position: 'relative' }}>
              <select
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value as PaymentMethod)}
                style={{ ...inputStyle, appearance: 'none', paddingRight: 32, cursor: 'pointer' }}
              >
                <option value="CASH">💵 Cash</option>
                <option value="VODAFONE_CASH">📱 Vodafone Cash</option>
                <option value="INSTAPAY">⚡ InstaPay</option>
                <option value="NONE">— None</option>
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Remainder Section ─────────────────────────────── */}
      <div>
        <div style={sectionHeadStyle}>💳 Remainder Payment</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Remainder Amount (EGP)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={remainderAmount}
              onChange={(e) => setRemainderAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Remainder Method</label>
            <div style={{ position: 'relative' }}>
              <select
                value={remainderMethod}
                onChange={(e) => setRemainderMethod(e.target.value as PaymentMethod)}
                style={{ ...inputStyle, appearance: 'none', paddingRight: 32, cursor: 'pointer' }}
              >
                <option value="CASH">💵 Cash</option>
                <option value="VODAFONE_CASH">📱 Vodafone Cash</option>
                <option value="INSTAPAY">⚡ InstaPay</option>
                <option value="NONE">— None</option>
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Discount */}
      <div>
        <label style={labelStyle}>Discount Amount (EGP)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="0.00"
          style={inputStyle}
        />
      </div>

      {/* Live balance preview */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderRadius: 10,
          background: unpaid === 0
            ? 'rgba(34,197,94,0.08)'
            : 'rgba(239,68,68,0.08)',
          border: `1px solid ${unpaid === 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.25)'}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
            {unpaid === 0 ? '✓ Fully Settled' : '⚠ Remaining Balance Unpaid'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {`Total paid: EGP ${totalPaid.toFixed(2)} of EGP ${netPrice.toFixed(2)}`}
          </span>
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 17,
            fontWeight: 700,
            color: unpaid === 0 ? '#22c55e' : '#ef4444',
          }}
        >
          EGP {unpaid.toFixed(2)}
        </span>
      </div>

      {/* Admin Notes */}
      <div>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <StickyNote size={12} /> Admin Notes
        </label>
        <textarea
          rows={3}
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          placeholder="Internal notes about this payment or customer…"
          style={{
            ...inputStyle,
            resize: 'vertical',
            lineHeight: 1.5,
          }}
        />
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            key="feedback"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: feedback.type === 'ok'
                ? 'rgba(34,197,94,0.1)'
                : 'rgba(239,68,68,0.1)',
              border: `1px solid ${feedback.type === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
              color: feedback.type === 'ok' ? '#22c55e' : '#ef4444',
              fontSize: 13,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {feedback.type === 'ok'
              ? <CheckCircle2 size={15} />
              : <XCircle size={15} />}
            {feedback.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Submit */}
      <motion.button
        type="submit"
        disabled={loading}
        whileHover={{ scale: loading ? 1 : 1.01 }}
        whileTap={{ scale: loading ? 1 : 0.98 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px 0',
          borderRadius: 10,
          background: loading
            ? 'var(--bg-secondary)'
            : 'linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%)',
          color: loading ? 'var(--text-tertiary)' : '#fff',
          fontWeight: 700,
          fontSize: 14,
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
          boxShadow: loading ? 'none' : '0 4px 14px rgba(124,58,237,0.3)',
        }}
      >
        {loading
          ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
          : <><BadgeCheck size={15} /> Save Settlement</>}
      </motion.button>
    </form>
  );
}

// ── Receipt Upload Form (Customer) ─────────────────────────────────────────────
const RECEIPT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const RECEIPT_MAX_SIZE_MB = 10;

interface ReceiptUploadFormProps {
  bookingId: string;
  status: BookingStatus;
  onSuccess: () => void;
}

function ReceiptUploadForm({ bookingId, status, onSuccess }: ReceiptUploadFormProps) {
  const [file, setFile]           = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback]   = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFeedback(null);
    if (!selected) { setFile(null); return; }
    if (!RECEIPT_ALLOWED_TYPES.includes(selected.type)) {
      setFile(null);
      setFeedback({ type: 'err', msg: 'Invalid file type. Please upload a JPEG, PNG, or PDF.' });
      return;
    }
    if (selected.size > RECEIPT_MAX_SIZE_MB * 1024 * 1024) {
      setFile(null);
      setFeedback({ type: 'err', msg: `File too large. Maximum size is ${RECEIPT_MAX_SIZE_MB} MB.` });
      return;
    }
    setFile(selected);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      await api.post(`/bookings/${bookingId}/receipt`, formData);
      setFeedback({ type: 'ok', msg: 'Receipt uploaded successfully. Awaiting verification.' });
      setFile(null);
      setTimeout(() => onSuccess(), 900);
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err?.response?.data?.message ?? 'Upload failed. Please retry.' });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0 }}>
        {status === 'pending_verification'
          ? 'Your receipt is awaiting review. If it was rejected, upload a new one below.'
          : 'Upload a photo or PDF of your deposit payment receipt to proceed.'}
      </p>

      <label
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '28px 16px', borderRadius: 10,
          border: `1.5px dashed ${file ? 'var(--accent)' : 'var(--border)'}`,
          background: 'var(--bg-secondary)', cursor: 'pointer', textAlign: 'center',
        }}
      >
        <UploadCloud size={22} style={{ color: file ? 'var(--accent)' : 'var(--text-tertiary)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {file ? file.name : 'Choose a file or drag it here'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          JPEG, PNG, or PDF · up to {RECEIPT_MAX_SIZE_MB}MB
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </label>

      <AnimatePresence>
        {feedback && (
          <motion.div
            key="upload-feedback"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: feedback.type === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${feedback.type === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
              color: feedback.type === 'ok' ? '#22c55e' : '#ef4444',
              fontSize: 13,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {feedback.type === 'ok' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {feedback.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="submit"
        disabled={!file || uploading}
        whileHover={{ scale: (!file || uploading) ? 1 : 1.01 }}
        whileTap={{ scale: (!file || uploading) ? 1 : 0.98 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px 0',
          borderRadius: 10,
          background: (!file || uploading)
            ? 'var(--bg-secondary)'
            : 'linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%)',
          color: (!file || uploading) ? 'var(--text-tertiary)' : '#fff',
          fontWeight: 700,
          fontSize: 14,
          border: 'none',
          cursor: (!file || uploading) ? 'not-allowed' : 'pointer',
          boxShadow: (!file || uploading) ? 'none' : '0 4px 14px rgba(124,58,237,0.3)',
        }}
      >
        {uploading
          ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</>
          : <><UploadCloud size={15} /> Upload Receipt</>}
      </motion.button>
    </form>
  );
}

// ── Delete Booking (Owner only) ─────────────────────────────────────────────
const MODAL_SPRING = { type: 'spring' as const, stiffness: 380, damping: 30 };

function DeleteBookingCard({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [open, setOpen]         = useState(false);
  const [reason, setReason]     = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError]       = useState('');

  async function confirmDelete() {
    setDeleting(true);
    setError('');
    try {
      await api.delete(`/bookings/${bookingId}`, { data: { reason } });
      router.push('/bookings');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Deletion failed. Please retry.');
      setDeleting(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.6 }}>
          Permanently erase this booking and its payment/receipt records, freeing the
          court slot immediately. This cannot be undone — a full snapshot is preserved
          in the audit log. Bookings with refund records cannot be deleted.
        </p>
        <motion.button
          type="button"
          className="btn btn-danger"
          onClick={() => { setError(''); setReason(''); setOpen(true); }}
          whileTap={{ scale: 0.97 }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Trash2 size={15} />
          Delete Booking…
        </motion.button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="overlay-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={MODAL_SPRING}
            >
              <h3 style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Trash2 size={16} style={{ color: 'var(--error)' }} />
                Permanently Delete Booking
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                This wipes the booking from the system. The action is recorded in the
                immutable audit log with your identity and the reason below.
              </p>
              <div className="input-group" style={{ marginBottom: 20 }}>
                <label className="input-label">Reason for deletion (required)</label>
                <textarea
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Duplicate entry created by mistake…"
                  rows={3}
                  aria-label="Deletion reason"
                />
              </div>
              {error && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                  color: '#ef4444', fontSize: 13, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <XCircle size={15} /> {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={deleting}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={confirmDelete}
                  disabled={!reason.trim() || deleting}
                >
                  {deleting
                    ? <div className="spinner" style={{ width: 12, height: 12 }} />
                    : <Trash2 size={13} />}
                  Confirm Deletion
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BookingDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }  = use(params);
  const router  = useRouter();
  const { user } = useAuthStore();

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const isStaff = user?.role === 'owner' || user?.role === 'receptionist';

  async function loadBooking() {
    try {
      const { data } = await api.get(`/bookings/${id}`);
      setBooking(data.data ?? data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to load booking details.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBooking(); }, [id]);

  function refreshBooking() {
    setLoading(true);
    setBooking(null);
    loadBooking();
  }

  /* ── Loading skeleton ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div className="skeleton" style={{ height: 32, width: 200, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 20, width: 300 }} />
        </div>
        <div className="card" style={{ padding: 32, marginTop: 24, height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div className="spinner" style={{ width: 32, height: 32, color: 'var(--accent)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Loading booking details…</span>
          </div>
        </div>
      </div>
    );
  }

  /* ── Error state ──────────────────────────────────────────────── */
  if (error || !booking) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Booking Details</h1>
            <p className="page-subtitle">Could not retrieve booking information</p>
          </div>
          <button className="btn btn-ghost" onClick={() => router.back()}>
            <ArrowLeft size={16} /> Back
          </button>
        </div>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertCircle size={48} style={{ color: 'var(--color-error, #ef4444)', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>{error || 'Booking not found'}</h2>
          <p style={{ color: 'var(--text-secondary)' }}>The booking ID you provided does not exist or you do not have permission to view it.</p>
        </div>
      </div>
    );
  }

  const depositStatus = booking.deposit_status ?? 'NOT_PAID';

  // Derive calculated financial values
  const depositAmt    = Number(booking.deposit_amount ?? 0);
  const remainderAmt  = Number(booking.remainder_amount ?? 0);
  const discount      = Number(booking.discount_amount ?? 0);
  const totalPrice    = Number(booking.total_price ?? 0);
  const netPrice      = Math.max(totalPrice - discount, 0);
  const totalPaid     = depositAmt + remainderAmt;
  const unpaidBalance = Math.max(netPrice - totalPaid, 0);

  /* ── Main render ─────────────────────────────────────────────────────────── */
  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <button
            onClick={() => router.back()}
            className="btn btn-ghost btn-sm"
            style={{ padding: '0', marginBottom: 12, color: 'var(--text-secondary)' }}
          >
            <ArrowLeft size={14} style={{ marginRight: 6 }} /> Back
          </button>
          <h1 className="page-title">Booking {booking.id.slice(0, 8).toUpperCase()}</h1>
          <p className="page-subtitle">
            Created on {format(toZonedTime(new Date(booking.created_at), TIMEZONE), 'MMM d, yyyy')}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <StateChip status={booking.status} size="md" />
          <DepositStatusBadge status={depositStatus} />
        </div>
      </div>

      {/* ── Financial Summary Banner (always visible) ─────────────── */}
      <FinancialSummaryBanner booking={booking} />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}
      >
        {/* ── Customer & Court ───────────────────────────────────── */}
        <div className="card" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={18} color="var(--accent)" />
            Customer &amp; Court
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Court</span>
              <span style={{ fontWeight: 500 }}>{booking.court_name} (Court {booking.court_number})</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Customer</span>
              <span style={{ fontWeight: 500 }}>{booking.first_name} {booking.last_name}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Email</span>
              <span style={{ fontWeight: 500 }}>{booking.customer_email || 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* ── Schedule & Time ────────────────────────────────────── */}
        <div className="card" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={18} color="var(--accent)" />
            Schedule &amp; Time
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Date</span>
              <span style={{ fontWeight: 500 }}>
                {format(toZonedTime(new Date(booking.start_time), TIMEZONE), 'EEEE, MMM d, yyyy')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Time</span>
              <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={14} />
                {format(toZonedTime(new Date(booking.start_time), TIMEZONE), 'HH:mm')} – {format(toZonedTime(new Date(booking.end_time), TIMEZONE), 'HH:mm')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
              <span style={{ fontWeight: 500 }}>{booking.duration_minutes} minutes</span>
            </div>
          </div>
        </div>

        {/* ── Payment Overview ───────────────────────────────────── */}
        <div className="card" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={18} color="var(--accent)" />
            Payment Overview
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {([
              ['Total Price',      `EGP ${totalPrice.toFixed(2)}`,       'total'],
              ['Discount Applied', `EGP ${discount.toFixed(2)}`,          'discount'],
              ['Net Price',        `EGP ${netPrice.toFixed(2)}`,          'net'],
              ['Deposit Paid',     `EGP ${depositAmt.toFixed(2)}`,        'deposit'],
              ['Deposit Method',   methodLabel(booking.deposit_method),   'dep_method'],
              ['Remainder Paid',   `EGP ${remainderAmt.toFixed(2)}`,      'remainder'],
              ['Remainder Method', methodLabel(booking.remainder_method), 'rem_method'],
              ['Total Paid',       `EGP ${totalPaid.toFixed(2)}`,         'paid'],
              ['Unpaid Balance',   `EGP ${unpaidBalance.toFixed(2)}`,     'unpaid'],
            ] as [string, string, string][]).map(([label, value, key], i, arr) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : undefined,
                  paddingBottom: i < arr.length - 1 ? 12 : 0,
                }}
              >
                <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{label}</span>
                <span
                  style={{
                    fontWeight: (label === 'Total Price' || label === 'Unpaid Balance') ? 700 : 500,
                    fontFamily: !label.includes('Method') ? 'var(--font-mono)' : undefined,
                    color: label === 'Unpaid Balance'
                      ? (unpaidBalance === 0 ? '#22c55e' : '#ef4444')
                      : label === 'Total Paid'
                        ? '#22c55e'
                        : 'var(--text-primary)',
                    fontSize: label === 'Total Price' ? 15 : 14,
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>


          {/* Deposit status badge inside card */}
          <div style={{ marginTop: 18 }}>
            <DepositStatusBadge status={depositStatus} />
          </div>

          {/* Admin notes display */}
          {booking.admin_notes && (
            <div
              style={{
                marginTop: 16,
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--bg-secondary)',
                borderLeft: '3px solid var(--accent)',
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                Admin Notes
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {booking.admin_notes}
              </p>
            </div>
          )}

          <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
              Club Cancellation Policy
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              Cancellations made within 24 hours of the scheduled start time will result in forfeiture of the deposit.
              Please contact the club for rescheduling.
            </p>
          </div>
        </div>

        {/* ── Financial Settlement (Staff only) ─────────────────── */}
        {isStaff && (
          <motion.div
            className="card"
            style={{ padding: 28 }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h2
              style={{
                fontSize: 16, fontWeight: 600, marginBottom: 6,
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Zap size={18} color="#eab308" />
              Financial Settlement
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
              Record deposit and remainder payments. Updates deposit status automatically.
            </p>
            <SettleForm booking={booking} onSuccess={refreshBooking} />
          </motion.div>
        )}

        {/* ── Receipt Upload (Customer only) ─────────────────────── */}
        {user?.role === 'customer' &&
          (booking.status === 'pending_deposit' || booking.status === 'pending_verification') && (
          <motion.div
            className="card"
            style={{ padding: 28 }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h2
              style={{
                fontSize: 16, fontWeight: 600, marginBottom: 6,
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <UploadCloud size={18} color="var(--accent)" />
              Upload Deposit Receipt
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
              Submit proof of your deposit payment so our team can confirm your booking.
            </p>
            <ReceiptUploadForm bookingId={booking.id} status={booking.status} onSuccess={refreshBooking} />
          </motion.div>
        )}

        {/* ── Danger Zone: Permanent Deletion (Owner only) ────────── */}
        {user?.role === 'owner' && (
          <motion.div
            className="card"
            style={{ padding: 28, border: '1px solid rgba(239,68,68,0.25)' }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <h2
              style={{
                fontSize: 16, fontWeight: 600, marginBottom: 6,
                display: 'flex', alignItems: 'center', gap: 8, color: 'var(--error)',
              }}
            >
              <Trash2 size={18} />
              Danger Zone
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
              Owner-only destructive action, tracked in the immutable audit log.
            </p>
            <DeleteBookingCard bookingId={booking.id} />
          </motion.div>
        )}
      </motion.div>

      {/* Keyframes */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulseRed {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.0); }
          50%       { box-shadow: 0 0 0 4px rgba(239,68,68,0.25); }
        }
      `}</style>
    </div>
  );
}
