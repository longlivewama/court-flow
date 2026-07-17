'use client';

/**
 * Club workspace onboarding — POST /api/auth/register-club.
 * One transaction provisions the tenant (immutable CLUB_ID), the primary
 * Club Owner account and the default operating calendar.
 */
import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Building2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { EASE_STANDARD } from '@/lib/motion-tokens';

const SPRING = { type: 'spring' as const, stiffness: 360, damping: 28 };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export default function RegisterClubPage() {
  const [form, setForm] = useState({
    clubName: '', clubSlug: '', firstName: '', lastName: '',
    email: '', phone: '', password: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState<{ clubSlug: string } | null>(null);

  const slugValid = !form.clubSlug || SLUG_RE.test(form.clubSlug);

  function setClubName(name: string) {
    setForm((f) => ({
      ...f,
      clubName: name,
      clubSlug: slugTouched ? f.clubSlug : slugify(name),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!SLUG_RE.test(form.clubSlug)) {
      setError('Club slug must be 3–63 lowercase letters, numbers or inner hyphens.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register-club', {
        clubName:  form.clubName.trim(),
        clubSlug:  form.clubSlug,
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        email:     form.email.trim().toLowerCase(),
        phone:     form.phone.trim() || undefined,
        password:  form.password,
      });
      setDone({ clubSlug: data.clubSlug });
    } catch (err: unknown) {
      const resp = (err as any)?.response?.data;
      setError(resp?.details?.[0]?.message ?? resp?.message ?? 'Club registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <motion.div
        className="auth-card"
        style={{ maxWidth: 460 }}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
            <rect width="28" height="28" rx="7" fill="#22C55E" />
            <path d="M7 14h14M14 7v14" stroke="#06170C" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.5px' }}>CourtFlow</span>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE_STANDARD }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center', alignItems: 'center' }}
            >
              <CheckCircle2 size={40} style={{ color: 'var(--accent-green-text)' }} />
              <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.5px' }}>
                Club workspace created
              </h1>
              <p style={{ fontSize: 13.5 }}>
                Your workspace slug is{' '}
                <code style={{ color: 'var(--accent-green-text)' }}>{done.clubSlug}</code>.
                Verify the owner email, then sign in to configure courts, staff
                and working hours.
              </p>
              <Link href="/login" className="btn btn-primary btn-lg" style={{ marginTop: 8 }}>
                Go to sign in
                <ArrowRight size={14} />
              </Link>
            </motion.div>
          ) : (
            <motion.div key="form" initial={false}>
              <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.5px' }}>
                Register your club
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 26 }}>
                An isolated multi-tenant workspace with you as Club Owner.
              </p>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="input-group">
                  <label htmlFor="clubName" className="input-label">Club name</label>
                  <input
                    id="clubName" type="text" className="input"
                    placeholder="Nile Padel Club"
                    value={form.clubName}
                    onChange={(e) => setClubName(e.target.value)}
                    minLength={3} maxLength={120} required
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="clubSlug" className="input-label">
                    Workspace slug{' '}
                    <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
                      — unique, permanent
                    </span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                    <input
                      id="clubSlug" type="text" className="input"
                      placeholder="nile-padel-club"
                      value={form.clubSlug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setForm((f) => ({ ...f, clubSlug: e.target.value.toLowerCase() }));
                      }}
                      style={!slugValid ? { borderColor: 'var(--error)' } : undefined}
                      minLength={3} maxLength={63} required
                    />
                  </div>
                  {!slugValid && (
                    <span style={{ fontSize: 11.5, color: 'var(--error)' }}>
                      Lowercase letters, numbers and inner hyphens only (3–63 chars).
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="input-group">
                    <label htmlFor="firstName" className="input-label">Owner first name</label>
                    <input id="firstName" type="text" className="input" placeholder="Ahmed"
                      value={form.firstName}
                      onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                      maxLength={80} required />
                  </div>
                  <div className="input-group">
                    <label htmlFor="lastName" className="input-label">Owner last name</label>
                    <input id="lastName" type="text" className="input" placeholder="Fahim"
                      value={form.lastName}
                      onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                      maxLength={80} required />
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="email" className="input-label">Owner email</label>
                  <input id="email" type="email" className="input" placeholder="owner@club.com"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    autoComplete="email" required />
                </div>

                <div className="input-group">
                  <label htmlFor="phone" className="input-label">
                    Phone <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>— optional</span>
                  </label>
                  <input id="phone" type="tel" className="input" placeholder="+20 100 000 0000"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    autoComplete="tel" maxLength={32} />
                </div>

                <div className="input-group">
                  <label htmlFor="password" className="input-label">Owner password</label>
                  <input id="password" type="password" className="input" placeholder="At least 8 chars, letters + numbers"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    autoComplete="new-password" minLength={8} maxLength={128} required />
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      background: 'var(--error-bg)', border: '1px solid var(--error-border)',
                      borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--error)',
                    }}
                    role="alert"
                  >
                    {error}
                  </motion.div>
                )}

                <motion.button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  disabled={loading}
                  whileTap={{ scale: 0.98 }}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                >
                  {loading ? (<><div className="spinner" /> Provisioning workspace…</>) : 'Create club workspace'}
                </motion.button>

                <div className="divider" />

                <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                  Already onboarded?{' '}
                  <Link href="/login" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Sign in</Link>
                  {' '}·{' '}
                  <Link href="/register" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Join as member</Link>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
