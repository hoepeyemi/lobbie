'use client';

import React, { useState, useEffect } from 'react';
import { createPublicClient, formatEther, http, isAddress, type Address } from 'viem';
import { useAccount, useBalance } from 'wagmi';
import { galileoTestnet } from '@/lib/wagmiConfig';

const AGENT_PRIVATE_KEY = process.env.NEXT_PUBLIC_AGENT_PRIVATE_KEY || '';
const SERVER_ADDRESS = (process.env.NEXT_PUBLIC_SERVER_ADDRESS || '').trim();
const rpc =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_EVM_RPC_URL?.trim()) ||
  'https://evmrpc-testnet.0g.ai';

const publicClient = createPublicClient({
  chain: galileoTestnet,
  transport: http(rpc),
});

export default function WalletInfo() {
  const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  const shortKey = (key: string) => (key ? `${key.slice(0, 6)}…${key.slice(-4)}` : '—');
  const { address: connected } = useAccount();
  const { data: userBal } = useBalance({ address: connected });
  const [serverBalance, setServerBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!SERVER_ADDRESS || !isAddress(SERVER_ADDRESS)) {
      setServerBalance(null);
      return;
    }
    const ac = async () => {
      try {
        const wei = await publicClient.getBalance({ address: SERVER_ADDRESS as Address });
        setServerBalance(formatEther(wei));
      } catch {
        setServerBalance('—');
      }
    };
    void ac();
    const interval = setInterval(() => void ac(), 10_000);
    return () => clearInterval(interval);
  }, [SERVER_ADDRESS]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 8,
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.2)',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#7c3aed',
          boxShadow: '0 0 6px rgba(124,58,237,0.5)',
        }} />
        <span style={{ fontSize: '0.6rem', color: '#5b21b6', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
          0G GALILEO
        </span>
      </div>

      {connected && (
        <div style={{
          padding: '4px 10px', borderRadius: 8,
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.2)',
        }}>
          <div style={{ fontSize: '0.5rem', color: 'var(--text-muted)', marginBottom: 1 }}>Your wallet</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {shortAddr(connected)}
            <span style={{ marginLeft: 6, color: 'var(--accent-primary)', fontWeight: 700 }}>
              {userBal ? `${parseFloat(userBal.formatted).toFixed(4)} ${userBal.symbol}` : '…'}
            </span>
          </div>
        </div>
      )}

      {SERVER_ADDRESS && isAddress(SERVER_ADDRESS) && (
        <div style={{
          padding: '4px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--border-subtle)',
        }}>
          <div style={{ fontSize: '0.5rem', color: 'var(--text-muted)', marginBottom: 1 }}>Server (EVM)</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {shortAddr(SERVER_ADDRESS)}
            <span style={{ marginLeft: 6, color: 'var(--accent-primary)', fontWeight: 700 }}>
              {serverBalance != null && serverBalance !== '—' ? `${parseFloat(serverBalance).toFixed(4)} 0G` : (serverBalance ?? '...')}
            </span>
          </div>
        </div>
      )}

      {AGENT_PRIVATE_KEY && (
        <div style={{
          padding: '4px 10px', borderRadius: 8,
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.15)',
        }}>
          <div style={{ fontSize: '0.5rem', color: 'var(--text-muted)', marginBottom: 1 }}>Agent key (env)</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
            {shortKey(AGENT_PRIVATE_KEY)}
          </div>
        </div>
      )}
    </div>
  );
}
