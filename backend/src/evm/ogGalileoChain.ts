import { defineChain } from 'viem';

const rpc =
  (typeof process !== 'undefined' && process.env.EVM_RPC_URL?.trim()) || 'https://evmrpc-testnet.0g.ai';

/**
 * 0G Galileo Testnet (EVM) — used for `AgentRegistry` reads.
 * @see https://chainscan-galileo.0g.ai
 */
export const ogGalileoTestnet = defineChain({
  id: 16_602,
  name: '0G-Galileo-Testnet',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  rpcUrls: {
    default: { http: [rpc] },
  },
  blockExplorers: {
    default: { name: 'ChainScan', url: 'https://chainscan-galileo.0g.ai' },
  },
});
