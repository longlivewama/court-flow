'use client';

/**
 * ReceiptViewer – fetches the encrypted receipt for a booking through the
 * authenticated API (GET /bookings/:id/receipt), and renders an inline
 * preview. Images render as thumbnails (click to open full-size); PDFs render
 * as an open-in-new-tab button. Handles the no-receipt case gracefully.
 */
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { FileText, ImageOff, ExternalLink } from 'lucide-react';

interface ReceiptViewerProps {
  bookingId: string;
  /** Max preview height in px (default 220) */
  maxHeight?: number;
  /**
   * Whether a receipt exists for this booking (e.g. `has_receipt` from
   * GET /bookings/:id). Pass `false` to skip the fetch entirely — it would
   * be a guaranteed 404. Omit when unknown; the viewer will fetch and
   * handle a 404 itself.
   */
  exists?: boolean;
}

export function ReceiptViewer({ bookingId, maxHeight = 220, exists }: ReceiptViewerProps) {
  const [url, setUrl]         = useState<string | null>(null);
  const [mime, setMime]       = useState('');
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  // Reset view state whenever the target booking (or its known-exists flag)
  // changes. Adjusted synchronously during render (React's documented
  // alternative to an effect for "reset state when a prop changes") so this
  // isn't a synchronous setState call inside the fetch effect below.
  const resetKey = `${bookingId}:${exists}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    if (exists === false) {
      setLoading(false);
      setMissing(true);
      setUrl(null);
    } else {
      setLoading(true);
      setMissing(false);
      setUrl(null);
    }
  }

  useEffect(() => {
    if (exists === false) return; // No receipt to fetch — the reset above already covers this case.
    let objectUrl: string | null = null;
    let cancelled = false;

    api.get(`/bookings/${bookingId}/receipt`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setMime(res.data.type ?? '');
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setMissing(true); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bookingId, exists]);

  if (loading) {
    return <div className="skeleton" style={{ height: Math.min(maxHeight, 140), borderRadius: 10 }} />;
  }

  if (missing || !url) {
    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 6, padding: '22px 14px', borderRadius: 10,
          border: '1.5px dashed var(--border)', background: 'var(--bg-secondary)',
          color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center',
        }}
      >
        <ImageOff size={18} />
        No receipt uploaded yet
      </div>
    );
  }

  if (mime === 'application/pdf') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-secondary btn-sm"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <FileText size={14} />
        Open PDF receipt
        <ExternalLink size={12} />
      </a>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Open full-size receipt">
      {/* eslint-disable-next-line @next/next/no-img-element -- blob object URL, next/image not applicable */}
      <img
        src={url}
        alt="Deposit payment receipt"
        style={{
          display: 'block', width: '100%', maxHeight,
          objectFit: 'contain', borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--bg-secondary)',
          cursor: 'zoom-in',
        }}
      />
    </a>
  );
}
