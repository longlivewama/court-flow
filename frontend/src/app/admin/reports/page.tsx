'use client';

/**
 * Owner Reports Page – generate and export all 9 report types.
 * Supports PDF, Excel, and CSV formats.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart2, Download, FileText, Table } from 'lucide-react';
import { api } from '@/lib/api';

const SPRING = { type: 'spring' as const, stiffness: 380, damping: 30 };

const REPORT_TYPES = [
  { value: 'daily_revenue',       label: 'Daily Revenue',       desc: 'Revenue breakdown for a specific date' },
  { value: 'weekly_revenue',      label: 'Weekly Revenue',      desc: 'Revenue totals grouped by week' },
  { value: 'monthly_revenue',     label: 'Monthly Revenue',     desc: 'Revenue summary by month' },
  { value: 'court_utilization',   label: 'Court Utilization',   desc: 'Booking percentage per court' },
  { value: 'booking_history',     label: 'Booking History',     desc: 'Full booking log with filters' },
  { value: 'customer_activity',   label: 'Customer Activity',   desc: 'Per-customer booking statistics' },
  { value: 'payment_history',     label: 'Payment History',     desc: 'All payment records including refunds' },
  { value: 'cancellation_report', label: 'Cancellations',       desc: 'All cancelled bookings with reasons' },
  { value: 'noshow_report',       label: 'No-Shows',            desc: 'Customers who did not check in' },
];

export default function ReportsPage() {
  const [selectedType, setSelectedType] = useState('booking_history');
  const [format, setFormat]             = useState<'pdf' | 'excel' | 'csv'>('excel');
  const [fromDate, setFromDate]         = useState('');
  const [toDate, setToDate]             = useState('');
  const [generating, setGenerating]     = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const res = await api.post('/reports/generate', {
        type: selectedType,
        format,
        filters: { from: fromDate || undefined, to: toDate || undefined },
      }, { responseType: 'blob' });

      // Trigger download
      const blob = new Blob([res.data], { type: String(res.headers['content-type'] ?? '') });
      const url  = URL.createObjectURL(blob);
      const ext  = format === 'excel' ? 'xlsx' : format;
      const link = document.createElement('a');
      link.href  = url;
      link.download = `${selectedType}_${Date.now()}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Report generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  const FORMAT_ICONS = {
    pdf:   <FileText size={14} />,
    excel: <Table size={14} />,
    csv:   <BarChart2 size={14} />,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Generate and export operational reports</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        {/* Report type selector */}
        <div>
          <div style={{ marginBottom: 16, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-tertiary)' }}>
            Report Type
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {REPORT_TYPES.map((rt) => (
              <motion.button
                key={rt.value}
                onClick={() => setSelectedType(rt.value)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 2, padding: '12px 16px',
                  background: selectedType === rt.value ? 'var(--surface-2)' : 'transparent',
                  border: `1px solid ${selectedType === rt.value ? 'var(--border-focus)' : 'var(--border)'}`,
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'all 150ms ease',
                }}
                whileHover={{ borderColor: 'var(--border-focus)' }}
                whileTap={{ scale: 0.99 }}
                id={`report-type-${rt.value}`}
                aria-pressed={selectedType === rt.value}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: selectedType === rt.value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {rt.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{rt.desc}</div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Export panel */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 24 }}>
            <h3 style={{ marginBottom: 20, fontSize: 15 }}>Export Options</h3>

            {/* Format selector */}
            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label">Export format</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['pdf', 'excel', 'csv'] as const).map((f) => (
                  <motion.button
                    key={f}
                    className={`btn btn-sm ${format === f ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFormat(f)}
                    whileTap={{ scale: 0.96 }}
                    style={{ flex: 1, justifyContent: 'center' }}
                    aria-pressed={format === f}
                  >
                    {FORMAT_ICONS[f]}
                    {f.toUpperCase()}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div className="input-group" style={{ marginBottom: 12 }}>
              <label htmlFor="from-date" className="input-label">From date</label>
              <input
                id="from-date"
                type="date"
                className="input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="input-group" style={{ marginBottom: 24 }}>
              <label htmlFor="to-date" className="input-label">To date</label>
              <input
                id="to-date"
                type="date"
                className="input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            {/* Selected report info */}
            <div style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '10px 14px', marginBottom: 16,
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Generating</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {REPORT_TYPES.find((r) => r.value === selectedType)?.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {format.toUpperCase()} export
              </div>
            </div>

            <motion.button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={generate}
              disabled={generating}
              whileTap={{ scale: 0.98 }}
              id="generate-report-btn"
            >
              {generating ? (
                <><div className="spinner" style={{ width: 14, height: 14 }} />Generating…</>
              ) : (
                <><Download size={14} />Export {format.toUpperCase()}</>
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
