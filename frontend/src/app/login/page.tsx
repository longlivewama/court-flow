'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { useAuthStore } from '@/lib/stores/auth.store';
import { api } from '@/lib/api';
import type { Metadata } from 'next';

const SPRING = { type: 'spring' as const, stiffness: 360, damping: 28 };

export default function LoginPage() {
  const router  = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm]       = useState({ email: '', password: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      setAuth(data.user, data.accessToken);
      router.replace('/dashboard');
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.message ?? 'Login failed. Please try again.';
      setError(msg);
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
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="#22C55E" />
            <path d="M7 14h14M14 7v14" stroke="#06170C" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.5px' }}>CourtFlow</span>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.5px' }}>
          Welcome back
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28 }}>
          Sign in to manage your padel club
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="input-group">
            <label htmlFor="email" className="input-label">Email address</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              autoComplete="email"
              required
              aria-required="true"
            />
          </div>

          <div className="input-group">
            <label htmlFor="password" className="input-label">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
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
            id="login-submit"
          >
            {loading ? (
              <>
                <div className="spinner" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </motion.button>

          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <a
              href="/forgot-password"
              style={{ fontSize: 13, color: 'var(--text-secondary)' }}
            >
              Forgot your password?
            </a>
          </div>

          <div className="divider" />

          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
            New customer?{' '}
            <a href="/register" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              Create an account
            </a>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
