'use client';

/**
 * Lost & Found — staff board.
 *
 *   · Photograph and log found items (court + date/time found)
 *   · Review customer claim requests, approve or reject them
 *   · Mark items as returned once picked up
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, X, Check, Camera, MapPin, Clock, PackageSearch, Undo2 } from 'lucide-react';
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
  court_number: number | null;
  pending_claims: number;
}

interface ClaimRow {
  id: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  claimant_name: string;
  claimant_email: string;
  claimant_phone: string | null;
}

interface CourtOption { id: string; name: string; number: number }

const STATUS_BADGE: Record<ItemRow['status'], { cls: string; label: string }> = {
  unclaimed: { cls: 'badge-pending',   label: 'Unclaimed' },
  claimed:   { cls: 'badge-checked_in', label: 'Claim approved' },
  returned:  { cls: 'badge-paid',      label: 'Returned' },
};

export default function StaffLostFoundPage() {
  const [items, setItems]     = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [courts, setCourts]   = useState<CourtOption[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [draft, setDraft] = useState({
    title: '', description: '', courtId: '',
    foundAt: new Date().toISOString().slice(0, 16),
  });
  const [photo, setPhoto]           = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [claimsFor, setClaimsFor]   = useState<string | null>(null);
  const [claims, setClaims]         = useState<ClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [deciding, setDeciding]     = useState<string | null>(null);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');

  const loadItems = useCallback(() => {
    api.get('/lost-found?all=1')
      .then(({ data }) => setItems(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load the board.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadItems();
    api.get('/courts')
      .then(({ data }) => setCourts((data.data ?? data ?? []).map((c: CourtOption) => c)))
      .catch(() => { /* court select is optional */ });
  }, [loadItems]);

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function apiError(err: unknown, fallback: string): string {
    const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
    return e.response?.data?.error?.message ?? e.response?.data?.message ?? fallback;
  }

  async function logItem() {
    if (!draft.title.trim()) return setError('Give the item a short title.');
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('title', draft.title.trim());
      if (draft.description.trim()) form.append('description', draft.description.trim());
      if (draft.courtId) form.append('courtId', draft.courtId);
      form.append('foundAt', new Date(draft.foundAt).toISOString());
      if (photo) form.append('photo', photo);

      await api.post('/lost-found', form);
      setDraft({ title: '', description: '', courtId: '', foundAt: new Date().toISOString().slice(0, 16) });
      setPhoto(null);
      setFormOpen(false);
      setNotice('Item added to the Lost & Found board.');
      loadItems();
    } catch (err) {
      setError(apiError(err, 'Could not log the item.'));
    } finally {
      setSaving(false);
    }
  }

  async function openClaims(item: ItemRow) {
    if (claimsFor === item.id) { setClaimsFor(null); return; }
    setClaimsFor(item.id);
    setClaimsLoading(true);
    setClaims([]);
    try {
      const { data } = await api.get(`/lost-found/${item.id}/claims`);
      setClaims(data.data ?? []);
    } catch (err) {
      setError(apiError(err, 'Could not load claims.'));
    } finally {
      setClaimsLoading(false);
    }
  }

  async function decide(itemId: string, claim: ClaimRow, status: 'approved' | 'rejected') {
    setDeciding(claim.id);
    setError('');
    try {
      await api.patch(`/lost-found/${itemId}/claims/${claim.id}`, { status });
      setNotice(status === 'approved'
        ? `Claim approved — ${claim.claimant_name} can pick the item up (other pending claims were rejected).`
        : 'Claim rejected.');
      loadItems();
      const { data } = await api.get(`/lost-found/${itemId}/claims`);
      setClaims(data.data ?? []);
    } catch (err) {
      setError(apiError(err, 'Could not update the claim.'));
    } finally {
      setDeciding(null);
    }
  }

  async function setItemStatus(item: ItemRow, status: ItemRow['status'], msg: string) {
    setError('');
    try {
      await api.patch(`/lost-found/${item.id}`, { status });
      setNotice(msg);
      loadItems();
    } catch (err) {
      setError(apiError(err, 'Could not update the item.'));
    }
  }

  const openItems = items.filter((i) => i.status !== 'returned');
  const pendingClaimCount = items.reduce((s, i) => s + (i.pending_claims ?? 0), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Lost &amp; Found</h1>
          <p className="page-subtitle">
            {openItems.length} item(s) on the board · {pendingClaimCount} claim(s) awaiting review
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen((v) => !v)}>
          {formOpen ? <X size={14} /> : <Plus size={14} />}
          {formOpen ? 'Cancel' : 'Log found item'}
        </button>
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

      {/* Log-item form */}
      {formOpen && (
        <div className="card-sm" style={{ marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label className="dropzone" style={{
            width: 160, height: 120, padding: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden', flexShrink: 0,
          }}>
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="Item preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <>
                <Camera size={20} style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>Add photo</span>
              </>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>

          <div style={{ flex: 1, minWidth: 260, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="input-group" style={{ flex: 2, minWidth: 180 }}>
              <label className="input-label">What was found</label>
              <input className="input" value={draft.title} placeholder="e.g. Black Wilson racket cover"
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </div>
            <div className="input-group" style={{ width: 160 }}>
              <label className="input-label">Court</label>
              <select className="input" value={draft.courtId}
                onChange={(e) => setDraft((d) => ({ ...d, courtId: e.target.value }))}>
                <option value="">Not on a court</option>
                {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ width: 200 }}>
              <label className="input-label">Found at</label>
              <input className="input" type="datetime-local" value={draft.foundAt}
                onChange={(e) => setDraft((d) => ({ ...d, foundAt: e.target.value }))} />
            </div>
            <div className="input-group" style={{ flex: 3, minWidth: 220 }}>
              <label className="input-label">Details (optional)</label>
              <input className="input" value={draft.description} placeholder="Distinguishing marks, where exactly…"
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
            </div>
            <button className="btn btn-primary" onClick={logItem} disabled={saving}>
              <Check size={14} />
              {saving ? 'Saving…' : 'Add to board'}
            </button>
          </div>
        </div>
      )}

      {/* Item grid */}
      {loading ? (
        <div className="lf-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 260 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <PackageSearch size={40} className="empty-state-icon" />
          <span className="empty-state-title">Nothing on the board</span>
          <p>Found items logged by staff will appear here.</p>
        </div>
      ) : (
        <div className="lf-grid">
          {items.map((item) => (
            <div key={item.id} className="lf-card" style={{ opacity: item.status === 'returned' ? 0.6 : 1 }}>
              <div className="lf-photo-wrap">
                {item.has_photo ? (
                  <AuthImage path={`/lost-found/${item.id}/photo`} alt={item.title} className="lf-photo" />
                ) : (
                  <div className="lf-photo-placeholder">
                    <Camera size={22} />
                    no photo
                  </div>
                )}
              </div>
              <div className="lf-body">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <h4 style={{ color: 'var(--text-primary)' }} className="truncate">{item.title}</h4>
                  <span className={`badge ${STATUS_BADGE[item.status].cls}`} style={{ flexShrink: 0 }}>
                    {STATUS_BADGE[item.status].label}
                  </span>
                </div>
                {item.description && <p style={{ fontSize: 12 }}>{item.description}</p>}
                <div className="lf-meta">
                  <MapPin size={11} />
                  {item.court_name ?? 'Clubhouse'}
                  <Clock size={11} style={{ marginLeft: 6 }} />
                  {new Date(item.found_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ marginTop: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openClaims(item)}>
                    Claims
                    {item.pending_claims > 0 && (
                      <span style={{
                        background: 'var(--warning)', color: '#1A1403', borderRadius: 999,
                        fontSize: 10, fontWeight: 700, padding: '1px 6px',
                      }}>
                        {item.pending_claims}
                      </span>
                    )}
                  </button>
                  {item.status === 'claimed' && (
                    <button className="btn btn-primary btn-sm"
                      onClick={() => setItemStatus(item, 'returned', `"${item.title}" marked as returned.`)}>
                      <Check size={12} />
                      Mark returned
                    </button>
                  )}
                  {item.status === 'returned' && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setItemStatus(item, 'unclaimed', `"${item.title}" is back on the board.`)}>
                      <Undo2 size={12} />
                      Reopen
                    </button>
                  )}
                </div>

                {/* Claims panel */}
                {claimsFor === item.id && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {claimsLoading ? (
                      <div className="skeleton" style={{ height: 40 }} />
                    ) : claims.length === 0 ? (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No claims yet.</span>
                    ) : claims.map((claim) => (
                      <div key={claim.id} style={{ fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{claim.claimant_name}</strong>
                          <span className={`badge badge-${claim.status === 'approved' ? 'paid' : claim.status === 'rejected' ? 'rejected' : 'pending'}`}>
                            {claim.status}
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                          {claim.claimant_email}{claim.claimant_phone ? ` · ${claim.claimant_phone}` : ''}
                        </div>
                        <p style={{ fontSize: 12, margin: '4px 0' }}>&ldquo;{claim.message}&rdquo;</p>
                        {claim.status === 'pending' && item.status !== 'returned' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-primary btn-sm" disabled={deciding === claim.id}
                              onClick={() => decide(item.id, claim, 'approved')}>
                              Approve
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={deciding === claim.id}
                              onClick={() => decide(item.id, claim, 'rejected')}>
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
