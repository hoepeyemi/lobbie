import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { injectedWallet, metaMaskWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { defineChain } from 'viem';

const rpc =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_EVM_RPC_URL?.trim()) ||
  'https://evmrpc-testnet.0g.ai';
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || '16602');
const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME?.trim() || '0G-Galileo-Testnet';
const explorerUrl =
  process.env.NEXT_PUBLIC_BLOCK_EXPLORER?.trim() || 'https://chainscan-galileo.0g.ai';

/**
 * 0G Galileo Testnet (EVM) — same chain as `contracts` / backend `AgentRegistry`.
 */
export const galileoTestnet = defineChain({
  id: chainId,
  name: networkName,
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  rpcUrls: {
    default: { http: [rpc] },
    public: { http: [rpc] },
  },
  blockExplorers: { default: { name: 'ChainScan', url: explorerUrl } },
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
