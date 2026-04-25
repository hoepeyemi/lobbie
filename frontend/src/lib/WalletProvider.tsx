'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, useAccount, useDisconnect } from 'wagmi';
import { useConnectModal, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './wagmiConfig';

export interface WalletContextType {
  address: string | null;
  connect: () => void;
  disconnect: () => void;
  /**
   * Stellar / legacy — not used on EVM. Keep for call sites; prefer wagmi + viem for txs.
   */
  signTransaction: (transactionXdr: string) => Promise<string>;
  isConnected: boolean;
  chainId: number | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

function WalletStateBridge({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const connect = useCallback(() => {
    openConnectModal?.();
  }, [openConnectModal]);

  const signTransaction = useCallback(async (_transactionXdr: string) => {
    throw new Error(
      'EVM mode: Stellar XDR signing is not available. Use wagmi (useWalletClient, useSendTransaction) or viem with the connected account.',
    );
  }, []);

  const value: WalletContextType = {
    address: address ?? null,
    connect,
    disconnect: () => disconnect(),
    signTransaction,
    isConnected: Boolean(isConnected && address),
    chainId: chainId ?? null,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false },
        },
      }),
  );

  if (process.env.NODE_ENV === 'development' && !process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()) {
    // eslint-disable-next-line no-console
    console.warn(
      '[mogause] Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env (https://cloud.walletconnect.com) for WalletConnect. Browser wallets may still work.',
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#FF854B',
            accentColorForeground: 'white',
            borderRadius: 'small',
            fontStack: 'system',
          })}
        >
          <WalletStateBridge>{children}</WalletStateBridge>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
};
