/**
 * ENS resolution (Ethereum L1) for agent identity: forward + reverse + text records.
 * @see https://docs.ens.domains — always use a mainnet RPC; 0G agent keys are EVM addresses.
 */
import { createPublicClient, http, isAddress, type Address, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { namehash, normalize } from 'viem/ens';
import { privateKeyToAccount } from 'viem/accounts';

const ENS_DISABLED = process.env.ENS_DISABLED === 'true';
const ENS_ETH_RPC_URL =
  process.env.ENS_ETH_RPC_URL?.trim() ||
  process.env.ETH_MAINNET_RPC_URL?.trim() ||
  'https://eth.llamarpc.com';

const ENS_CACHE_TTL_MS = Math.max(
  10_000,
  Number.parseInt(process.env.ENS_CACHE_TTL_MS || '300000', 10) || 300_000,
);

/** Canonical agent name → forward-resolve and compare with compute/settlement wallet */
const ENS_AGENT_NAME_RAW = process.env.ENS_AGENT_NAME?.trim();
const ENS_REGISTRY_MAINNET = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;
const ensRegistryAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const e = cache.get(key);
  if (!e || e.expiresAt <= Date.now()) return undefined;
  return e.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

let ensClient: PublicClient | null = null;

export function ensResolutionEnabled(): boolean {
  return !ENS_DISABLED;
}

export function getEnsEthClient(): PublicClient {
  if (!ensClient) {
    ensClient = createPublicClient({
      chain: mainnet,
      transport: http(ENS_ETH_RPC_URL),
    });
  }
  return ensClient;
}

function parseEvmPrivateKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const h = s.startsWith('0x') ? s : `0x${s}`;
  return /^0x[0-9a-fA-F]{64}$/.test(h) ? (h as `0x${string}`) : null;
}

/** Wallet derived from env keys used for 0G compute / settlement (same convention as index.ts). */
export function deriveAgentWalletAddressFromEnv(): Address | null {
  const pk = parseEvmPrivateKey(
    process.env.ZG_COMPUTE_PRIVATE_KEY ||
      process.env.EVM_SETTLEMENT_PRIVATE_KEY ||
      process.env.AGENT_EVM_PRIVATE_KEY ||
      process.env.AGENT_PRIVATE_KEY,
  );
  if (!pk) return null;
  return privateKeyToAccount(pk).address;
}

/** Normalize ENS label for viem `getEnsAddress` / text record reads. Returns null if invalid. */
export function normalizeEnsName(input: string): string | null {
  const t = input.trim();
  if (!t.includes('.')) return null;
  try {
    return normalize(t);
  } catch {
    return null;
  }
}

/** Forward resolve a name to the default Ethereum address record (same address many EVM chains reuse). */
export async function forwardResolveEnsName(nameInput: string): Promise<Address | null> {
  if (!ensResolutionEnabled()) return null;
  const name = normalizeEnsName(nameInput);
  if (!name) return null;

  const ck = `forward:${name}`;
  const hit = cacheGet<Address | null>(ck);
  if (hit !== undefined) return hit;

  const client = getEnsEthClient();
  let addr: Address | null = null;
  try {
    const a = await client.getEnsAddress({ name });
    addr = a && isAddress(a) ? a : null;
  } catch {
    addr = null;
  }
  cacheSet(ck, addr, ENS_CACHE_TTL_MS);
  return addr;
}

export type ReverseEnsResult = {
  /** Primary name from reverse registrar (viem verifies forward resolution). */
  ensName: string | null;
};

/**
 * Reverse lookup for logs/UI. Prefer showing `ensName` when set; falls back to truncated hex elsewhere.
 */
export async function reverseResolveAddress(address: Address): Promise<ReverseEnsResult> {
  if (!ensResolutionEnabled()) return { ensName: null };
  if (!isAddress(address)) return { ensName: null };

  const lower = address.toLowerCase() as Address;
  const ck = `reverse:${lower}`;
  const hit = cacheGet<string | null>(ck);
  if (hit !== undefined) return { ensName: hit };

  let ensName: string | null = null;
  try {
    ensName = await getEnsEthClient().getEnsName({ address });
  } catch {
    ensName = null;
  }
  cacheSet(ck, ensName, ENS_CACHE_TTL_MS);
  return { ensName };
}

export const ENS_AGENT_TEXT_KEYS = [
  'description',
  'url',
  'avatar',
  'com.lobbie.agent-v1',
] as const;

export type EnsAgentProfile = {
  name: string;
  resolvedAddress: Address | null;
  text: Partial<Record<(typeof ENS_AGENT_TEXT_KEYS)[number], string>>;
  lobbieAgentJson: Record<string, unknown> | null;
};

export type ResolvedAddressProfile = {
  address: Address;
  ensName: string | null;
  profile: EnsAgentProfile | null;
};

