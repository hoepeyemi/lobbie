import { createPublicClient, formatEther, http, isAddress, type Address, type PublicClient } from 'viem';
import { agentRegistryAbi } from './agentRegistryAbi.js';
import { ogGalileoTestnet } from './ogGalileoChain.js';

export type OnChainRegistryAgent = {
  kind: 'evm';
  address: Address;
  name: string;
  endpoint: string;
  priceWei: string;
  price0G: string;
  category: string;
  /** Contract stores 0–10_000 (basis). */
  reputationBps: number;
  /** 0–100 for UI parity with in-memory `AgentRegistryEntry.reputation`. */
  reputation: number;
  jobsCompleted: number;
  jobsFailed: number;
  totalEarnedWei: string;
  totalEarned0G: string;
  isActive: boolean;
  registeredAt: string;
  efficiencyScore: number;
};

export type OnChainRegistryPayload = {
  enabled: boolean;
  rpcUrl: string;
  fromBlock: string;
  error?: string;
  agents: OnChainRegistryAgent[];
  syncedAt: string;
};

function makeClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: { ...ogGalileoTestnet, rpcUrls: { default: { http: [rpcUrl] } } },
    transport: http(rpcUrl),
  });
}

const cache: {
  t: number;
  data: OnChainRegistryPayload;
  contract: string;
  rpc: string;
} = {
  t: 0,
  data: {
    enabled: false,
    rpcUrl: '',
    fromBlock: '0',
    agents: [],
    syncedAt: new Date(0).toISOString(),
  },
  contract: '',
  rpc: '',
};

const TTL_MS = 45_000;

function bpsToPercent100(r: number): number {
  return Math.min(100, Math.round(r / 100));
}

function parseFromBlock(): bigint {
  const raw = (process.env.AGENT_REGISTRY_FROM_BLOCK || '0').trim();
  if (raw === '') return 0n;
  if (raw.startsWith('0x') || raw.startsWith('0X')) return BigInt(raw);
  return BigInt(raw);
}

/**
 * Read `AgentRegistered` logs, then `getAgent` + `getEfficiencyScore` per address.
 */
export async function fetchOnChainRegistry(contractAddress: string): Promise<OnChainRegistryPayload> {
  const rpcUrl = (process.env.EVM_RPC_URL || '').trim() || 'https://evmrpc-testnet.0g.ai';
  const fromBlock = parseFromBlock();
  const now = Date.now();

  if (cache.contract === contractAddress && cache.rpc === rpcUrl && now - cache.t < TTL_MS) {
    return cache.data;
  }

  if ((process.env.EVM_REGISTRY_SYNC || 'true').toLowerCase() === 'false') {
    return {
      enabled: false,
      rpcUrl,
      fromBlock: fromBlock.toString(),
      error: 'EVM sync disabled (EVM_REGISTRY_SYNC=false)',
      agents: [],
      syncedAt: new Date().toISOString(),
    };
  }

  if (!isAddress(contractAddress)) {
    return {
      enabled: false,
      rpcUrl,
      fromBlock: fromBlock.toString(),
      error: 'CONTRACT_ADDRESS is not a valid EVM address',
      agents: [],
      syncedAt: new Date().toISOString(),
    };
  }

  const address = contractAddress as Address;

  try {
    const client = makeClient(rpcUrl);
    const logs = await client.getContractEvents({
      address,
      abi: agentRegistryAbi,
      eventName: 'AgentRegistered',
      fromBlock,
      toBlock: 'latest',
    });

    const addrs = new Set<Address>();
    for (const log of logs) {
      const raw = (log as { args?: { agent?: Address } | readonly Address[] }).args;
      const agent = Array.isArray(raw) ? raw[0] : raw?.agent;
      if (agent && isAddress(agent)) addrs.add(agent);
    }

    if (addrs.size === 0) {
      const empty: OnChainRegistryPayload = {
        enabled: true,
        rpcUrl,
        fromBlock: fromBlock.toString(),
        agents: [],
        syncedAt: new Date().toISOString(),
      };
      cache.t = now;
      cache.data = empty;
      cache.contract = contractAddress;
      cache.rpc = rpcUrl;
      return empty;
    }

    const list = Array.from(addrs);
    const rows = await Promise.all(
      list.map(async (addr) => {
        const g = (await client.readContract({
          address,
          abi: agentRegistryAbi,
          functionName: 'getAgent',
          args: [addr],
        })) as readonly [
          string,
          string,
          bigint,
          string,
          number,
          number,
          number,
          bigint,
          boolean,
          bigint,
        ];
        const [
          name,
          endpoint,
          priceWei,
          category,
          reputation,
          jobsCompleted,
          jobsFailed,
          totalEarned,
          isActive,
          registeredAt,
        ] = g;
        const effRaw = await client
          .readContract({
            address,
            abi: agentRegistryAbi,
            functionName: 'getEfficiencyScore',
            args: [addr],
          })
          .catch(() => 0n);
        const eff = typeof effRaw === 'bigint' ? Number(effRaw) : Number(effRaw);
        return {
          addr,
          name,
          endpoint,
          priceWei,
          category,
          reputation,
          jobsCompleted,
          jobsFailed,
          totalEarned,
          isActive,
          registeredAt,
          eff: eff || 0,
        };
      }),
    );

    const agents: OnChainRegistryAgent[] = [];
    for (const r of rows) {
      const repBps = Number(r.reputation);
      agents.push({
        kind: 'evm',
        address: r.addr,
        name: r.name,
        endpoint: r.endpoint,
        priceWei: r.priceWei.toString(),
        price0G: formatEther(r.priceWei),
        category: r.category,
        reputationBps: repBps,
        reputation: bpsToPercent100(repBps),
        jobsCompleted: Number(r.jobsCompleted),
        jobsFailed: Number(r.jobsFailed),
        totalEarnedWei: r.totalEarned.toString(),
        totalEarned0G: formatEther(r.totalEarned),
        isActive: r.isActive,
        registeredAt: new Date(Number(r.registeredAt) * 1000).toISOString(),
        efficiencyScore: r.eff,
      });
    }

    const payload: OnChainRegistryPayload = {
      enabled: true,
      rpcUrl,
      fromBlock: fromBlock.toString(),
      agents: agents.sort((a, b) => b.reputationBps - a.reputationBps),
      syncedAt: new Date().toISOString(),
    };
    cache.t = now;
    cache.data = payload;
    cache.contract = contractAddress;
    cache.rpc = rpcUrl;
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      enabled: true,
      rpcUrl,
      fromBlock: fromBlock.toString(),
      error: message,
      agents: [],
      syncedAt: new Date().toISOString(),
    };
  }
}
