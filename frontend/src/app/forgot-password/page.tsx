'use client';

/**
 * Forgot password — request a reset link.
 *
 * The API always returns the same generic message regardless of whether the
 * email matched an account, so this page has exactly one success state (no
 * "email not found" branch to build — that would defeat the whole point).
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { api } from '@/lib/api';

const SPRING = { type: 'spring' as const, stiffness: 360, damping: 28 };
const GENERIC_MESSAGE = "If an account exists with this email, we've sent a password reset link.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return; // guards against duplicate submits from double-click / double-Enter
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { message?: string } } })?.response?.data;
      setError(resp?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="#22C55E" />
            <path d="M7 14h14M14 7v14" stroke="#06170C" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.5px' }}>CourtFlow</span>
        </div>

        {sent ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.5px' }}>
              Check your inbox
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28 }}>
              {GENERIC_MESSAGE} The link expires in 1 hour and can only be used once.
            </p>
            <a href="/login" className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }}>
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.5px' }}>
              Reset your password
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28 }}>
              Enter the email on your account and we&apos;ll send you a link to reset your password.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="input-group">
                <label htmlFor="email" className="input-label">Email address</label>
                <input
                  id="email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  aria-required="true"
                />
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
                {loading ? (
                  <>
                    <div className="spinner" />
                    Sending link…
                  </>
                ) : (
                  'Send reset link'
                )}
              </motion.button>

              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                Remembered your password?{' '}
                <a href="/login" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  Sign in
                </a>
              </div>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
