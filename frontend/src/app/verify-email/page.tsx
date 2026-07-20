'use client';

/**
 * Verify email (screen 5.4) — centered envelope card.
 *
 * Two modes:
 *   /verify-email                 → "check your inbox" holding state
 *   /verify-email?token=…         → verifies the token against the API
 */
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, CheckCircle2, AlertTriangle } from 'lucide-react';
import axios from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Phase = 'waiting' | 'verifying' | 'success' | 'error';

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'waiting');
  const [message, setMessage] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    axios.post(`${BASE_URL}/auth/verify-email`, { token })
      .then(({ data }) => {
        setPhase('success');
        setMessage(data.message ?? 'Email verified successfully.');
      })
      .catch((err) => {
        setPhase('error');
        setMessage(
          err.response?.data?.error?.message
          ?? err.response?.data?.message
          ?? 'This verification link is invalid or has expired.'
        );
      });
  }, [token]);

  const icon =
    phase === 'success' ? <CheckCircle2 size={26} style={{ color: 'var(--accent-green-text)' }} />
    : phase === 'error' ? <AlertTriangle size={26} style={{ color: 'var(--error)' }} />
    : <Mail size={26} style={{ color: 'var(--accent-green-text)' }} />;

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: phase === 'error' ? 'var(--error-bg)' : 'var(--accent-green-bg)',
            border: `1px solid ${phase === 'error' ? 'var(--error-border)' : 'var(--success-border)'}`,
          }}
        >
          {phase === 'verifying' ? <div className="spinner" style={{ width: 22, height: 22 }} /> : icon}
        </div>

        {phase === 'waiting' && (
          <>
            <h2 style={{ marginBottom: 10 }}>Check your inbox</h2>
            <p style={{ marginBottom: 24 }}>
              We&apos;ve sent a verification link to your email address.
              Click it to activate your CourtFlow account.
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 24 }}>
              Didn&apos;t receive anything? Check your spam folder, or register
              again to get a fresh link.
            </p>
          </>
        )}

        {phase === 'verifying' && (
          <>
            <h2 style={{ marginBottom: 10 }}>Verifying…</h2>
            <p style={{ marginBottom: 24 }}>Confirming your email address with the club.</p>
          </>
        )}

        {phase === 'success' && (
          <>
            <h2 style={{ marginBottom: 10 }}>You&apos;re verified</h2>
            <p style={{ marginBottom: 24 }}>{message} Welcome to the club.</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <h2 style={{ marginBottom: 10 }}>Link expired</h2>
            <p style={{ marginBottom: 24 }}>{message}</p>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link href="/login" className="btn btn-primary">
            {phase === 'success' ? 'Sign in to your account' : 'Back to sign in'}
          </Link>
          {phase === 'error' && (
            <Link href="/register" className="btn btn-secondary">Register again</Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-wrapper">
          <div className="spinner" style={{ width: 24, height: 24 }} />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
