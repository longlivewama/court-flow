'use client';

/**
 * Reset password — reached via the emailed /reset-password?token=… link.
 *
 * Two failure shapes from the API, handled differently:
 *  - token invalid/expired/reused → nothing on this page can fix that, so we
 *    show a full "link expired" state (same shape as /verify-email) with a
 *    way to request a fresh link.
 *  - weak password → user-fixable right here, shown as an inline form error.
 * The backend's token-error message always contains "link" (see
 * auth.controller.ts resetPassword), which is what distinguishes the two.
 */
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

const SPRING = { type: 'spring' as const, stiffness: 360, damping: 28 };

const PASSWORD_HINT = 'At least 8 characters, including a letter and a number.';
function passwordError(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
  return null;
}

type Phase = 'form' | 'submitting' | 'success' | 'token-error';

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [phase, setPhase] = useState<Phase>(token ? 'form' : 'token-error');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState('');
  const [tokenErrorMessage, setTokenErrorMessage] = useState(
    'This password reset link is invalid or has expired.'
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === 'submitting' || !token) return; // guards duplicate submits

    setFormError('');

    const pwErr = passwordError(password);
    if (pwErr) { setFormError(pwErr); return; }
    if (password !== confirm) { setFormError('Passwords do not match.'); return; }

    setPhase('submitting');
    try {
      await api.post('/auth/reset-password', { token, password });
      setPhase('success');
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { message?: string; error?: { message?: string } } } })?.response?.data;
      const msg: string = resp?.message ?? resp?.error?.message ?? 'Something went wrong. Please try again.';

      if (msg.toLowerCase().includes('link')) {
        setTokenErrorMessage(msg);
        setPhase('token-error');
      } else {
        setFormError(msg);
        setPhase('form');
      }
    }
  }

  if (phase === 'token-error') {
    return (
      <div className="auth-wrapper">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--error-bg)', border: '1px solid var(--error-border)',
            }}
          >
            <AlertTriangle size={26} style={{ color: 'var(--error)' }} />
          </div>
          <h2 style={{ marginBottom: 10 }}>Link expired</h2>
          <p style={{ marginBottom: 24 }}>{tokenErrorMessage}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link href="/forgot-password" className="btn btn-primary">Request a new link</Link>
            <Link href="/login" className="btn btn-secondary">Back to sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="auth-wrapper">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
            }}
          >
            <CheckCircle2 size={26} style={{ color: 'var(--accent-green-text)' }} />
          </div>
          <h2 style={{ marginBottom: 10 }}>Password reset</h2>
          <p style={{ marginBottom: 24 }}>
            Your password has been updated and every other device has been signed out. Sign in with your new password.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => router.replace('/login')}
          >
            Sign in to your account
          </button>
        </div>
      </div>
    );
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
          <div
            style={{
              width: 28, height: 28, borderRadius: 7, background: '#22C55E',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <KeyRound size={16} color="#06170C" />
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.5px' }}>CourtFlow</span>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.5px' }}>
          Set a new password
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28 }}>
          Choose a new password for your account.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="input-group">
            <label htmlFor="password" className="input-label">New password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
              {PASSWORD_HINT}
            </p>
          </div>

          <div className="input-group">
            <label htmlFor="confirm" className="input-label">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              className="input"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          {formError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'var(--error-bg)', border: '1px solid var(--error-border)',
                borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--error)',
              }}
              role="alert"
            >
              {formError}
            </motion.div>
          )}

          <motion.button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={phase === 'submitting'}
            whileTap={{ scale: 0.98 }}
            style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
          >
            {phase === 'submitting' ? (
              <>
                <div className="spinner" />
                Resetting…
              </>
            ) : (
              'Reset password'
            )}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-wrapper">
          <div className="spinner" style={{ width: 24, height: 24 }} />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
