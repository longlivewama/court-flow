'use client';

/**
 * Audit Log Viewer – append-only, filterable, owner-only.
 * Displays the immutable audit_logs table with precise timestamps.
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { format } from 'date-fns';

interface AuditEntry {
  id:              number;
  timestamp_utc:   string;
  user_id:         string;
  user_role:       string;
  ip_address:      string;
  action_type:     string;
  entity_type:     string;
  entity_id:       string;
  previous_values: Record<string, unknown> | null;
  new_values:      Record<string, unknown> | null;
  reason:          string | null;
}

const ACTION_COLORS: Record<string, string> = {
  USER_LOGIN:         'var(--info)',
  USER_LOGIN_FAILED:  'var(--error)',
  BOOKING_CREATED:    'var(--success)',
  BOOKING_CANCELLED:  'var(--error)',
  BOOKING_DELETED:    'var(--error)',
  BOOKING_NO_SHOW:    'var(--error)',
  DEPOSIT_APPROVED:   'var(--success)',
  DEPOSIT_REJECTED:   'var(--error)',
  BOOKING_CHECKED_IN: 'var(--info)',
  REFUND_APPROVED:    'var(--warning)',
};

export default function AuditPage() {
  const [logs, setLogs]         = useState<AuditEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch]     = useState('');

  useEffect(() => {
    api.get('/audit?limit=100').then(({ data }) => {
      setLogs(data.data ?? data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? logs.filter((l) =>
        [l.action_type, l.entity_type, l.entity_id, l.user_role, l.ip_address]
          .join(' ').toLowerCase().includes(search.toLowerCase())
      )
    : logs;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={22} />
          <div>
            <h1 className="page-title">Audit Log</h1>
            <p className="page-subtitle">Immutable record of all system actions</p>
          </div>
        </div>
      </div>

      {/* Notice */}
      <div style={{
        background: 'var(--info-bg)', border: '1px solid var(--info-border)',
        borderRadius: 8, padding: '12px 16px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--info)',
      }}>
        <Shield size={14} />
        This log is append-only. No entries can be modified or deleted.
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20, maxWidth: 400 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
        <input
          className="input"
          placeholder="Filter by action, entity, role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 36 }}
          aria-label="Search audit logs"
        />
      </div>

      {/* Log table */}
      <div className="table-wrap">
        <table aria-label="Audit log">
          <thead>
            <tr>
              <th>Timestamp (UTC)</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Role</th>
              <th>IP Address</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j}><div className="skeleton" style={{ height: 13, width: 80 }} /></td>
                  ))}
                </tr>
              ))
            ) : filtered.map((log) => (
              <>
                <motion.tr
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {format(new Date(log.timestamp_utc), 'dd/MM/yyyy HH:mm:ss')}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                      color: ACTION_COLORS[log.action_type] ?? 'var(--text-secondary)',
                    }}>
                      {log.action_type}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{log.entity_type}</span>
                    {log.entity_id && (
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        #{log.entity_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                    {log.user_role}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {log.ip_address ?? '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {expanded === log.id ? '▲ hide' : '▼ show'}
                  </td>
                </motion.tr>

                {/* Expanded details row */}
                {expanded === log.id && (
                  <tr key={`${log.id}-detail`}>
                    <td colSpan={6} style={{ padding: '0 16px 16px' }}>
                      <div style={{
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        borderRadius: 6, padding: 12, display: 'grid',
                        gridTemplateColumns: '1fr 1fr', gap: 12,
                      }}>
                        {log.previous_values && (
                          <div>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                              Previous Values
                            </div>
                            <pre style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--error)', overflow: 'auto' }}>
                              {JSON.stringify(log.previous_values, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.new_values && (
                          <div>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                              New Values
                            </div>
                            <pre style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--success)', overflow: 'auto' }}>
                              {JSON.stringify(log.new_values, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
