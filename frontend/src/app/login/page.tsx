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
  const [clubSlug, setClubSlug] = useState('');
  // Revealed when the same email exists in several club workspaces
  const [needsSlug, setNeedsSlug] = useState(false);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload: Record<string, string> = { ...form };
      if (needsSlug && clubSlug.trim()) payload.clubSlug = clubSlug.trim().toLowerCase();
      const { data } = await api.post('/auth/login', payload);
      setAuth(data.user, data.accessToken);
      router.replace('/dashboard');
    } catch (err: unknown) {
      const resp = (err as any)?.response?.data;
      if (resp?.details?.code === 'CLUB_SLUG_REQUIRED') {
        setNeedsSlug(true);
        setError('This email belongs to multiple club workspaces — enter your club slug below.');
      } else {
        setError(resp?.message ?? 'Login failed. Please try again.');
      }
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

          {needsSlug && (
            <motion.div
              className="input-group"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              <label htmlFor="clubSlug" className="input-label">Club workspace slug</label>
              <input
                id="clubSlug"
                type="text"
                className="input"
                placeholder="e.g. nile-padel-club"
                value={clubSlug}
                onChange={(e) => setClubSlug(e.target.value)}
                autoComplete="organization"
                pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]"
              />
            </motion.div>
          )}

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
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
            Running a club?{' '}
            <a href="/register-club" style={{ color: 'var(--accent-green-text)', fontWeight: 500 }}>
              Register your club workspace
            </a>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
