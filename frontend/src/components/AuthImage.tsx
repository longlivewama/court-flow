'use client';

/**
 * Image that loads through the authenticated API client.
 *
 * Endpoints like /lost-found/:id/photo require the Bearer token, which a bare
 * <img src> cannot send — so we fetch the bytes with axios and swap in an
 * object URL, revoking it on unmount.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AuthImageProps {
  path:       string;
  alt:        string;
  className?: string;
  style?:     React.CSSProperties;
}

export function AuthImage({ path, alt, className, style }: AuthImageProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    api.get(path, { responseType: 'blob' })
      .then(({ data }) => {
        if (cancelled) return;
        url = URL.createObjectURL(data);
        setSrc(url);
      })
      .catch(() => { /* keep the shimmer placeholder on failure */ });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  if (!src) return <div className="skeleton" style={{ width: '100%', height: '100%' }} aria-label={`Loading ${alt}`} />;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} style={style} />;
}
