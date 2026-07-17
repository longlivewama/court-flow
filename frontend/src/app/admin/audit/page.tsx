
'use client';

/**
 * Audit Log Viewer – append-only, filterable, owner-only.
 * Displays the immutable audit_logs table with precise timestamps.
 */
import { Fragment, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Shield, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { format } from 'date-fns';

interface AuditEntry {
  id: number;
  timestamp_utc: string;
  user_id: string;
  user_role: string;
  ip_address: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
}

const ACTION_COLORS: Record<string, string> = {
  USER_LOGIN: 'var(--info)',
  USER_LOGIN_FAILED: 'var(--error)',
  BOOKING_CREATED: 'var(--success)',
  BOOKING_CANCELLED: 'var(--error)',
  BOOKING_DELETED: 'var(--error)',
  BOOKING_NO_SHOW: 'var(--error)',
  DEPOSIT_APPROVED: 'var(--success)',
  DEPOSIT_REJECTED: 'var(--error)',
  BOOKING_CHECKED_IN: 'var(--info)',
  REFUND_APPROVED: 'var(--warning)',
};

// ── Generic detail formatting ─────────────────────────────────────
// Audit payloads are fully dynamic (each action_type writes its own
// shape), so keys and values are transformed generically rather than
// mapped per action.

/** camelCase / snake_case / kebab-case → "Title Case" */
function formatKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const DATE_ONLY_RE    = /^\d{4}-\d{2}-\d{2}$/;

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (typeof value === 'string') {
    if (ISO_DATETIME_RE.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return format(d, 'dd/MM/yyyy hh:mm aa');
    }
    if (DATE_ONLY_RE.test(value)) {
      const [y, m, d] = value.split('-').map(Number);
      return format(new Date(y, m - 1, d), 'dd/MM/yyyy');
    }
    // Plain numeric strings (prices, durations) – preserve decimals but add
    // thousands separators. Leading-zero strings (phone numbers) are left as-is.
    if (/^-?[1-9]\d*(\.\d+)?$/.test(value) || /^-?0(\.\d+)?$/.test(value)) {
      const decimals = Math.min(value.split('.')[1]?.length ?? 0, 2);
      return Number(value).toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      });
    }
    return value;
  }
  return String(value);
}

/** Recursive key-value list for an arbitrary audit payload object. */
function DetailList({ data, depth = 0 }: { data: Record<string, unknown>; depth?: number }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</div>;
  }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      paddingLeft: depth > 0 ? 12 : 0,
      borderLeft: depth > 0 ? '2px solid var(--border)' : 'none',
    }}>
      {entries.map(([key, value]) => {
        const isNestedObject = value !== null && typeof value === 'object' && !Array.isArray(value);
        const isObjectArray  = Array.isArray(value) && value.some((v) => v !== null && typeof v === 'object');

        if (isNestedObject || isObjectArray) {
          const items = isNestedObject ? [value] : (value as unknown[]);
          return (
            <div key={key}>
              <div style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4,
              }}>
                {formatKey(key)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((item, i) => (
                  item !== null && typeof item === 'object'
                    ? <DetailList key={i} data={item as Record<string, unknown>} depth={depth + 1} />
                    : <div key={i} style={{ fontSize: 12, color: 'var(--text-primary)' }}>{formatValue(item)}</div>
                ))}
              </div>
            </div>
          );
        }

        return (
          <div key={key} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            gap: 16, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 5,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
              {formatKey(key)}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)', textAlign: 'right',
              overflowWrap: 'anywhere',
            }}>
              {Array.isArray(value) && value.length > 0
                ? value.map(formatValue).join(', ')
                : formatValue(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/audit?limit=100').then(({ data }) => {
      setLogs(data.data ?? data);
    }).catch(() => { }).finally(() => setLoading(false));
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
              <Fragment key={log.id}>
                <motion.tr
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
                        borderRadius: 6, padding: 14,
                        display: 'flex', flexDirection: 'column', gap: 12,
                      }}>
                        {!log.previous_values && !log.new_values && !log.reason && (
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                            No additional details recorded for this action.
                          </div>
                        )}

                        <div style={{
                          display: 'grid', gap: 12,
                          gridTemplateColumns: log.previous_values && log.new_values ? '1fr 1fr' : '1fr',
                        }}>
                          {log.previous_values && (
                            <div style={{
                              background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)',
                              borderRadius: 6, padding: '10px 12px',
                            }}>
                              <div style={{
                                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                                letterSpacing: 1, color: 'var(--error)', marginBottom: 8,
                              }}>
                                Previous Values
                              </div>
                              <DetailList data={log.previous_values} />
                            </div>
                          )}
                          {log.new_values && (
                            <div style={{
                              background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)',
                              borderRadius: 6, padding: '10px 12px',
                            }}>
                              <div style={{
                                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                                letterSpacing: 1, color: 'var(--success)', marginBottom: 8,
                              }}>
                                New Values
                              </div>
                              <DetailList data={log.new_values} />
                            </div>
                          )}
                        </div>

                        {log.reason && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: 1, color: 'var(--text-tertiary)', marginRight: 8,
                            }}>
                              Reason
                            </span>
                            {log.reason}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
