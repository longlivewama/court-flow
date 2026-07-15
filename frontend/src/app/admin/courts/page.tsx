'use client';

/**
 * Admin Courts Management Page – Owner only.
 * Create, update, delete courts; change statuses; manage blocked periods.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit2, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Toggle } from '@/components/ui/Toggle';

const SPRING = { type: 'spring' as const, stiffness: 380, damping: 30 };

const STATUS_OPTIONS = [
  { value: 'available',            label: 'Available' },
  { value: 'closed',               label: 'Closed' },
  { value: 'maintenance',          label: 'Maintenance' },
  { value: 'reserved_club_event',  label: 'Reserved – Club Event' },
  { value: 'reserved_tournament',  label: 'Reserved – Tournament' },
];

interface Court {
  id: string; name: string; number: number; description: string;
  price_per_slot: number; status: string; is_active: boolean;
}

interface CourtForm {
  name: string; number: string; description: string;
  pricePerSlot: string; status: string;
}

const EMPTY_FORM: CourtForm = { name: '', number: '', description: '', pricePerSlot: '', status: 'available' };

export default function CourtsPage() {
  const [courts, setCourts]     = useState<Court[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<Court | null>(null);
  const [form, setForm]         = useState<CourtForm>(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/courts');
      setCourts(data);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to load courts.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); }
  function openEdit(c: Court) {
    setEditing(c);
    setForm({ name: c.name, number: String(c.number), description: c.description ?? '', pricePerSlot: String(c.price_per_slot), status: c.status });
    setShowForm(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        name: form.name, number: parseInt(form.number),
        description: form.description,
        pricePerSlot: parseFloat(form.pricePerSlot),
        status: form.status,
      };
      if (editing) {
        await api.patch(`/courts/${editing.id}`, payload);
      } else {
        await api.post('/courts', payload);
      }
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to save court. Please try again.');
    } finally { setSaving(false); }
  }

  async function deleteCourt(id: string) {
    if (!confirm('Deactivate this court?')) return;
    await api.delete(`/courts/${id}`);
    await load();
  }

  // Quick availability toggle: available ↔ closed without opening the modal.
  // The full status set (maintenance, events…) stays in the edit form.
  async function toggleAvailability(court: Court, open: boolean) {
    const next = open ? 'available' : 'closed';
    setCourts((prev) => prev.map((c) => c.id === court.id ? { ...c, status: next } : c));
    try {
      await api.patch(`/courts/${court.id}`, { status: next });
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } } };
      setError(axErr?.response?.data?.message ?? 'Failed to update court status.');
      setCourts((prev) => prev.map((c) => c.id === court.id ? { ...c, status: court.status } : c));
    }
  }

  const STATUS_COLOR: Record<string, string> = {
    available: 'var(--success)', closed: 'var(--error)',
    maintenance: 'var(--warning)', reserved_club_event: 'var(--info)', reserved_tournament: 'var(--info)',
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Courts</h1>
          <p className="page-subtitle">Manage court configuration and status</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate} id="create-court-btn">
          <Plus size={14} /> Add Court
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'var(--error-bg, rgba(239,68,68,0.08))', border: '1px solid var(--error, #ef4444)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          fontSize: 13, color: 'var(--error, #ef4444)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Court grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card">
              <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 14, width: '40%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 14, width: '80%' }} />
            </div>
          ))
        ) : courts.map((court, i) => (
          <motion.div
            key={court.id}
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: i * 0.04 }}
            style={{ position: 'relative' }}
          >
            {/* Status indicator */}
            <div style={{
              position: 'absolute', top: 16, right: 16,
              width: 8, height: 8, borderRadius: '50%',
              background: STATUS_COLOR[court.status] ?? 'var(--text-tertiary)',
            }} title={court.status} />

            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
              Court {court.number}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {court.name}
            </div>
            {court.description && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                {court.description}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>Price / slot</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>
                  EGP {Number(court.price_per_slot).toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>Status</div>
                <div style={{ fontSize: 12, color: STATUS_COLOR[court.status], textTransform: 'capitalize' }}>
                  {court.status.replace(/_/g, ' ')}
                </div>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
              paddingTop: 12, borderTop: '1px solid var(--border)',
            }}>
              <Toggle
                checked={court.status === 'available'}
                onChange={(open) => toggleAvailability(court, open)}
                label={`${court.name} open for booking`}
              />
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {court.status === 'available' ? 'Open for booking' : 'Not bookable'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => openEdit(court)} id={`edit-court-${court.id}`}>
                <Edit2 size={12} /> Edit
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => deleteCourt(court.id)}
                aria-label={`Delete court ${court.name}`}>
                <Trash2 size={12} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Create / Edit modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div className="overlay-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowForm(false)}>
            <motion.div className="modal"
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={SPRING}
              onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3>{editing ? 'Edit Court' : 'Add New Court'}</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={14} /></button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 12 }}>
                  <div className="input-group">
                    <label className="input-label">Court name</label>
                    <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Center Court" />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Number</label>
                    <input className="input" type="number" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} placeholder="1" />
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">Description</label>
                  <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="input-group">
                    <label className="input-label">Price per slot (EGP)</label>
                    <input className="input" type="number" step="0.01" value={form.pricePerSlot} onChange={(e) => setForm((f) => ({ ...f, pricePerSlot: e.target.value }))} placeholder="200.00" />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Status</label>
                    <select className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                    {saving ? <div className="spinner" style={{ width: 12, height: 12 }} /> : null}
                    {editing ? 'Save Changes' : 'Create Court'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
