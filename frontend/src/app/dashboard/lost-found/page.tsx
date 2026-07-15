'use client';

/**
 * Lost & Found — client board.
 *
 * Browse items found around the club (photos rest softly blurred and sharpen
 * on hover) and submit a claim describing why the item is yours. Staff review
 * every claim before hand-over.
 */
import { useCallback, useEffect, useState } from 'react';
import { Camera, MapPin, Clock, PackageSearch, HandHelping, X } from 'lucide-react';
import { api } from '@/lib/api';
import { AuthImage } from '@/components/AuthImage';

interface ItemRow {
  id: string;
  title: string;
  description: string | null;
  found_at: string;
  status: 'unclaimed' | 'claimed' | 'returned';
  has_photo: boolean;
  court_name: string | null;
  my_claim_status: 'pending' | 'approved' | 'rejected' | null;
}

export default function ClientLostFoundPage() {
  const [items, setItems]     = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [claimItem, setClaimItem] = useState<ItemRow | null>(null);
  const [message, setMessage]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.get('/lost-found')
      .then(({ data }) => setItems(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load the board.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitClaim() {
    if (!claimItem) return;
    if (message.trim().length < 5) return setError('Describe the item so staff can verify it is yours (a few words at least).');
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/lost-found/${claimItem.id}/claims`, { message: message.trim() });
      setNotice(`Claim submitted for "${claimItem.title}" — staff will review it at the front desk.`);
      setClaimItem(null);
      setMessage('');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? 'Could not submit the claim.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Lost &amp; Found</h1>
          <p className="page-subtitle">Left something behind? Hover to reveal, then claim your item</p>
        </div>
      </div>

      {notice && (
        <div role="status" style={{
          background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
          color: 'var(--accent-green-text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" style={{
          background: 'var(--error-bg)', border: '1px solid var(--error-border)',
          color: 'var(--error)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="lf-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 260 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <PackageSearch size={40} className="empty-state-icon" />
          <span className="empty-state-title">Nothing here right now</span>
          <p>Items found around the courts are posted here by our staff.</p>
        </div>
      ) : (
        <div className="lf-grid">
          {items.map((item) => (
            <div key={item.id} className="lf-card">
              <div className="lf-photo-wrap">
                {item.has_photo ? (
                  <AuthImage path={`/lost-found/${item.id}/photo`} alt={item.title} className="lf-photo veiled" />
                ) : (
                  <div className="lf-photo-placeholder">
                    <Camera size={22} />
                    no photo
                  </div>
                )}
              </div>
              <div className="lf-body">
                <h4 style={{ color: 'var(--text-primary)' }}>{item.title}</h4>
                {item.description && <p style={{ fontSize: 12 }}>{item.description}</p>}
                <div className="lf-meta">
                  <MapPin size={11} />
                  {item.court_name ?? 'Clubhouse'}
                  <Clock size={11} style={{ marginLeft: 6 }} />
                  found {new Date(item.found_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
                <div style={{ marginTop: 'auto' }}>
                  {item.my_claim_status ? (
                    <span className={`badge badge-${item.my_claim_status === 'approved' ? 'paid' : item.my_claim_status === 'rejected' ? 'rejected' : 'pending'}`}>
                      claim {item.my_claim_status === 'pending' ? 'under review' : item.my_claim_status}
                    </span>
                  ) : item.status === 'claimed' ? (
                    <span className="badge badge-checked_in">claim approved for another member</span>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => { setClaimItem(item); setMessage(''); }}>
                      <HandHelping size={12} />
                      This is mine
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Claim modal */}
      {claimItem && (
        <>
          <div className="overlay-backdrop" onClick={() => setClaimItem(null)} />
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="claim-title">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 id="claim-title">Claim &ldquo;{claimItem.title}&rdquo;</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setClaimItem(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <p style={{ fontSize: 13, marginBottom: 12 }}>
              Tell our staff something only the owner would know — brand, contents,
              when you last had it. They will verify your claim at the front desk.
            </p>
            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label" htmlFor="claim-message">Why is this yours?</label>
              <textarea id="claim-message" className="input" rows={4} value={message}
                placeholder="e.g. It's a black Adidas hoodie, size M, with my locker key in the front pocket."
                onChange={(e) => setMessage(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setClaimItem(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitClaim} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit claim'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
