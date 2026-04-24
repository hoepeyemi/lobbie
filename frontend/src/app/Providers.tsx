'use client';

import React from 'react';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WalletProvider } from '@/lib/WalletProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <LanguageProvider>
        {children}
      </LanguageProvider>
    </WalletProvider>
  );
}
