'use client';

import React, { useState, useEffect } from 'react';
import * as StellarSdk from "@stellar/stellar-sdk";

const AGENT_PRIVATE_KEY = process.env.NEXT_PUBLIC_AGENT_PRIVATE_KEY || '';
const SERVER_ADDRESS = process.env.NEXT_PUBLIC_SERVER_ADDRESS || '';

export default function WalletInfo() {
  const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  const shortKey = (key: string) => `${key.slice(0, 6)}…${key.slice(-4)}`;
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        // Safe fetch with timeout
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 5000);

        try {
          // Use Stellar Horizon API for balance
          const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
          const account = await server.loadAccount(SERVER_ADDRESS);
          clearTimeout(id);

          // Find XLM balance
          const xlmBalance = account.balances.find((b: any) => b.asset_type === 'native');
          if (xlmBalance) {
            setBalance(parseFloat(xlmBalance.balance).toFixed(2));
          } else {
            setBalance('0.00');
          }
        } catch (innerErr) {
          clearTimeout(id);
          throw innerErr;
        }
      } catch (e) {
        // Suppress network errors to avoid console spam, just update UI state
        setBalance('---');
      }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [SERVER_ADDRESS]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {/* Network badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 8,
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.2)',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#FF854B',
          boxShadow: '0 0 6px rgba(255,133,75,0.6)',
        }} />
        <span style={{ fontSize: '0.6rem', color: '#FF854B', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
          STELLAR TESTNET
        </span>
      </div>

      {/* Server Address */}
      <div style={{
        padding: '4px 10px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontSize: '0.5rem', color: 'var(--text-muted)', marginBottom: 1 }}>Server</div>
        <div style={{
          fontSize: '0.62rem', color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
        }}>
          {shortAddr(SERVER_ADDRESS)}
          <span style={{ marginLeft: 6, color: 'var(--accent-primary)', fontWeight: 700 }}>
            {balance ? `${balance} XLM` : '...'}
          </span>
        </div>
      </div>

      {/* Agent Key */}
      <div style={{
        padding: '4px 10px', borderRadius: 8,
        background: 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.15)',
      }}>
        <div style={{ fontSize: '0.5rem', color: 'var(--text-muted)', marginBottom: 1 }}>Agent Key</div>
        <div style={{
          fontSize: '0.62rem', color: 'var(--accent-primary)',
          fontFamily: 'var(--font-mono)',
        }}>
          {shortKey(AGENT_PRIVATE_KEY)}
        </div>
      </div>
    </div>
  );
}
