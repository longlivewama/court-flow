'use client';

/**
 * Auth-aware nav actions — the only landing chrome that needs the browser.
 * The access token is memory-only (XSS-hardened); "logged in" derives from
 * the persisted profile and self-corrects via the refresh interceptor.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';

export function NavAuthActions() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(!!localStorage.getItem('cf_user'));
  }, []);

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {authed ? (
        <Link href="/dashboard" className="btn btn-primary btn-sm">
          Open dashboard
          <ArrowRight size={13} />
        </Link>
      ) : (
        <>
          <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
          <Link href="/register-club" className="btn btn-primary btn-sm">Register club</Link>
        </>
      )}
    </div>
  );
}
