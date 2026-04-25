import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { injectedWallet, metaMaskWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { defineChain } from 'viem';

const rpc =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_EVM_RPC_URL?.trim()) ||
  'https://evmrpc-testnet.0g.ai';

/**
 * 0G Galileo Testnet (EVM) — same chain as `contracts` / backend `AgentRegistry`.
 */
export const galileoTestnet = defineChain({
  id: 16_602,
  name: '0G-Galileo-Testnet',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
  blockExplorers: { default: { name: 'ChainScan', url: 'https://chainscan-galileo.0g.ai' } },
});

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || '00000000000000000000000000000000';

/**
 * Only injected + MetaMask + WalletConnect — avoids Coinbase / Base account connectors (extra deps / SSR issues).
 */
export const wagmiConfig = getDefaultConfig({
  appName: 'mogause',
  projectId,
  chains: [galileoTestnet],
  ssr: true,
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [injectedWallet, metaMaskWallet, walletConnectWallet],
    },
  ],
});
