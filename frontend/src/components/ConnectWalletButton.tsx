'use client';

import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';

/**
 * RainbowKit + wagmi + viem — includes WalletConnect and injected wallets (MetaMask, etc.) on 0G-Galileo-Testnet.
 */
export default function ConnectWalletButton() {
  return (
    <ConnectButton
      showBalance={false}
      chainStatus="icon"
      accountStatus={{
        smallScreen: 'avatar',
        largeScreen: 'full',
      }}
    />
  );
}
