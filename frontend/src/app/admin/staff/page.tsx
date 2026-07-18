'use client';

/**
 * Staff (screen 5.13) — teammates & granular permissions manager.
 *
 *   · "+ Add Staff Member" → animated modal: name, email, role, and a grid of
 *     interactive permission toggle pills. A temp password is issued once.
 *   · Per-card Remove (muted red) with an inline confirm step.
 *   · Owner can flip each receptionist's granular permissions live.
 *   · Suspend / reactivate toggle (unchanged behaviour).
 *
 * Owners implicitly hold every permission, so their pills read "Full access".
 */
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import {
  ShieldCheck, UserRound, Lock, UserPlus, Trash2, X, Check, Copy,
  CalendarDays, CreditCard, Dumbbell, Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Toggle } from '@/components/ui/Toggle';

type PermKey = 'can_view_schedule' | 'can_verify_deposits' | 'can_manage_coaches' | 'can_view_finance';

interface StaffMember {
  id:             string;
  first_name:     string;
  last_name:      string;
  email:          string;
  phone:          string | null;
  role:           'owner' | 'receptionist';
  is_active:      boolean;
  email_verified: boolean;
  is_locked:      boolean;
  created_at:     string;
  can_view_schedule:   boolean;
  can_verify_deposits: boolean;
  can_manage_coaches:  boolean;
  can_view_finance:    boolean;
}

type Permissions = Record<PermKey, boolean>;

const PERMISSION_DEFS: { key: PermKey; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: 'can_view_schedule',   label: 'View schedule',   desc: 'Access the main timetable grid', icon: <CalendarDays size={13} /> },
  { key: 'can_verify_deposits', label: 'Verify deposits', desc: 'Clear 50% down-payments manually', icon: <CreditCard size={13} /> },
  { key: 'can_manage_coaches',  label: 'Manage coaches',  desc: 'Modify, link & register coaching', icon: <Dumbbell size={13} /> },
  { key: 'can_view_finance',    label: 'View finance',    desc: 'Revenue, analytics & payments', icon: <Wallet size={13} /> },
];

const DEFAULT_PERMS: Permissions = {
  can_view_schedule: true,
  can_verify_deposits: true,
  can_manage_coaches: false,
  can_view_finance: false,
};

const SPRING = { type: 'spring' as const, stiffness: 500, damping: 30 };