/** Text records + optional JSON in `com.lobbie.agent-v1` for machine-readable agent metadata. */
export async function fetchEnsAgentProfile(nameInput: string): Promise<EnsAgentProfile | null> {
  if (!ensResolutionEnabled()) return null;
  const name = normalizeEnsName(nameInput);
  if (!name) return null;

  const ck = `profile:${name}`;
  const hit = cacheGet<EnsAgentProfile>(ck);
  if (hit) return hit;

  const client = getEnsEthClient();
  let resolvedAddress: Address | null = null;
  try {
    const a = await client.getEnsAddress({ name });
    resolvedAddress = a && isAddress(a) ? a : null;
  } catch {
    resolvedAddress = null;
  }

  const text: EnsAgentProfile['text'] = {};
  await Promise.all(
    ENS_AGENT_TEXT_KEYS.map(async key => {
      try {
        const v = await client.getEnsText({ name, key });
        if (v) text[key] = v;
      } catch {
        // missing key
      }
    }),
  );

  let lobbieAgentJson: Record<string, unknown> | null = null;
  const raw = text['com.lobbie.agent-v1'];
  if (raw) {
    try {
      lobbieAgentJson = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      lobbieAgentJson = null;
    }
  }

  const profile: EnsAgentProfile = {
    name,
    resolvedAddress,
    text,
    lobbieAgentJson,
  };
  cacheSet(ck, profile, ENS_CACHE_TTL_MS);
  return profile;
}

/** Reverse lookup + text records in one call for agent cards/registry enrichment. */
export async function resolveAddressProfile(address: Address): Promise<ResolvedAddressProfile> {
  const { ensName } = await reverseResolveAddress(address);
  const profile = ensName ? await fetchEnsAgentProfile(ensName) : null;
  return {
    address,
    ensName,
    profile,
  };
}

async function getEnsNameOwner(nameInput: string): Promise<Address | null> {
  if (!ensResolutionEnabled()) return null;
  const name = normalizeEnsName(nameInput);
  if (!name) return null;
  const ck = `owner:${name}`;
  const hit = cacheGet<Address | null>(ck);
  if (hit !== undefined) return hit;

  let owner: Address | null = null;
  try {
    const node = namehash(name);
    const out = await getEnsEthClient().readContract({
      address: ENS_REGISTRY_MAINNET,
      abi: ensRegistryAbi,
      functionName: 'owner',
      args: [node],
    });
    owner = out && isAddress(out) ? (out as Address) : null;
  } catch {
    owner = null;
  }
  cacheSet(ck, owner, ENS_CACHE_TTL_MS);
  return owner;
}

export type SubnameCapabilityCheck = {
  requiredSubname: string;
  walletAddress: Address;
  subnameOwner: Address | null;
  resolvedAddress: Address | null;
  passes: boolean;
  reason: 'owner-match' | 'resolver-match' | 'no-match' | 'invalid-subname';
};

/**
 * Subname capability token:
 * - Pass if caller wallet owns subname in ENS registry, OR
 * - Pass if subname currently forward-resolves to caller wallet.
 */
export async function checkSubnameCapability(input: {
  requiredSubname: string;
  walletAddress: Address;
}): Promise<SubnameCapabilityCheck> {
  const normalized = normalizeEnsName(input.requiredSubname);
  if (!normalized) {
    return {
      requiredSubname: input.requiredSubname,
      walletAddress: input.walletAddress,
      subnameOwner: null,
      resolvedAddress: null,
      passes: false,
      reason: 'invalid-subname',
    };
  }

  const [subnameOwner, resolvedAddress] = await Promise.all([
    getEnsNameOwner(normalized),
    forwardResolveEnsName(normalized),
  ]);

  const w = input.walletAddress.toLowerCase();
  if (subnameOwner && subnameOwner.toLowerCase() === w) {
    return {
      requiredSubname: normalized,
      walletAddress: input.walletAddress,
      subnameOwner,
      resolvedAddress,
      passes: true,
      reason: 'owner-match',
    };
  }
  if (resolvedAddress && resolvedAddress.toLowerCase() === w) {
    return {
      requiredSubname: normalized,
      walletAddress: input.walletAddress,
      subnameOwner,
      resolvedAddress,
      passes: true,
      reason: 'resolver-match',
    };
  }
  return {
    requiredSubname: normalized,
    walletAddress: input.walletAddress,
    subnameOwner,
    resolvedAddress,
    passes: false,
    reason: 'no-match',
  };
}

export type ConfiguredAgentEnsSummary = {
  configuredName: string;
  resolvedAddress: Address | null;
  walletAddressFromEnv: Address | null;
  addressesMatch: boolean | null;
  profile: EnsAgentProfile | null;
};

/** When `ENS_AGENT_NAME` is set: resolve forward + profile + compare with env-derived wallet. */
export async function getConfiguredAgentEnsSummary(): Promise<ConfiguredAgentEnsSummary | null> {
  if (!ENS_AGENT_NAME_RAW) return null;
  const configuredName = normalizeEnsName(ENS_AGENT_NAME_RAW);
  if (!configuredName) return null;

  const [resolvedAddress, profile] = await Promise.all([
    forwardResolveEnsName(configuredName),
    fetchEnsAgentProfile(configuredName),
  ]);
  const walletAddressFromEnv = deriveAgentWalletAddressFromEnv();

  let addressesMatch: boolean | null = null;
  if (resolvedAddress && walletAddressFromEnv) {
    addressesMatch = resolvedAddress.toLowerCase() === walletAddressFromEnv.toLowerCase();
  }

  return {
    configuredName,
    resolvedAddress,
    walletAddressFromEnv,
    addressesMatch,
    profile,
  };
}
