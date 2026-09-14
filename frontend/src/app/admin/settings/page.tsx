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

// ── API DTO ────────────────────────────────────────────────────
// Exact shape of GET/PATCH /api/settings (see clubSettingsSchema in
// backend court.controller.ts) — field names match the `clubs` table
// columns 1:1. This is the ONLY place that shape is named; the rest of
// this page works in ClubSettingsForm (the UI's own field names) and
// converts at the two API boundaries via dtoToForm() / formToDto().
interface ClubSettingsDto {
  name:                           string;
  email:                          string | null;
  phone:                          string | null;
  deposit_percent:                number | string;
  cancellation_deadline_hours:    number | string;
}

// ── UI form model ──────────────────────────────────────────────
interface ClubSettingsForm {
  clubName:               string;
  contactPhone:           string;
  contactEmail:           string;
  cancellationCutoffHrs:  number;
  depositPercentage:      number;
}

interface WorkingHourItem {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

// Only used while the real settings are still loading — never merged over a
// successful API response, so a naming slip can't silently resurrect these
// as if they were the club's actual saved values.
const LOADING_PLACEHOLDER: ClubSettingsForm = {
  clubName:              '',
  contactPhone:          '',
  contactEmail:          '',
  cancellationCutoffHrs: 24,
  depositPercentage:     30,
};

/** API DTO → UI form model (GET /settings response). */
function dtoToForm(dto: ClubSettingsDto): ClubSettingsForm {
  return {
    clubName:              dto.name ?? '',
    contactEmail:          dto.email ?? '',
    contactPhone:          dto.phone ?? '',
    // pg returns NUMERIC columns as strings — coerce defensively.
    cancellationCutoffHrs: Number(dto.cancellation_deadline_hours),
    depositPercentage:     Number(dto.deposit_percent),
  };
}

/** UI form model → API DTO (PATCH /settings body). */
function formToDto(form: ClubSettingsForm): Partial<ClubSettingsDto> {
  return {
    name:                        form.clubName.trim(),
    email:                       form.contactEmail.trim(),
    phone:                       form.contactPhone.trim(),
    cancellation_deadline_hours: form.cancellationCutoffHrs,
    deposit_percent:             form.depositPercentage,
  };
}

/** Mirrors the backend's clubSettingsSchema so bad input never round-trips to the API. */
function validateForm(form: ClubSettingsForm): string | null {
  if (!form.clubName.trim()) return 'Club name is required.';
  if (!Number.isFinite(form.cancellationCutoffHrs) || form.cancellationCutoffHrs < 0 || form.cancellationCutoffHrs > 8760) {
    return 'Cancellation cutoff must be between 0 and 8760 hours.';
  }
  if (!Number.isFinite(form.depositPercentage) || form.depositPercentage < 10 || form.depositPercentage > 100) {
    return 'Deposit percentage must be between 10 and 100.';
  }
  return null;
}

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
  const [form, setForm]       = useState<ClubSettingsForm>(LOADING_PLACEHOLDER);
  const [workingHours, setWorkingHours] = useState<WorkingHourItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    // Independent failure handling: a broken working-hours fetch must not
    // prevent real settings from loading (and vice versa) — and a settings
    // load failure must be visible, not silently masked by the placeholder,
    // since saving on top of the placeholder would overwrite real data.
    const settingsLoad = api.get('/settings')
      .then(({ data }) => setForm(dtoToForm(data)))
      .catch(() => setLoadError('Could not load current settings. Reload the page before making changes.'));

    const workingHoursLoad = api.get('/settings/working-hours')
      .then(({ data }) => {
        const sorted = Array.from({ length: 7 }, (_, i) => {
          const found = (data as { day_of_week: number; open_time: string; close_time: string; is_closed: boolean }[])
            .find((d) => d.day_of_week === i);
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
        setWorkingHours(Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i,
          openTime: '08:00',
          closeTime: '23:00',
          isClosed: false
        })));
      });

    Promise.allSettled([settingsLoad, workingHoursLoad]).finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof ClubSettingsForm>(key: K, value: ClubSettingsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    if (saving) return; // guards against a duplicate mutation from a double-click
    setError('');

    const formErr = validateForm(form);
    if (formErr) { setError(formErr); return; }

    setSaving(true);
    try {
      const validatedHours = workingHoursSchema.parse({ hours: workingHours });
      const { data } = await api.patch('/settings', formToDto(form));
      await api.put('/settings/working-hours', validatedHours);
      // Reflect exactly what the server persisted (e.g. numeric coercions),
      // so the form never silently drifts from the saved record.
      setForm(dtoToForm(data));
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
          disabled={saving || !!loadError}
        >
          {saving ? (
            <div className="spinner" style={{ width: 14, height: 14 }} />
          ) : (
            <Save size={14} />
          )}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {/* Load-failure banner — saving is disabled until this clears on reload */}
      {loadError && (
        <div style={{
          background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: 'var(--error, #ef4444)',
        }}>
          ⚠️ {loadError}
        </div>
      )}

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
                value={form.clubName}
                onChange={(e) => patch('clubName', e.target.value)}
                placeholder="e.g. CourtFlow Sports Club"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Contact email</label>
              <input
                id="setting-contact-email"
                className="input"
                type="email"
                value={form.contactEmail}
                onChange={(e) => patch('contactEmail', e.target.value)}
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
              value={form.contactPhone}
              onChange={(e) => patch('contactPhone', e.target.value)}
              placeholder="+20 1X XXXX XXXX"
            />
          </div>
        </motion.div>

        {/* Cancellation policy */}
        <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Clock size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Cancellation Policy</span>
          </div>
          <div className="input-group" style={{ maxWidth: 200 }}>
            <label className="input-label">Cancellation cutoff (hrs)</label>
            <input
              id="setting-cancellation-cutoff"
              className="input"
              type="number"
              min={0}
              max={8760}
              value={Number.isFinite(form.cancellationCutoffHrs) ? form.cancellationCutoffHrs : ''}
              onChange={(e) => patch('cancellationCutoffHrs', e.target.value === '' ? NaN : parseInt(e.target.value, 10))}
            />
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
              Cancellations inside this window before the booking&apos;s start time forfeit the deposit instead of refunding it.
            </p>
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

          {/* Every booking requires a deposit (a minimum of 10% is enforced by
              the database) — there is no "no deposit" mode, so this is a
              single always-visible field rather than a togglable one. */}
          <div className="input-group" style={{ maxWidth: 200 }}>
            <label className="input-label">Deposit percentage (%)</label>
            <input
              id="setting-deposit-percentage"
              className="input"
              type="number"
              min={10}
              max={100}
              value={Number.isFinite(form.depositPercentage) ? form.depositPercentage : ''}
              onChange={(e) => patch('depositPercentage', e.target.value === '' ? NaN : parseInt(e.target.value, 10))}
            />
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
              Minimum 10%. Charged upfront to confirm a booking.
            </p>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
