'use client';

/**
 * Admin Settings Page – Owner only.
 * Club-level configuration: name, contact info, slot duration, advance booking window,
 * cancellation policy, and deposit requirement.
 */
import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Save, Settings, Clock, CreditCard, Phone, Building2 } from 'lucide-react';
import { ZodError } from 'zod';
import { api } from '@/lib/api';
import { workingHoursSchema } from '@/lib/schemas';

interface ClubSettings {
  club_name:               string;
  contact_phone:           string;
  contact_email:           string;
  slot_duration_minutes:   number;
  advance_booking_days:    number;
  cancellation_cutoff_hrs: number;
  deposit_required:        boolean;
  deposit_percentage:      number;
}

interface WorkingHourItem {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

const DEFAULTS: ClubSettings = {
  club_name:               '',
  contact_phone:           '',
  contact_email:           '',
  slot_duration_minutes:   60,
  advance_booking_days:    14,
  cancellation_cutoff_hrs: 24,
  deposit_required:        true,
  deposit_percentage:      30,
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A day runs 24 hours when open === close (canonical) or spans the full day as
 * 00:00 → 23:59 (the end-of-day sentinel the backend normalises to midnight).
 * Mirrors resolveDayWindow() in backend booking.validator.ts.
 */
function is24Hours(openTime: string, closeTime: string): boolean {
  return openTime === closeTime || (openTime === '00:00' && closeTime === '23:59');
}

const SPRING = { type: 'spring' as const, stiffness: 380, damping: 30 };

export default function SettingsPage() {
  const [form, setForm]       = useState<ClubSettings>(DEFAULTS);
  const [workingHours, setWorkingHours] = useState<WorkingHourItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/settings').then(({ data }) => data),
      api.get('/settings/working-hours').then(({ data }) => data)
    ])
      .then(([settingsData, workingHoursData]) => {
        setForm({ ...DEFAULTS, ...settingsData });
        const sorted = Array.from({ length: 7 }, (_, i) => {
          const found = workingHoursData.find((d: any) => d.day_of_week === i);
          return found ? {
            dayOfWeek: i,
            openTime: found.open_time.slice(0, 5),
            closeTime: found.close_time.slice(0, 5),
            isClosed: found.is_closed
          } : {
            dayOfWeek: i,
            openTime: '08:00',
            closeTime: '23:00',
            isClosed: false
          };
        });
        setWorkingHours(sorted);
      })
      .catch(() => {
        // Fallback for settings or working hours if endpoint fails/empty
        setWorkingHours(Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i,
          openTime: '08:00',
          closeTime: '23:00',
          isClosed: false
        })));
      })
      .finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof ClubSettings>(key: K, value: ClubSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const validatedHours = workingHoursSchema.parse({ hours: workingHours });
      await Promise.all([
        api.patch('/settings', form),
        api.put('/settings/working-hours', validatedHours)
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const zodMsg = err instanceof ZodError ? err.issues[0]?.message : undefined;
      const axErr  = err as { response?: { data?: { message?: string } } };
      setError(zodMsg ?? axErr?.response?.data?.message ?? 'Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={22} />
            <div>
              <h1 className="page-title">Settings</h1>
              <p className="page-subtitle">Club configuration and preferences</p>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card">
              <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 16 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="skeleton" style={{ height: 38 }} />
                <div className="skeleton" style={{ height: 38 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Settings size={22} />
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Club configuration and preferences</p>
          </div>
        </div>

        <button
          id="save-settings-btn"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <div className="spinner" style={{ width: 14, height: 14 }} />
          ) : (
            <Save size={14} />
          )}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {/* Saved banner */}
      {saved && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={SPRING}
          style={{
            background: 'var(--success-bg)', border: '1px solid var(--success-border)',
            borderRadius: 8, padding: '10px 16px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: 'var(--success)',
          }}
        >
          <Save size={14} /> Settings saved successfully.
        </motion.div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: 'var(--error, #ef4444)',
        }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Club Identity */}
        <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Building2 size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Club Identity</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="input-group">
              <label className="input-label">Club name</label>
              <input
                id="setting-club-name"
                className="input"
                value={form.club_name}
                onChange={(e) => patch('club_name', e.target.value)}
                placeholder="e.g. CourtFlow Sports Club"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Contact email</label>
              <input
                id="setting-contact-email"
                className="input"
                type="email"
                value={form.contact_email}
                onChange={(e) => patch('contact_email', e.target.value)}
                placeholder="admin@club.com"
              />
            </div>
          </div>
        </motion.div>

        {/* Contact */}
        <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.05 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Phone size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Contact</span>
          </div>
          <div className="input-group" style={{ maxWidth: 320 }}>
            <label className="input-label">Phone number</label>
            <input
              id="setting-contact-phone"
              className="input"
              value={form.contact_phone}
              onChange={(e) => patch('contact_phone', e.target.value)}
              placeholder="+20 1X XXXX XXXX"
            />
          </div>
        </motion.div>

        {/* Booking rules */}
        <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Clock size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Booking Rules</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <div className="input-group">
              <label className="input-label">Slot duration (min)</label>
              <input
                id="setting-slot-duration"
                className="input"
                type="number"
                min={30}
                step={15}
                value={isNaN(Number(form?.slot_duration_minutes)) ? 60 : (form.slot_duration_minutes ?? 60)}
                onChange={(e) => patch('slot_duration_minutes', parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Advance booking (days)</label>
              <input
                id="setting-advance-days"
                className="input"
                type="number"
                min={1}
                max={90}
                value={isNaN(Number(form?.advance_booking_days)) ? 14 : (form.advance_booking_days ?? 14)}
                onChange={(e) => patch('advance_booking_days', parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Cancellation cutoff (hrs)</label>
              <input
                id="setting-cancellation-cutoff"
                className="input"
                type="number"
                min={0}
                value={isNaN(Number(form?.cancellation_cutoff_hrs)) ? 24 : (form.cancellation_cutoff_hrs ?? 24)}
                onChange={(e) => patch('cancellation_cutoff_hrs', parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>
        </motion.div>

        {/* Club Working Hours */}
        <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Clock size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Club Working Hours</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {workingHours.map((wh, idx) => (
              <div
                key={wh.dayOfWeek}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: wh.isClosed ? 'var(--surface-3, rgba(255,255,255,0.02))' : 'var(--surface-2, rgba(255,255,255,0.04))',
                  border: '1px solid var(--border)',
                }}
              >
                {/* Day Name */}
                <div style={{ width: 120, fontWeight: 600, fontSize: 14 }}>
                  {DAYS[wh.dayOfWeek]}
                </div>

                {/* Status Toggle & Inputs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: 13, fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={!wh.isClosed}
                      onChange={(e) => {
                        const updated = [...workingHours];
                        updated[idx] = { ...updated[idx], isClosed: !e.target.checked };
                        setWorkingHours(updated);
                        setSaved(false);
                      }}
                      style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                    />
                    {!wh.isClosed ? 'Open' : 'Closed'}
                  </label>

                  {!wh.isClosed ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="time"
                        className="input"
                        style={{ padding: '4px 8px', fontSize: 13, height: 32, width: 95 }}
                        value={wh.openTime}
                        onChange={(e) => {
                          const updated = [...workingHours];
                          updated[idx] = { ...updated[idx], openTime: e.target.value };
                          setWorkingHours(updated);
                          setSaved(false);
                        }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>to</span>
                      <input
                        type="time"
                        className="input"
                        style={{ padding: '4px 8px', fontSize: 13, height: 32, width: 95 }}
                        value={wh.closeTime}
                        onChange={(e) => {
                          const updated = [...workingHours];
                          updated[idx] = { ...updated[idx], closeTime: e.target.value };
                          setWorkingHours(updated);
                          setSaved(false);
                        }}
                      />
                      {is24Hours(wh.openTime, wh.closeTime) ? (
                        <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          · Open 24 hours
                        </span>
                      ) : wh.closeTime <= wh.openTime ? (
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                          · closes next day
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-tertiary)', width: 214, textAlign: 'center', fontStyle: 'italic' }}>
                      Closed
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Deposit policy */}
        <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <CreditCard size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Deposit Policy</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: 14 }}>
              <input
                id="setting-deposit-required"
                type="checkbox"
                checked={form.deposit_required}
                onChange={(e) => patch('deposit_required', e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
              />
              Require deposit at booking
            </label>
          </div>

          {form.deposit_required && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="input-group"
              style={{ maxWidth: 200 }}
            >
              <label className="input-label">Deposit percentage (%)</label>
              <input
                id="setting-deposit-percentage"
                className="input"
                type="number"
                min={1}
                max={100}
                value={isNaN(Number(form?.deposit_percentage)) ? 30 : (form.deposit_percentage ?? 30)}
                onChange={(e) => patch('deposit_percentage', parseInt(e.target.value, 10) || 0)}
              />
            </motion.div>
          )}
        </motion.div>

      </div>
    </div>
  );
}
