'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { SwkAppDarkTheme } from "@creit.tech/stellar-wallets-kit/types";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { KitEventType, Networks } from "@creit.tech/stellar-wallets-kit/types";
import * as StellarSdk from "@stellar/stellar-sdk";

interface WalletContextType {
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (transactionXdr: string) => Promise<string>;
  isConnected: boolean;
}
export type { WalletContextType };
const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Initialize the kit on mount (client-side only)
    const initializeKit = async () => {
      try {
        // Initialize StellarWalletsKit
        StellarWalletsKit.init({
          theme: SwkAppDarkTheme,
          modules: defaultModules(),
          network: Networks.TESTNET,
        });

        // Try to restore previous connection
        try {
          const { address: savedAddress } = await StellarWalletsKit.getAddress();
          if (savedAddress) {
            setAddress(savedAddress);
          }
        } catch {
          // No previous connection, that's fine
        }

        // Listen for address changes
        const unsubscribe = StellarWalletsKit.on(
          KitEventType.STATE_UPDATED,
          (event: any) => {
            if (event.payload?.address) {
              setAddress(event.payload.address);
            }
          }
        );

        // Listen for disconnects
        const unsubscribeDisconnect = StellarWalletsKit.on(
          KitEventType.DISCONNECT,
          () => {
            setAddress(null);
          }
        );

        setMounted(true);

        return () => {
          unsubscribe();
          unsubscribeDisconnect();
        };
      } catch (error) {
        console.error("Failed to initialize StellarWalletsKit:", error);
        setMounted(true);
      }
    };

    initializeKit();
  }, []);

  const connect = useCallback(async () => {
    try {
      const { address } = await StellarWalletsKit.authModal();
      setAddress(address);
    } catch (error) {
      console.error("Connection failed:", error);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    try {
      StellarWalletsKit.disconnect();
    } catch (error) {
      console.error("Disconnect failed:", error);
    }
  }, []);

  const signTransaction = useCallback(async (transactionXdr: string): Promise<string> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    try {
      const result = await StellarWalletsKit.signTransaction(transactionXdr, {
        address,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      });
      
      // Handle both string and object return types
      if (typeof result === 'string') {
        return result;
      }
      // If result is an object, extract the signedTxXdr property
      if (result && typeof result === 'object' && 'signedTxXdr' in result) {
        return (result as { signedTxXdr: string }).signedTxXdr;
      }
      // Fallback: return empty string if no valid result
      return '';
    } catch (error) {
      console.error("Transaction signing failed:", error);
      throw error;
    }
  }, [address]);

  return (
    <WalletContext.Provider value={{ 
      address, 
      connect, 
      disconnect,
      signTransaction,
      isConnected: !!address 
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
};
