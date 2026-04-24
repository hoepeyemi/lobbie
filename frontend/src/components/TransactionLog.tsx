/* eslint-disable react-hooks/purity */
'use client';

import React, { useEffect, useState } from 'react';
import { useI18n } from '@/lib/LanguageContext';
import { API_URL } from '@/lib/api';

const API = API_URL;

interface Payment {
  id: string;
  timestamp: string | number;
  endpoint: string;
  payer: string;
  worker: string;
  transaction: string;
  token: string;
  amount: string;
  explorerUrl?: string;
  horizonUrl?: string;
  settlementNetwork?: 'testnet' | 'public';
  isA2A: boolean;
  parentJobId?: string;
  depth: number;
  rawHeaders?: Record<string, string>;
  metadata?: {
    flashSwap?: {
      provider: string;
      pair: string;
      amount: string;
      fee: string;
      reason: string;
    };
    settlementWarning?: string;
  };
}

interface Props {
  refreshTrigger: number;
}

export default function TransactionLog({ refreshTrigger }: Props) {
  const { t } = useI18n();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [a2aCount, setA2aCount] = useState(0);

  useEffect(() => {
    const fetchPayments = async () => {
      try {
        const res = await fetch(`${API}/api/payments`);
        const data = await res.json();
        setPayments(data.payments || []);
        setA2aCount(data.a2aCount || 0);
      } catch {}
    };
    fetchPayments();
  }, [refreshTrigger]);

  // Also poll
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/payments`);
        const data = await res.json();
        setPayments(data.payments || []);
        setA2aCount(data.a2aCount || 0);
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass-panel" style={{ height: '100%', padding: 14, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t.transactions}</span>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {payments.length} {t.total}
          </span>
        </div>
        {a2aCount > 0 && (
          <span className="badge badge-a2a" style={{ fontSize: '0.55rem' }}>{a2aCount} {t.a2a}</span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {payments.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
            {t.emptyTransactions}
          </div>
        ) : (
          payments.slice().reverse().map((p) => (
            <PaymentCard key={p.id} payment={p} />
          ))
        )}
      </div>
    </div>
  );
}

function PaymentCard({ payment }: { payment: Payment }) {
  const { t } = useI18n();
  const explorerUrl = payment.explorerUrl;
  const horizonUrl = payment.horizonUrl;
  const settlementWarning =
    typeof payment.metadata?.settlementWarning === 'string' ? payment.metadata.settlementWarning : undefined;
  const shortAddr = (addr: string) =>
    addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '???';
  const timeAgo = (ts: string | number) => {
    const date = typeof ts === 'string' ? new Date(ts) : new Date(ts);
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  return (
    <div style={{
      padding: '10px 12px', marginBottom: 6,
      background: payment.isA2A ? 'rgba(245,158,11,0.06)' : '#fafbfc',
      borderRadius: 8, border: `1px solid ${payment.isA2A ? 'rgba(245,158,11,0.15)' : 'var(--border-subtle)'}`,
      transition: 'all 0.2s',
    }}>
      {/* Row 1: endpoint + amount */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
          }}>
            {payment.endpoint}
          </span>
          {payment.isA2A && <span className="badge badge-a2a" style={{ fontSize: '0.5rem' }}>{t.a2a}</span>}
          {payment.depth > 0 && (
            <span style={{ fontSize: '0.5rem', color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
              {t.depth}:{payment.depth}
            </span>
          )}
        </div>
        <span className="badge badge-xlm" style={{ fontSize: '0.55rem' }} title="Stellar (XLM)">
          {payment.amount}
        </span>
      </div>

      {/* Row 2: payer → worker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        <span>{shortAddr(payment.payer)}</span>
        <span style={{ color: payment.isA2A ? '#f59e0b' : 'var(--accent-cyan)' }}>→</span>
        <span>{shortAddr(payment.worker)}</span>
        <span style={{ marginLeft: 'auto' }}>{timeAgo(payment.timestamp)}</span>
      </div>

      {/* Bitflow Flash Swap Metadata */}
      {payment.metadata?.flashSwap && (
        <div style={{
          marginTop: 8,
          padding: 8,
          background: 'rgba(16,185,129,0.06)',
          border: '1px dashed rgba(16,185,129,0.3)',
          borderRadius: 6,
          fontSize: '0.55rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', fontWeight: 700, marginBottom: 4 }}>
            <span>⚡ {payment.metadata.flashSwap.provider} {t.flashSwap}</span>
            <span>{payment.metadata.flashSwap.pair}</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
            {t.swapAmount}: <span style={{ color: 'var(--text-primary)' }}>{payment.metadata.flashSwap.amount}</span>
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            {t.reason}: {payment.metadata.flashSwap.reason}
          </div>
        </div>
      )}

      {/* Links only when backend verified the hash on Horizon (or SKIP_HORIZON_TX_VERIFY). */}
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {explorerUrl || horizonUrl ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            {explorerUrl && (
              <a
                href={explorerUrl}
                title="Open this transaction on StellarExpert"
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '0.55rem', color: 'var(--accent-cyan)', textDecoration: 'none',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t.viewExplorer}
              </a>
            )}
            {horizonUrl && (
              <a
                href={horizonUrl}
                title="Open this transaction JSON on Horizon"
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '0.55rem', color: 'var(--accent-cyan)', textDecoration: 'none',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t.viewHorizon}
              </a>
            )}
          </div>
        ) : (
          <span
            style={{
              fontSize: '0.55rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            }}
            title={settlementWarning || t.explorerNoTxId}
          >
            {t.explorerNoTxId}
          </span>
        )}
        {settlementWarning && (
          <span
            style={{
              fontSize: '0.5rem', color: '#b45309', fontFamily: 'var(--font-mono)', lineHeight: 1.35,
            }}
            title={settlementWarning}
          >
            {settlementWarning.length > 240 ? `${settlementWarning.slice(0, 240)}…` : settlementWarning}
          </span>
        )}
      </div>
    </div>
  );
}