// ── Animated permission pill ──────────────────────────────────
function PermPill({
  def, on, onToggle, disabled,
}: {
  def: typeof PERMISSION_DEFS[number];
  on: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      className={`perm-pill ${on ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={SPRING}
      aria-pressed={on}
    >
      <span className="perm-pill-check" aria-hidden>
        <AnimatePresence initial={false}>
          {on && (
            <motion.span
              key="check"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 22 }}
              style={{ display: 'flex' }}
            >
              <Check size={13} color="#06170C" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="perm-pill-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {def.icon}{def.label}
        </span>
        <span className="perm-pill-desc">{def.desc}</span>
      </span>
    </motion.button>
  );
}

const OVERLAY: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1 },
};

export default function StaffPage() {
  const { user } = useAuthStore();
  const [staff, setStaff]     = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState<string | null>(null);
  const [notice, setNotice]   = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Add-staff modal
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    role: 'receptionist' as 'receptionist' | 'owner',
    permissions: { ...DEFAULT_PERMS },
  });
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(() => {
    api.get('/users/staff')
      .then(({ data }) => setStaff(data.data ?? []))
      .catch((err) => setError(err.response?.data?.message ?? 'Could not load teammates.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  function apiError(err: unknown, fallback: string): string {
    const e = err as { response?: { data?: { message?: string; error?: { message?: string } } } };
    return e.response?.data?.error?.message ?? e.response?.data?.message ?? fallback;
  }

  function resetDraft() {
    setDraft({
      firstName: '', lastName: '', email: '', phone: '',
      role: 'receptionist', permissions: { ...DEFAULT_PERMS },
    });
  }

  async function toggleActive(member: StaffMember, next: boolean) {
    setSaving(member.id);
    setError(''); setNotice('');
    setStaff((prev) => prev.map((s) => s.id === member.id ? { ...s, is_active: next } : s));
    try {
      await api.patch(`/users/${member.id}/status`, { isActive: next });
      setNotice(`${member.first_name} ${member.last_name} ${next ? 'reactivated' : 'suspended'}.`);
    } catch (err) {
      setError(apiError(err, 'Update failed.'));
      setStaff((prev) => prev.map((s) => s.id === member.id ? { ...s, is_active: !next } : s));
    } finally {
      setSaving(null);
    }
  }

  async function togglePermission(member: StaffMember, key: PermKey, next: boolean) {
    setError(''); setNotice('');
    const updated: Permissions = {
      can_view_schedule:   member.can_view_schedule,
      can_verify_deposits: member.can_verify_deposits,
      can_manage_coaches:  member.can_manage_coaches,
      can_view_finance:    member.can_view_finance,
      [key]: next,
    };
    // Optimistic
    setStaff((prev) => prev.map((s) => s.id === member.id ? { ...s, [key]: next } : s));
    try {
      await api.patch(`/users/${member.id}/permissions`, updated);
    } catch (err) {
      setError(apiError(err, 'Could not update permission.'));
      setStaff((prev) => prev.map((s) => s.id === member.id ? { ...s, [key]: !next } : s));
    }
  }

  async function createStaff() {
    if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.email.trim()) {
      return setError('Name and email are required.');
    }
    setCreating(true); setError('');
    try {
      const { data } = await api.post('/users/staff', {
        firstName:   draft.firstName.trim(),
        lastName:    draft.lastName.trim(),
        email:       draft.email.trim().toLowerCase(),
        phone:       draft.phone.trim() || undefined,
        role:        draft.role,
        permissions: draft.permissions,
      });
      setModalOpen(false);
      resetDraft();
      setTempPassword({ email: data.user.email, password: data.tempPassword });
      setNotice('Staff member added.');
      load();
    } catch (err) {
      setError(apiError(err, 'Could not add the staff member.'));
    } finally {
      setCreating(false);
    }
  }

  async function removeStaff(member: StaffMember) {
    setSaving(member.id); setError(''); setNotice('');
    try {
      const { data } = await api.delete(`/users/${member.id}`);
      setConfirmId(null);
      setNotice(
        data.removed === 'deleted'
          ? `${member.first_name} ${member.last_name} removed from the club.`
          : `${member.first_name} ${member.last_name} has booking history — account deactivated and access revoked.`
      );
      load();
    } catch (err) {
      setError(apiError(err, 'Could not remove the staff member.'));
    } finally {
      setSaving(null);
    }
  }

  const ownerRole = draft.role === 'owner';

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="page-subtitle">Teammates, roles and granular access control</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setError(''); setModalOpen(true); }}>
          <UserPlus size={15} />
          Add Staff Member
        </button>
      </div>

      {notice && (
        <div role="status" style={{
          background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
          color: 'var(--accent-green-text)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginBottom: 16,
        }}>
          {notice}
        </div>
      )}
      {error && !modalOpen && (
        <div role="alert" style={{
          background: 'var(--error-bg)', border: '1px solid var(--error-border)',
          color: 'var(--error)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Temp-password reveal (shown once after creation) */}
      <AnimatePresence>
        {tempPassword && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: 16 }}
          >
            <div style={{
              background: 'var(--surface-2)', border: '1px solid var(--border-focus)',
              borderRadius: 10, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                    Temporary password for {tempPassword.email}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    Share it securely — it won&apos;t be shown again. They can change it after signing in.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <code style={{
                    fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent-green-text)',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '6px 10px',
                  }}>
                    {tempPassword.password}
                  </code>
                  <button className="btn btn-secondary btn-sm" aria-label="Copy password"
                    onClick={() => navigator.clipboard?.writeText(tempPassword.password)}>
                    <Copy size={13} />
                  </button>
                  <button className="btn btn-ghost btn-sm" aria-label="Dismiss"
                    onClick={() => setTempPassword(null)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {staff.map((member) => {
            const isSelf  = member.id === user?.id;
            const isOwner = member.role === 'owner';
            return (
              <div key={member.id} className="card" style={{ opacity: member.is_active ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: isOwner ? 'var(--accent-green-bg)' : 'var(--surface-2)',
                    border: `1px solid ${isOwner ? 'var(--success-border)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isOwner ? 'var(--accent-green-text)' : 'var(--text-secondary)',
                  }}>
                    {isOwner ? <ShieldCheck size={18} /> : <UserRound size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {member.first_name} {member.last_name}
                      </span>
                      {isSelf && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', border: '1px solid var(--border)', borderRadius: 99, padding: '1px 7px' }}>
                          you
                        </span>
                      )}
                      {member.is_locked && (
                        <Lock size={12} style={{ color: 'var(--warning)' }} aria-label="Temporarily locked out" />
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }} className="truncate">
                      {member.email}
                    </div>
                  </div>
                  <span className={`badge ${isOwner ? 'badge-active' : 'badge-checked_in'}`}>
                    {member.role}
                  </span>
                </div>

                {/* Granular permissions */}
                {isOwner ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
                    fontSize: 12.5, color: 'var(--accent-green-text)',
                    background: 'var(--accent-green-bg)', border: '1px solid var(--success-border)',
                    borderRadius: 8, padding: '10px 12px',
                  }}>
                    <ShieldCheck size={14} /> Full access — owners hold every permission
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                    {PERMISSION_DEFS.map((def) => (
                      <PermPill
                        key={def.key}
                        def={def}
                        on={member[def.key]}
                        disabled={saving === member.id}
                        onToggle={(next) => togglePermission(member, def.key, next)}
                      />
                    ))}
                  </div>
                )}

                <div className="divider" />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {member.is_active ? 'Active' : 'Suspended'}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {isSelf ? 'You cannot change your own account' : member.is_active ? 'Has access for their role' : 'Sign-in disabled'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Toggle
                      checked={member.is_active}
                      disabled={isSelf || saving === member.id}
                      onChange={(next) => toggleActive(member, next)}
                      label={`${member.first_name} account status`}
                    />
                  </div>
                </div>

                {/* Remove action / inline confirm */}
                {!isSelf && (
                  <>
                    <div style={{ height: 12 }} />
                    <AnimatePresence mode="wait" initial={false}>
                      {confirmId === member.id ? (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'var(--error-bg)', border: '1px solid var(--error-border)',
                            borderRadius: 8, padding: '8px 10px',
                          }}
                        >
                          <span style={{ fontSize: 12, color: 'var(--error)', flex: 1 }}>
                            Remove {member.first_name}?
                          </span>
                          <button className="btn btn-remove btn-sm" disabled={saving === member.id}
                            onClick={() => removeStaff(member)}>
                            {saving === member.id ? 'Removing…' : 'Confirm remove'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>
                            Cancel
                          </button>
                        </motion.div>
                      ) : (
                        <motion.button
                          key="remove"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="btn btn-remove btn-sm"
                          style={{ width: '100%', justifyContent: 'center' }}
                          onClick={() => setConfirmId(member.id)}
                        >
                          <Trash2 size={13} /> Remove
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            );
          })}
          {staff.length === 0 && (
            <div className="empty-state">
              <UserRound size={28} className="empty-state-icon" />
              <span className="empty-state-title">No teammates yet</span>
            </div>
          )}
        </div>
      )}

      {/* ── Add Staff modal ── */}
      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div
              // Full-viewport flex overlay does the centering. The modal itself
              // is an in-flow flex child (NOT position:fixed) so motion's inline
              // transform can animate freely without clobbering a translate(-50%)
              // centering trick — the bug that pushed the old modal off-screen.
              style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 16,
              }}
              variants={OVERLAY} initial="hidden" animate="visible" exit="hidden"
              transition={{ duration: 0.18 }}
              onClick={() => !creating && setModalOpen(false)}
            >
              <motion.div
                style={{
                  position: 'relative',
                  width: '100%', maxWidth: 520, maxHeight: '90vh',
                  display: 'flex', flexDirection: 'column',
                  background: 'var(--surface)', border: '1px solid var(--border-focus)',
                  borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-xl)',
                  overflow: 'hidden',
                }}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                onClick={(e) => e.stopPropagation()}
                role="dialog" aria-modal="true" aria-label="Add staff member"
              >
                {/* Header — pinned */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '18px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0,
                }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserPlus size={16} style={{ color: 'var(--accent-green-text)' }} /> Add Staff Member
                  </h3>
                  <button className="btn btn-ghost btn-sm" aria-label="Close" onClick={() => setModalOpen(false)} style={{ padding: 6 }}>
                    <X size={16} />
                  </button>
                </div>

                {/* Scrollable body */}
                <div style={{
                  flex: 1, minHeight: 0, overflowY: 'auto',
                  padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                  {error && modalOpen && (
                    <div role="alert" style={{
                      background: 'var(--error-bg)', border: '1px solid var(--error-border)',
                      color: 'var(--error)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5,
                    }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="input-group">
                      <label className="input-label">First name</label>
                      <input className="input" value={draft.firstName} maxLength={80}
                        onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Last name</label>
                      <input className="input" value={draft.lastName} maxLength={80}
                        onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))} />
                    </div>
                  </div>

                  <div className="input-group">
                    <label className="input-label">Login email</label>
                    <input className="input" type="email" placeholder="staff@club.com" value={draft.email}
                      onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="input-group">
                      <label className="input-label">Phone (optional)</label>
                      <input className="input" type="tel" value={draft.phone} maxLength={32}
                        onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Base role</label>
                      <select className="input" value={draft.role}
                        onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as 'receptionist' | 'owner' }))}>
                        <option value="receptionist">Staff / Desk</option>
                        <option value="owner">Owner</option>
                      </select>
                    </div>
                  </div>

                  {/* Granular permission pills */}
                  <div>
                    <label className="input-label" style={{ marginBottom: 8, display: 'block' }}>
                      Granular permissions
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {PERMISSION_DEFS.map((def) => (
                        <PermPill
                          key={def.key}
                          def={def}
                          on={ownerRole ? true : draft.permissions[def.key]}
                          disabled={ownerRole}
                          onToggle={(next) => setDraft((d) => ({
                            ...d, permissions: { ...d.permissions, [def.key]: next },
                          }))}
                        />
                      ))}
                    </div>
                    {ownerRole && (
                      <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 8 }}>
                        Owners automatically hold every permission.
                      </p>
                    )}
                  </div>
                </div>

                {/* Footer — pinned, always visible */}
                <div style={{
                  display: 'flex', gap: 10, padding: '16px 24px',
                  borderTop: '1px solid var(--border)', flexShrink: 0,
                  background: 'var(--surface)',
                }}>
                  <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => setModalOpen(false)} disabled={creating}>
                    Cancel
                  </button>
                  <motion.button
                    className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }}
                    whileTap={{ scale: 0.98 }} onClick={createStaff} disabled={creating}>
                    {creating ? <><span className="spinner" /> Adding…</> : <><UserPlus size={14} /> Invite staff member</>}
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
