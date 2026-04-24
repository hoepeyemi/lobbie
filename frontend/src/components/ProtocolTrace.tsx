'use client';

import React, { useState } from 'react';
import { Shield, Lock, Eye, EyeOff, Code } from 'lucide-react';
import { useI18n } from '@/lib/LanguageContext';

interface ProtocolTraceEntry {
  step: string;
  httpStatus: number;
  headers: Record<string, string>;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
  timestamp: string | number;
  paymentPayload?: string;
}

interface HiringDecision {
  tool: string;
  selectedAgent: string;
  reason: string;
  valueScore: number;
  alternatives: { id: string; score: number }[];
  approved: boolean;
}

interface Props {
  traces: ProtocolTraceEntry[];
  hiringDecisions: HiringDecision[];
}

export default function ProtocolTrace({ traces, hiringDecisions }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'protocol' | 'hiring'>('protocol');
  const [showTechnical, setShowTechnical] = useState(false);

  // Helper to check if timestamp is valid
  const isValidTimestamp = (ts: string | number | undefined): boolean => {
    if (!ts) return false;
    try {
      const date = typeof ts === 'string' ? new Date(ts) : new Date(ts);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  };

  // Filter traces and hiring decisions to only show entries with valid timestamps
  const validTraces = traces.filter(t => isValidTimestamp(t.timestamp));
  const validHiringDecisions = hiringDecisions.filter(d => isValidTimestamp((d as any).timestamp));

  return (
    <div className="glass-panel" style={{ height: '100%', padding: 14, display: 'flex', flexDirection: 'column' }}>
      {/* Header with tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { key: 'protocol', label: t.techTrace, count: validTraces.length },
            { key: 'hiring', label: t.hiringLog, count: validHiringDecisions.length },
          ] as const).map(t_tab => (
            <button
              key={t_tab.key}
              onClick={() => setTab(t_tab.key)}
              style={{
                padding: '3px 10px', fontSize: '0.6rem', fontWeight: 700,
                borderRadius: 6, border: '1px solid',
                borderColor: tab === t_tab.key ? 'var(--accent-cyan)' : 'var(--border-subtle)',
                background: tab === t_tab.key ? 'rgba(6,182,212,0.1)' : 'transparent',
                color: tab === t_tab.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'all 0.15s',
                letterSpacing: '0.03em',
              }}
            >
              {t_tab.label} {t_tab.count > 0 && <span style={{ opacity: 0.6 }}>({t_tab.count})</span>}
            </button>
          ))}
        </div>

        {tab === 'protocol' && validTraces.length > 0 && (
          <button
            onClick={() => setShowTechnical(!showTechnical)}
            style={{
              padding: '2px 8px', fontSize: '0.55rem', fontWeight: 600,
              borderRadius: 4, border: '1px solid var(--border-subtle)',
              background: showTechnical ? 'var(--accent-primary)' : 'transparent',
              color: showTechnical ? '#fff' : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 4,
              cursor: 'pointer', transition: 'all 0.1s'
            }}
          >
            {showTechnical ? <EyeOff size={10} /> : <Eye size={10} />}
            {showTechnical ? 'HIDE TECH' : 'SHOW TECH'}
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'protocol' ? (
          validTraces.length === 0 ? (
            <EmptyState text={t.emptyProtocol} />
          ) : (
            validTraces.map((trace, i) => <TraceCard key={i} trace={trace} index={i} showTechnical={showTechnical} />)
          )
        ) : (
          validHiringDecisions.length === 0 ? (
            <EmptyState text={t.emptyHiring} />
          ) : (
            validHiringDecisions.map((decision, i) => <HiringCard key={i} decision={decision} />)
          )
        )}
      </div>
    </div>
  );
}

function TraceCard({ trace, index, showTechnical }: { trace: ProtocolTraceEntry; index: number; showTechnical: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = trace.httpStatus === 402 ? '#f59e0b' : trace.httpStatus === 200 ? '#10b981' : '#ef4444';

  const formatTimestamp = (ts: string | number) => {
    try {
      const date = typeof ts === 'string' ? new Date(ts) : new Date(ts);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString();
    } catch {
      return '';
    }
  };

  return (
    <div
      style={{
        padding: '8px 10px', marginBottom: 4,
        background: '#fafbfc',
        borderRadius: 6, border: '1px solid var(--border-subtle)',
        cursor: 'pointer', transition: 'all 0.15s',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: '0.55rem', fontWeight: 700,
          color: statusColor,
          fontFamily: 'var(--font-mono)',
          background: `${statusColor}15`,
          padding: '1px 6px', borderRadius: 4,
          boxShadow: trace.httpStatus === 402 ? '0 0 8px rgba(245, 158, 11, 0.4)' : 'none',
          border: trace.httpStatus === 402 ? '1px solid rgba(245, 158, 11, 0.5)' : 'none',
        }}>
          {trace.httpStatus}
        </span>
        <span style={{
          fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, flex: 1,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {trace.step}
        </span>
        <span style={{
          fontSize: '0.5rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
          flexShrink: 0, marginLeft: 8,
        }}>
          {formatTimestamp(trace.timestamp)}
        </span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div style={{
          marginTop: 8, padding: 8,
          background: '#f3f4f6',
          borderRadius: 6, fontFamily: 'var(--font-mono)',
          fontSize: '0.55rem', color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}>

          {showTechnical && trace.requestHeaders && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Lock size={10} /> Request Headers:
              </div>
              {Object.entries(trace.requestHeaders).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: '#8b5cf6' }}>{k}:</span>{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: 4 }}>
            Response Headers:
          </div>
          {Object.keys(trace.headers || {}).length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No response headers recorded for this step.</div>
          ) : (
            Object.entries(trace.headers || {}).map(([k, v]) => (
              <div key={k}>
                <span style={{ color: '#FF854B' }}>{k}:</span>{' '}
                <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                  {typeof v === 'string' ? v.slice(0, 400) : JSON.stringify(v).slice(0, 400)}
                </span>
              </div>
            ))
          )}

          {trace.paymentPayload && (
            <>
              <div style={{ color: '#f59e0b', fontWeight: 700, marginTop: 8, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Shield size={10} /> x402 Payment Payload (EIP-712):
              </div>
              <pre style={{
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.55rem',
                overflowX: 'auto',
                padding: 8,
                background: '#f3f4f6',
                borderRadius: 4,
                margin: 0,
                borderLeft: '2px solid #f59e0b'
              }}>
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(trace.paymentPayload), null, 2);
                  } catch (e) {
                    return trace.paymentPayload;
                  }
                })()}
              </pre>
            </>
          )}

          {showTechnical && trace.requestBody && (
             <div style={{ marginTop: 8 }}>
               <div style={{ color: '#8b5cf6', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                 <Code size={10} /> Request Body:
               </div>
               <pre style={{
                 color: 'var(--text-secondary)',
                 fontFamily: 'var(--font-mono)',
                 fontSize: '0.55rem',
                 padding: 4,
                 background: 'rgba(255,255,255,0.05)',
                 borderRadius: 4
               }}>
                 {JSON.stringify(trace.requestBody, null, 2)}
               </pre>
             </div>
          )}
        </div>
      )}
    </div>
  );
}

function HiringCard({ decision }: { decision: HiringDecision }) {
  return (
    <div style={{
      padding: '8px 10px', marginBottom: 4,
      background: decision.approved ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)',
      borderRadius: 6,
      border: `1px solid ${decision.approved ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {decision.tool}
          </span>
          <span style={{
            fontSize: '0.5rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4,
            background: decision.approved ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            color: decision.approved ? '#10b981' : '#ef4444',
          }}>
            {decision.approved ? 'HIRED' : 'REJECTED'}
          </span>
        </div>
        <span style={{
          fontSize: '0.55rem', color: 'var(--accent-cyan)',
          fontFamily: 'var(--font-mono)', fontWeight: 700,
        }}>
          score: {decision.valueScore?.toFixed(1)}
        </span>
      </div>

      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginBottom: 4 }}>
        → <strong style={{ color: 'var(--text-secondary)' }}>{decision.selectedAgent}</strong> — {decision.reason}
      </div>

      {decision.alternatives?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, fontSize: '0.5rem', color: 'var(--text-muted)' }}>
          <span>Alternatives:</span>
          {decision.alternatives.slice(0, 3).map((alt, i) => (
            <span key={i} style={{ fontFamily: 'var(--font-mono)' }}>
              {alt.id}({alt.score?.toFixed(1)})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      padding: 20, textAlign: 'center',
      color: 'var(--text-muted)', fontSize: '0.65rem',
      lineHeight: 1.5,
    }}>
      {text}
    </div>
  );
}
