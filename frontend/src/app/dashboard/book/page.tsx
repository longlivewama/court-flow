'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import {
  Calendar, Clock, CreditCard, Search, User, ChevronDown, X, UploadCloud, Wallet,
} from 'lucide-react';
import { format, addMinutes } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { bookingSchema } from '@/lib/schemas';

const TIMEZONE = 'Africa/Cairo';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Court {
  id: string;
  name: string;
  court_number: number;
  price_per_hour: number;
  surface_type: string;
  is_indoor: boolean;
}

interface Customer {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

// Bookings are whole-hour blocks: start/end dropdowns only offer :00
// options, and a booking can span up to MAX_BOOKING_HOURS consecutive
// hours (wrapping past midnight into the next day).
const MAX_BOOKING_HOURS = 12;

/** 0-based hour (may exceed 23 when wrapping past midnight) → "hh:00 AM/PM" */
function hourLabel(rawHour: number): string {
  const h24      = rawHour % 24;
  const ampm     = h24 >= 12 ? 'PM' : 'AM';
  const displayH = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix   = h24 === 0 ? ' (Midnight)' : h24 === 12 ? ' (Noon)' : '';
  return `${String(displayH).padStart(2, '0')}:00 ${ampm}${suffix}`;
}

// ── Customer search dropdown ──────────────────────────────────────────────────
interface CustomerPickerProps {
  customers:  Customer[];
  loading:    boolean;
  value:      Customer | null;
  onChange:   (c: Customer | null) => void;
  searchText: string;
  onSearch:   (q: string) => void;
}

function CustomerPicker({ customers, loading, value, onChange, searchText, onSearch }: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger / selected display */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 12px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontSize: 14,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'border-color 0.15s',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        id="customer-picker-btn"
      >
        <User size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <span style={{ flex: 1 }}>
          {value
            ? `${value.first_name} ${value.last_name} · ${value.email}`
            : 'Select a customer…'}
        </span>
        {value && (
          <span
            role="button"
            aria-label="Clear customer"
            onClick={(e) => { e.stopPropagation(); onChange(null); onSearch(''); }}
            style={{ lineHeight: 0, cursor: 'pointer', color: 'var(--text-tertiary)' }}
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown
          size={13}
          style={{
            color: 'var(--text-tertiary)', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0, right: 0,
              zIndex: 50,
              background: 'var(--bg-elevated, var(--bg-secondary))',
              border: '1px solid var(--border)',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
            role="listbox"
            aria-label="Customer list"
          >
            {/* Search input */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <Search size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <input
                autoFocus
                placeholder="Search name or email…"
                value={searchText}
                onChange={(e) => onSearch(e.target.value)}
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  outline: 'none', fontSize: 13, color: 'var(--text-primary)',
                }}
                aria-label="Search customers"
              />
            </div>

            {/* Results */}
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} style={{ padding: '10px 12px' }}>
                    <div className="skeleton" style={{ height: 13, width: i === 0 ? '70%' : '55%', marginBottom: 4 }} />
                    <div className="skeleton" style={{ height: 11, width: '40%' }} />
                  </div>
                ))
              ) : customers.length === 0 ? (
                <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>
                  No customers found
                </div>
              ) : (
                customers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={value?.id === c.id}
                    onClick={() => { onChange(c); setOpen(false); onSearch(''); }}
                    style={{
                      width: '100%', display: 'flex', flexDirection: 'column',
                      gap: 2, padding: '10px 12px', background: value?.id === c.id
                        ? 'var(--accent-muted, rgba(124,58,237,0.08))'
                        : 'transparent',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = value?.id === c.id
                        ? 'var(--accent-muted, rgba(124,58,237,0.08))'
                        : 'transparent';
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {c.first_name} {c.last_name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{c.email}</span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Customer receipt constraints (mirror backend upload-receipt.usecase)
const RECEIPT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const RECEIPT_MAX_SIZE_MB   = 10;

// ── Main page ─────────────────────────────────────────────────────────────────
function BookCourtForm() {
  const router                   = useRouter();
  const searchParams             = useSearchParams();
  const { user, accessToken }    = useAuthStore();
  const isStaff                  = user?.role === 'owner' || user?.role === 'receptionist';

  // Deep-link prefill from the availability grid: ?court=&date=&hour=
  const prefillCourt = searchParams.get('court') ?? '';
  const prefillDate  = searchParams.get('date');
  const prefillHour  = searchParams.get('hour');

  // Court state
  const [courts, setCourts]               = useState<Court[]>([]);
  const [selectedCourt, setCourt]         = useState(prefillCourt);
  const [courtsLoading, setCourtsLoading] = useState(true);

  // Customer state (staff-only)
  const [customerName, setCustomerName]   = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // Schedule state – whole-hour blocks only (minutes locked to :00).
  // `endHourRaw` may exceed 23 when the booking wraps past midnight
  // (e.g. start 21 → end 25 means 01:00 AM the next day).
  const initialHour = prefillHour !== null ? parseInt(prefillHour, 10) || 0 : 9;
  const [date, setDate]             = useState(prefillDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [hour, setHour]             = useState(initialHour);
  const [endHourRaw, setEndHourRaw] = useState(initialHour + 1);

  // Payment state (staff-only)
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositMethod, setDepositMethod] = useState('NONE');
  const [remainderAmount, setRemainderAmount] = useState(0);
  const [remainderMethod, setRemainderMethod] = useState('NONE');

  // Payment state (customer-only): self-reported payment + mandatory receipt
  const [amountPaid, setAmountPaid]     = useState('');
  const [paymentMethod, setPaymentMethod] = useState('INSTAPAY');
  const [receiptFile, setReceiptFile]   = useState<File | null>(null);

  // UI state
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState('');
  const [optimisticSuccess, setOptimisticSuccess] = useState(false);

  // ── Load courts ───────────────────────────────────────────────
  const loadCourts = useCallback(async () => {
    try {
      const { data } = await api.get('/courts');
      setCourts(data.data ?? data);
    } catch {
      setCourts([]);
    } finally {
      setCourtsLoading(false);
    }
  }, []);

  useEffect(() => { loadCourts(); }, [loadCourts]);

  // ── Derived values ────────────────────────────────────────────
  const duration = (endHourRaw - hour) * 60; // whole-hour blocks → always a multiple of 60

  // Changing the start time preserves the chosen span (e.g. a 3-hour
  // booking stays 3 hours), so the end dropdown never goes stale.
  function handleStartHourChange(newHour: number) {
    const spanHours = endHourRaw - hour;
    setHour(newHour);
    setEndHourRaw(newHour + spanHours);
  }

  const selectedCourtObj = courts.find((c) => c.id === selectedCourt);
  const totalPrice = selectedCourtObj
    ? (selectedCourtObj.price_per_hour * duration) / 60
    : 0;

  // Build the booking start as a Cairo-local datetime, then convert to UTC.
  //
  // OVERNIGHT BOUNDARY RULE (aligns the picker with the dashboard schedule
  // window in getDailySchedule, which spans 12:00 PM a date → 06:00 AM the
  // NEXT calendar day, Cairo):
  //
  //   So booking "01:00 AM" while the date picker shows "July 11" means
  //   01:00 AM Cairo on July 12 (the close-of-night of the July 11 shift),
  //   NOT 01:00 AM Cairo on July 11 (which belongs to July 10's shift).
  //
  //   Rule: if selectedHour < 6, the physical Cairo calendar date = selectedDate + 1.
  //
  // This only affects which calendar day an early-morning slot maps to; the
  // booking's legality is decided server-side against the club's configured
  // working hours (booking.validator.ts), which now supports 24-hour and
  // midnight-spanning schedules — early-morning and cross-midnight slots are
  // no longer rejected outright.
  //
  // We pass the string literal directly to fromZonedTime (not via new Date())
  // to avoid browser-local-timezone ambiguity on ISO strings without a Z suffix.
  const pad = (n: number) => String(n).padStart(2, '0');

  const OVERNIGHT_CUTOFF = 6; // schedule business-day boundary (see getDailySchedule)

  // Resolve the physical Cairo calendar date for this slot.
  const cairoCalendarDate = (() => {
    if (hour < OVERNIGHT_CUTOFF) {
      // Post-midnight slot: advance the calendar date by 1 day so the UTC
      // ISO lands inside the correct business-day schedule window.
      const [y, mo, dy] = date.split('-').map(Number);
      const next = new Date(Date.UTC(y, mo - 1, dy + 1));
      return next.toISOString().slice(0, 10); // "YYYY-MM-DD"
    }
    return date;
  })();

  // String literal → fromZonedTime treats it as Cairo wall-clock time.
  const startDateTime = fromZonedTime(
    `${cairoCalendarDate}T${pad(hour)}:00:00`,
    TIMEZONE
  );
  const endDateTime = addMinutes(startDateTime, duration);

  // Cairo-local versions used only for the UI preview label.
  const startLocal = toZonedTime(startDateTime, TIMEZONE);
  const endLocal   = toZonedTime(endDateTime,   TIMEZONE);

  // ── Receipt file selection (customer) ─────────────────────────
  function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setError('');
    if (!selected) { setReceiptFile(null); return; }
    if (!RECEIPT_ALLOWED_TYPES.includes(selected.type)) {
      setReceiptFile(null);
      setError('Invalid receipt file. Please upload a JPEG, PNG, or PDF.');
      return;
    }
    if (selected.size > RECEIPT_MAX_SIZE_MB * 1024 * 1024) {
      setReceiptFile(null);
      setError(`Receipt file too large. Maximum size is ${RECEIPT_MAX_SIZE_MB} MB.`);
      return;
    }
    setReceiptFile(selected);
  }

  // ── Submit ────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCourt) return setError('Please select a court');
    if (duration < 60 || duration % 60 !== 0) {
      return setError('End time must be at least one full hour after the start time.');
    }
    if (isStaff && (!customerName.trim() || !customerPhone.trim())) {
      return setError('Please provide customer name and phone');
    }

    if (isStaff && (depositAmount + remainderAmount > totalPrice)) {
      return setError(`Total paid cannot exceed the total price of EGP ${totalPrice.toFixed(2)}`);
    }

    // Customers must declare their payment and attach the transfer receipt
    if (!isStaff) {
      const paid = Number(amountPaid);
      if (!amountPaid || Number.isNaN(paid) || paid <= 0) {
        return setError('Please enter the amount you paid upfront');
      }
      if (paid > totalPrice) {
        return setError(`Amount paid cannot exceed the total price of EGP ${totalPrice.toFixed(2)}`);
      }
      if (!receiptFile) {
        return setError('Please attach your payment receipt screenshot — it is required');
      }
    }

    setLoading(true);
    setOptimisticSuccess(true);

    // Defensively sync the Zustand-held token to localStorage before the POST.
    // The api.ts interceptor reads from localStorage; if the store was rehydrated
    // after a hard refresh the two can momentarily diverge.
    if (accessToken && typeof window !== 'undefined') {
      localStorage.setItem('cf_access_token', accessToken);
    }

    try {
      const basePayload = {
        court_id:         selectedCourt,
        start_time:       startDateTime.toISOString(),
        duration_minutes: duration,
        ...(isStaff ? {
          deposit_amount:   depositAmount,
          deposit_method:   depositMethod,
          remainder_amount: remainderAmount,
          remainder_method: remainderMethod,
        } : {
          amount_paid:      Number(amountPaid),
          payment_method:   paymentMethod,
        })
      };

      // Staff must include customer details; customers rely on server-side JWT identity
      const payload = isStaff
        ? bookingSchema.parse({ ...basePayload, customerName, customerPhone })
        : bookingSchema.parse(basePayload);

      const { data: created } = await api.post('/bookings', payload);

      // Customers: immediately attach the mandatory payment receipt so the
      // booking moves to 'pending_verification' for staff review.
      if (!isStaff && receiptFile && created?.id) {
        try {
          const formData = new FormData();
          formData.append('receipt', receiptFile);
          await api.post(`/bookings/${created.id}/receipt`, formData);
        } catch {
          // Booking exists but the receipt didn't stick — send the customer to
          // the booking page where the upload can be retried.
          setOptimisticSuccess(false);
          setLoading(false);
          setError('Booking created, but the receipt upload failed. Redirecting you to the booking page to retry…');
          setTimeout(() => router.push(`/dashboard/bookings/${created.id}`), 1800);
          return;
        }
      }

      router.refresh();
      router.push(isStaff ? '/bookings' : '/dashboard/my-bookings');
    } catch (err: unknown) {
      setOptimisticSuccess(false);
      const axErr = err as { response?: { status?: number; data?: { message?: string } } };
      const status = axErr?.response?.status;
      const msg    = axErr?.response?.data?.message;

      if (status === 401 || status === 403) {
        setError('Your session has expired. Please log in again.');
      } else {
        setError(msg ?? 'Failed to create booking. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Book a Court</h1>
          <p className="page-subtitle">
            {isStaff
              ? 'Create a booking on behalf of a customer'
              : 'Reserve your preferred court and time slot'}
          </p>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ maxWidth: 580 }}
      >
        <div className="card" style={{ padding: 28 }}>
          {optimisticSuccess ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                textAlign: 'center', padding: '40px 20px',
                display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center',
              }}
            >
              <div className="spinner" style={{ width: 32, height: 32, color: 'var(--accent)' }} />
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Securing your slot…</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6 }}>
                  Please wait while we finalise the booking.
                </p>
              </div>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* ── Customer Details (staff only) ──────────────── */}
              {isStaff && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  style={{ display: 'flex', gap: 12 }}
                >
                  <div style={{ flex: 1 }}>
                    <label className="label" htmlFor="customer-name">
                      <User size={13} style={{ display: 'inline', marginRight: 5 }} />
                      Customer Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      id="customer-name"
                      className="input"
                      type="text"
                      placeholder="e.g. John Doe"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required={isStaff}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label" htmlFor="customer-phone">
                      Customer Phone <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      id="customer-phone"
                      className="input"
                      type="tel"
                      placeholder="e.g. 01012345678"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      required={isStaff}
                    />
                  </div>
                </motion.div>
              )}

