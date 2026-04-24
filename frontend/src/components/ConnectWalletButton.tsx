'use client';

import React from 'react';
import { useWallet } from '../lib/WalletProvider';

export default function ConnectWalletButton() {
  const { address, connect, disconnect, isConnected } = useWallet();

  if (isConnected && address) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
           padding: '8px 12px',
           borderRadius: 8,
           background: 'rgba(16,185,129,0.08)',
           border: '1px solid rgba(16,185,129,0.2)',
           color: '#059669',
           fontSize: '0.85rem',
           fontWeight: 600,
           fontFamily: 'var(--font-mono)',
        }}>
          {address.slice(0, 6)}...{address.slice(-4)}
        </div>
        <button
          onClick={disconnect}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'transparent',
            border: '1px solid #e5e7eb',
            color: '#6b7280',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 500
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      style={{
        padding: '8px 16px',
        borderRadius: 8,
        background: '#111827',
        color: '#fff',
        border: 'none',
        cursor: 'pointer',
        fontSize: '0.9rem',
        fontWeight: 600,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        transition: 'all 0.2s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      }}
    >
      Connect Wallet
    </button>
  );
}