              {/* ── Court selector ─────────────────────────────── */}
              <div>
                <label className="label" htmlFor="court-select">Court</label>
                {courtsLoading ? (
                  <div className="skeleton" style={{ height: 38, borderRadius: 8 }} />
                ) : (
                  <select
                    id="court-select"
                    className="input"
                    value={selectedCourt}
                    onChange={(e) => setCourt(e.target.value)}
                    required
                  >
                    <option value="">Select a court…</option>
                    {courts.map((c) => (
                      <option key={c.id} value={c.id}>
                        Court {c.court_number} · {c.name}
                        {c.is_indoor ? ' (Indoor)' : ' (Outdoor)'}
                        {' · '}{c.surface_type}
                        {' · EGP '}{Number(c.price_per_hour).toFixed(0)}/hr
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* ── Date ───────────────────────────────────────── */}
              <div>
                <label className="label" htmlFor="booking-date">
                  <Calendar size={13} style={{ display: 'inline', marginRight: 5 }} />
                  Date
                </label>
                <input
                  id="booking-date"
                  className="input"
                  type="date"
                  value={date}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              {/* ── Time (whole-hour blocks) ───────────────────── */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="label" htmlFor="start-time">
                    <Clock size={13} style={{ display: 'inline', marginRight: 5 }} />
                    Start Time
                  </label>
                  <select
                    id="start-time"
                    className="input"
                    value={hour}
                    onChange={(e) => handleStartHourChange(parseInt(e.target.value, 10) || 0)}
                    aria-label="Start time"
                  >
                    {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                      <option key={h} value={h}>{hourLabel(h)}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label" htmlFor="end-time">End Time</label>
                  <select
                    id="end-time"
                    className="input"
                    value={endHourRaw}
                    onChange={(e) => setEndHourRaw(parseInt(e.target.value, 10) || hour + 1)}
                    aria-label="End time"
                  >
                    {Array.from({ length: MAX_BOOKING_HOURS }, (_, i) => hour + i + 1).map((raw) => (
                      <option key={raw} value={raw}>
                        {hourLabel(raw)}{raw >= 24 ? ' (next day)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Payment (Staff Only) ───────────────────────── */}
              {isStaff && selectedCourtObj && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="card" style={{ padding: 16, borderLeft: '4px solid #f59e0b' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px 0' }}>Deposit Payment</h3>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label className="label">Amount (EGP)</label>
                        <input className="input" type="number" min="0" value={depositAmount} onChange={(e) => setDepositAmount(Number(e.target.value))} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="label">Method</label>
                        <select className="input" value={depositMethod} onChange={(e) => setDepositMethod(e.target.value)}>
                          <option value="NONE">None</option>
                          <option value="CASH">Cash</option>
                          <option value="VODAFONE_CASH">Vodafone Cash</option>
                          <option value="INSTAPAY">Instapay</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="card" style={{ padding: 16, borderLeft: '4px solid #10b981' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px 0' }}>Final/Remainder Payment</h3>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label className="label">Amount (EGP)</label>
                        <input className="input" type="number" min="0" value={remainderAmount} onChange={(e) => setRemainderAmount(Number(e.target.value))} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="label">Method</label>
                        <select className="input" value={remainderMethod} onChange={(e) => setRemainderMethod(e.target.value)}>
                          <option value="NONE">None</option>
                          <option value="CASH">Cash</option>
                          <option value="VODAFONE_CASH">Vodafone Cash</option>
                          <option value="INSTAPAY">Instapay</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Payment & Receipt (Customer Only) ──────────── */}
              {!isStaff && selectedCourtObj && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="card"
                  style={{ padding: 16, borderLeft: '4px solid var(--accent)' }}
                >
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Wallet size={14} /> Your Payment
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 12px 0' }}>
                    Tell us how much you transferred and attach the receipt — staff will
                    verify it and confirm your booking.
                  </p>

                  <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    <div style={{ flex: 1 }}>
                      <label className="label" htmlFor="amount-paid">
                        Amount Paid (EGP) <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        id="amount-paid"
                        className="input"
                        type="number"
                        min="1"
                        step="0.01"
                        placeholder={`e.g. ${(totalPrice / 2).toFixed(0)}`}
                        value={amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        required={!isStaff}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="label" htmlFor="payment-method">
                        Payment Method <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <select
                        id="payment-method"
                        className="input"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        required={!isStaff}
                      >
                        <option value="INSTAPAY">⚡ InstaPay</option>
                        <option value="VODAFONE_CASH">📱 Vodafone Cash</option>
                        <option value="CASH">💵 Cash</option>
                      </select>
                    </div>
                  </div>

                  <label
                    htmlFor="receipt-file"
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, padding: '20px 14px', borderRadius: 10,
                      border: `1.5px dashed ${receiptFile ? 'var(--accent)' : 'var(--border)'}`,
                      background: 'var(--bg-secondary)', cursor: 'pointer', textAlign: 'center',
                    }}
                  >
                    <UploadCloud size={20} style={{ color: receiptFile ? 'var(--accent)' : 'var(--text-tertiary)' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {receiptFile ? receiptFile.name : 'Attach payment receipt (required)'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      Transfer screenshot · JPEG, PNG, or PDF · up to {RECEIPT_MAX_SIZE_MB}MB
                    </span>
                    <input
                      id="receipt-file"
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={handleReceiptChange}
                      style={{ display: 'none' }}
                    />
                  </label>
                </motion.div>
              )}

              {/* ── Summary ────────────────────────────────────── */}
              {selectedCourtObj && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="card"
                  style={{
                    padding: '14px 16px', background: 'var(--bg-secondary)',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Booking Summary
                  </div>
                  {isStaff && customerName && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Customer</span>
                      <span style={{ fontWeight: 500 }}>{customerName}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Time</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {format(startLocal, 'hh:mm aa')} – {format(endLocal, 'hh:mm aa')}
                      {hour < OVERNIGHT_CUTOFF && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700,
                          color: '#f59e0b', background: 'rgba(245,158,11,0.1)',
                          border: '1px solid rgba(245,158,11,0.25)',
                          borderRadius: 4, padding: '1px 5px', letterSpacing: '0.03em',
                        }}>
                          +1 day
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                    <span>{duration / 60} {duration === 60 ? 'hour' : 'hours'} ({duration} minutes)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <CreditCard size={13} /> Total
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>EGP {totalPrice.toFixed(2)}</span>
                  </div>
                </motion.div>
              )}

              {/* ── Error ──────────────────────────────────────── */}
              <AnimatePresence>
                {error && (
                  <motion.p
                    key="err"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{ fontSize: 13, color: 'var(--color-error, #ef4444)', margin: 0 }}
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* ── Submit ─────────────────────────────────────── */}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                id="confirm-booking-btn"
                style={{ marginTop: 4 }}
              >
                {loading ? 'Creating booking…' : 'Confirm Booking'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// useSearchParams requires a Suspense boundary in the App Router
export default function BookCourtPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 400, borderRadius: 12 }} />}>
      <BookCourtForm />
    </Suspense>
  );
}
