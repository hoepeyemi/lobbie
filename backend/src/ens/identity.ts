/**
 * ENS resolution for agent identity: forward + reverse + text records.
 * @see https://docs.ens.domains
 */
import { createHash } from 'node:crypto';
import { createPublicClient, http, isAddress, type Address, type PublicClient } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { namehash, normalize } from 'viem/ens';
import { privateKeyToAccount } from 'viem/accounts';

function ensDisabled(): boolean {
  return process.env.ENS_DISABLED === 'true';
}

function ensRpcUrl(): string {
  return (
    process.env.ENS_ETH_RPC_URL?.trim() ||
    process.env.ETH_MAINNET_RPC_URL?.trim() ||
    'https://eth.llamarpc.com'
  );
}

function ensNetworkRaw(): string {
  return (process.env.ENS_NETWORK || '').trim().toLowerCase();
}

function ensCacheTtlMs(): number {
  return Math.max(10_000, Number.parseInt(process.env.ENS_CACHE_TTL_MS || '300000', 10) || 300_000);
}

/** viem’s sentinel so Universal Resolver keeps using bundled CCIP/batch handling alongside HTTPS gateways. @see viem localBatchGatewayUrl */
const VIEM_LOCAL_BATCH_GATEWAY_URL = 'x-batch-gateway:true' as const;

/** Comma-separated HTTPS CCIP / gateway base URLs for Universal Resolver `resolveWithGateways` (EIP-3668). */
function parseEnsCcipGatewayUrlsFromEnv(): string[] {
  const raw = process.env.ENS_CCIP_GATEWAY_URLS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** When true (default), prepend viem’s batch sentinel so pure ENS resolution still works alongside custom gateways. Set false only if you intentionally replace all gateway behavior. */
export function ensCcipMergeViemDefaultGateway(): boolean {
  return process.env.ENS_CCIP_MERGE_VIEM_DEFAULT !== 'false';
}

function ensCcipSessionQueryParamName(): string {
  const q = (process.env.ENS_CCIP_SESSION_QUERY_PARAM || 'lobbieSession').trim();
  return q || 'lobbieSession';
}

/** `plain` sends raw sessionKey to gateways; `sha256` sends HMAC-like digest so gateways never see the raw client id on the wire (gateways must derive the same bucket server-side). */
function ensCcipSessionRoutingMode(): 'plain' | 'sha256' {
  const m = (process.env.ENS_CCIP_SESSION_ROUTING_MODE || 'plain').trim().toLowerCase();
  if (m === 'sha256' || m === 'opaque-sha256') return 'sha256';
  return 'plain';
}

/**
 * Value placed on gateway URLs as `ENS_CCIP_SESSION_QUERY_PARAM` for routing / rotation buckets.
 * In `sha256` mode uses SHA-256(salt NUL rawSessionKey) when salt set, else SHA-256(rawSessionKey).
 */
export function deriveEnsCcipRoutingParam(rawSessionKey: string): string {
  const trimmed = rawSessionKey.trim();
  if (!trimmed) return '';
  if (ensCcipSessionRoutingMode() !== 'sha256') return trimmed;
  const salt = process.env.ENS_CCIP_SESSION_SALT?.trim() ?? '';
  const input = salt ? `${salt}\x00${trimmed}` : trimmed;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Stable cache segment for a client session key (changes when routing mode or derivation changes). */
export function ensResolutionSessionCacheKey(rawSessionKey?: string): string {
  const raw = rawSessionKey?.trim();
  if (!raw) return '';
  return `${ensCcipSessionRoutingMode()}:${deriveEnsCcipRoutingParam(raw)}`;
}

function appendEnsCcipSessionToGatewayUrl(gatewayUrl: string, rawSessionKey: string): string {
  const paramValue = deriveEnsCcipRoutingParam(rawSessionKey);
  if (!paramValue) return gatewayUrl;
  try {
    const u = new URL(gatewayUrl);
    u.searchParams.set(ensCcipSessionQueryParamName(), paramValue);
    return u.href;
  } catch {
    return gatewayUrl;
  }
}

/**
 * Gateway URL list for viem ENS actions (`gatewayUrls` on `getEnsAddress`, `getEnsText`, `getEnsName`).
 * When unset, returns `undefined` so viem uses its default batch gateway only.
 * With custom URLs: prepends viem batch sentinel by default so resolution does not depend solely on external gateways.
 * With `sessionKey`, appends derived routing param to each HTTPS gateway URL (not to the sentinel).
 */
export function getEnsGatewayUrlsForRead(sessionKey?: string): string[] | undefined {
  const customHttps = parseEnsCcipGatewayUrlsFromEnv();
  if (customHttps.length === 0) return undefined;

  const mergeSentinel = ensCcipMergeViemDefaultGateway();
  const sk = sessionKey?.trim();
  const httpsPart = sk ? customHttps.map(b => appendEnsCcipSessionToGatewayUrl(b, sk)) : [...customHttps];

  if (!mergeSentinel) return httpsPart;
  return [VIEM_LOCAL_BATCH_GATEWAY_URL, ...httpsPart];
}

/** True when `ENS_CCIP_GATEWAY_URLS` lists at least one HTTPS gateway. */
export function ensCcipGatewaysConfigured(): boolean {
  return parseEnsCcipGatewayUrlsFromEnv().length > 0;
}

export function getEnsCcipConfigSnapshot(): {
  gatewayUrlCount: number;
  sessionQueryParam: string;
  mergeViemDefaultGateway: boolean;
  sessionRoutingMode: 'plain' | 'sha256';
  sessionSaltConfigured: boolean;
  exposeRawSessionKeyInResponses: boolean;
} {
  return {
    gatewayUrlCount: parseEnsCcipGatewayUrlsFromEnv().length,
    sessionQueryParam: ensCcipSessionQueryParamName(),
    mergeViemDefaultGateway: ensCcipMergeViemDefaultGateway(),
    sessionRoutingMode: ensCcipSessionRoutingMode(),
    sessionSaltConfigured: Boolean(process.env.ENS_CCIP_SESSION_SALT?.trim()),
    exposeRawSessionKeyInResponses: ensCcipExposeRawSessionKeyInApi(),
  };
}

/**
 * Whether HTTP JSON may echo the raw client `sessionKey`.
 * Default: only in `plain` routing mode. Override with ENS_CCIP_EXPOSE_RAW_SESSION_KEY=true|false.
 */
export function ensCcipExposeRawSessionKeyInApi(): boolean {
  const e = process.env.ENS_CCIP_EXPOSE_RAW_SESSION_KEY?.trim().toLowerCase();
  if (e === 'true') return true;
  if (e === 'false') return false;
  return ensCcipSessionRoutingMode() === 'plain';
}

export type EnsSanitizedSessionApi = {
  sessionKey: string | null;
  /** True when raw key is withheld from JSON (sha256 mode default, or EXPOSE=false). */
  sessionKeyRedacted: boolean;
  /** Routing bucket value sent to HTTPS gateways (deriveEnsCcipRoutingParam); safe to expose vs raw when opaque. */
  gatewayRoutingValue: string | null;
};

/** Strip raw session from outward JSON when policy requires; always exposes gateway routing bucket for debugging alignment. */
export function sanitizeEnsSessionForApiResponse(rawSessionKey?: string | null): EnsSanitizedSessionApi {
  const raw = rawSessionKey?.trim();
  if (!raw) {
    return { sessionKey: null, sessionKeyRedacted: false, gatewayRoutingValue: null };
  }
  const gw = deriveEnsCcipRoutingParam(raw);
  if (ensCcipExposeRawSessionKeyInApi()) {
    return { sessionKey: raw, sessionKeyRedacted: false, gatewayRoutingValue: gw };
  }
  return { sessionKey: null, sessionKeyRedacted: true, gatewayRoutingValue: gw };
}

/** Non-secret preview for operators aligning gateways with Lobbie’s routing derivation. */
export function previewEnsCcipSessionRouting(rawSessionKey: string): {
  routingMode: 'plain' | 'sha256';
  gatewayQueryParamName: string;
  gatewayQueryParamValue: string;
  cacheKeySegment: string;
} | null {
  const trimmed = rawSessionKey.trim();
  if (!trimmed) return null;
  return {
    routingMode: ensCcipSessionRoutingMode(),
    gatewayQueryParamName: ensCcipSessionQueryParamName(),
    gatewayQueryParamValue: deriveEnsCcipRoutingParam(trimmed),
    cacheKeySegment: ensResolutionSessionCacheKey(trimmed),
  };
}

function ensGatewayOpts(sessionKey?: string): { gatewayUrls?: string[] } {
  const urls = getEnsGatewayUrlsForRead(sessionKey);
  return urls ? { gatewayUrls: urls } : {};
}

/** Canonical agent name → forward-resolve and compare with compute/settlement wallet */
function ensAgentNameRaw(): string {
  return process.env.ENS_AGENT_NAME?.trim() || '';
}
const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;
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
let ensClientKey = '';

function getEnsChain() {
  const ENS_NETWORK_RAW = ensNetworkRaw();
  const ENS_ETH_RPC_URL = ensRpcUrl();
  if (ENS_NETWORK_RAW === 'testnet') return sepolia;
  if (ENS_NETWORK_RAW === 'sepolia') return sepolia;
  if (ENS_NETWORK_RAW === 'mainnet') return mainnet;
  // Auto-detect from RPC URL for convenience.
  return ENS_ETH_RPC_URL.toLowerCase().includes('sepolia') ? sepolia : mainnet;
}

export function ensResolutionEnabled(): boolean {
  return !ensDisabled();
}

export function getEnsEthClient(): PublicClient {
  const chain = getEnsChain();
  const rpc = ensRpcUrl();
  const key = `${chain.id}:${rpc}`;
  if (!ensClient || ensClientKey !== key) {
    const chain = getEnsChain();
    ensClient = createPublicClient({
      chain,
      transport: http(rpc),
    });
    ensClientKey = key;
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

/** SLIP-44 multicoin type for Ethereum mainnet (`addr(bytes32)` / default `getEnsAddress`). */
export const ENS_ETHEREUM_MAINNET_COIN_TYPE = 60;

/**
 * ENS multicoin coin type for an EVM `chainId` (ENSIP-11 / EIP-2304).
 * Mainnet (1) uses SLIP-44 type 60; other chains use `0x80000000 | chainId`.
 * Custom resolvers may still return policy-based or rotating addresses for that coin type.
 */
export function evmChainIdToEnsCoinType(chainId: number): number {
  if (!Number.isFinite(chainId) || chainId < 0) return ENS_ETHEREUM_MAINNET_COIN_TYPE;
  if (chainId === 1) return ENS_ETHEREUM_MAINNET_COIN_TYPE;
  return (0x80000000 | chainId) >>> 0;
}

export type ForwardResolveEnsOptions = {
  /** Multicoin SLIP-44 / ENSIP-11 coin type. Omit to use the default Ethereum record. */
  coinType?: number;
  /**
   * Session bucket forwarded to HTTPS gateways as `ENS_CCIP_SESSION_QUERY_PARAM`.
   * When `ENS_CCIP_SESSION_ROUTING_MODE=sha256`, gateways receive SHA-256(salt NUL key) instead of raw (unlinkability from gateways).
   * Sentinel batch gateway (`x-batch-gateway:true`) is unchanged by rotation semantics.
   */
  sessionKey?: string;
};

/** Forward resolve a name to an address (default ETH record, or multicoin `addr(node, coinType)` when set). */
export async function forwardResolveEnsName(
  nameInput: string,
  options?: ForwardResolveEnsOptions,
): Promise<Address | null> {
  if (!ensResolutionEnabled()) return null;
  const name = normalizeEnsName(nameInput);
  if (!name) return null;

  const coinType = options?.coinType;
  const ck = `forward:${name}:${coinType ?? 'default'}:${ensResolutionSessionCacheKey(options?.sessionKey)}`;
  const hit = cacheGet<Address | null>(ck);
  if (hit !== undefined) return hit;

  const client = getEnsEthClient();
  const gw = ensGatewayOpts(options?.sessionKey);
  let addr: Address | null = null;
  try {
    const a =
      coinType !== undefined
        ? await client.getEnsAddress({ name, coinType: BigInt(coinType), ...gw })
        : await client.getEnsAddress({ name, ...gw });
    addr = a && isAddress(a) ? a : null;
  } catch {
    addr = null;
  }
  cacheSet(ck, addr, ensCacheTtlMs());
  return addr;
}

export type ReverseEnsResult = {
  /** Primary name from reverse registrar (viem verifies forward resolution). */
  ensName: string | null;
};

/**
 * Reverse lookup for logs/UI. Prefer showing `ensName` when set; falls back to truncated hex elsewhere.
 */
export async function reverseResolveAddress(
  address: Address,
  options?: Pick<ForwardResolveEnsOptions, 'sessionKey'>,
): Promise<ReverseEnsResult> {
  if (!ensResolutionEnabled()) return { ensName: null };
  if (!isAddress(address)) return { ensName: null };

  const lower = address.toLowerCase() as Address;
  const ck = `reverse:${lower}:${ensResolutionSessionCacheKey(options?.sessionKey)}`;
  const hit = cacheGet<string | null>(ck);
  if (hit !== undefined) return { ensName: hit };

  const gw = ensGatewayOpts(options?.sessionKey);
  let ensName: string | null = null;
  try {
    ensName = await getEnsEthClient().getEnsName({ address, ...gw });
  } catch {
    ensName = null;
  }
  cacheSet(ck, ensName, ensCacheTtlMs());
  return { ensName };
}

export const ENS_AGENT_TEXT_KEYS = [
  'description',
  'url',
  'avatar',
  'com.lobbie.agent-v1',
  /** HTTPS base URL for agent HTTP/A2A APIs (preferred over generic `url` for machines). */
  'com.lobbie.agent-endpoint',
  /** Optional delegate signer — typically `0x…` EVM address; opaque URIs are surfaced but not used for EIP-191 checks. */
  'com.lobbie.agent-delegate',
  'vnd.lobbie.vc-jwt',
  'vnd.lobbie.attestation-hash',
] as const;

export type EnsAgentProfile = {
  name: string;
  resolvedAddress: Address | null;
  text: Partial<Record<(typeof ENS_AGENT_TEXT_KEYS)[number], string>>;
  lobbieAgentJson: Record<string, unknown> | null;
  verifiableHooks: {
    vcJwtRef: string | null;
    attestationHash: string | null;
  };
};

export type ResolvedAddressProfile = {
  address: Address;
  ensName: string | null;
  profile: EnsAgentProfile | null;
};

/** Text records + optional JSON in `com.lobbie.agent-v1` for machine-readable agent metadata. */
export async function fetchEnsAgentProfile(
  nameInput: string,
  options?: ForwardResolveEnsOptions,
): Promise<EnsAgentProfile | null> {
  if (!ensResolutionEnabled()) return null;
  const name = normalizeEnsName(nameInput);
  if (!name) return null;

  const coinType = options?.coinType;
  const ck = `profile:${name}:${coinType ?? 'default'}:${ensResolutionSessionCacheKey(options?.sessionKey)}`;
  const hit = cacheGet<EnsAgentProfile>(ck);
  if (hit) return hit;

  const client = getEnsEthClient();
  const gw = ensGatewayOpts(options?.sessionKey);
  let resolvedAddress: Address | null = null;
  try {
    const a =
      coinType !== undefined
        ? await client.getEnsAddress({ name, coinType: BigInt(coinType), ...gw })
        : await client.getEnsAddress({ name, ...gw });
    resolvedAddress = a && isAddress(a) ? a : null;
  } catch {
    resolvedAddress = null;
  }

  const text: EnsAgentProfile['text'] = {};
  await Promise.all(
    ENS_AGENT_TEXT_KEYS.map(async key => {
      try {
        const v = await client.getEnsText({ name, key, ...gw });
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
    verifiableHooks: {
      vcJwtRef: text['vnd.lobbie.vc-jwt'] || null,
      attestationHash: text['vnd.lobbie.attestation-hash'] || null,
    },
  };
  cacheSet(ck, profile, ensCacheTtlMs());
  return profile;
}

/** Discovery bundle for agent-to-agent coordination (reads ENS only — no central registry). */
export type EnsAgentCoordination = {
  name: string;
  resolvedAddress: Address | null;
  /** Preferred machine-facing HTTP(S) base URL for this agent’s APIs. */
  serviceEndpoint: string | null;
  /** Human-facing URL from ENS `url` text record (often overlaps with service endpoint). */
  url: string | null;
  /** Delegate identity — usually same-chain signer address as `0x…`; may be DID or other URI. */
  delegate: string | null;
  lobbieAgentJson: Record<string, unknown> | null;
};

function pickFirstHttpUrl(...candidates: (string | undefined | null)[]): string | null {
  for (const raw of candidates) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Resolve `.eth` text records for peer discovery: service endpoint, delegate, `url`.
 * Endpoint precedence: `com.lobbie.agent-endpoint` → keys inside `com.lobbie.agent-v1` JSON → `url`.
 */
export async function resolveEnsAgentCoordination(
  nameInput: string,
  options?: ForwardResolveEnsOptions,
): Promise<EnsAgentCoordination | null> {
  const profile = await fetchEnsAgentProfile(nameInput, options);
  if (!profile) return null;

  const j = profile.lobbieAgentJson;
  const serviceEndpoint = pickFirstHttpUrl(
    profile.text['com.lobbie.agent-endpoint'],
    typeof j?.serviceEndpoint === 'string' ? j.serviceEndpoint : undefined,
    typeof j?.endpoint === 'string' ? j.endpoint : undefined,
    typeof j?.a2aEndpoint === 'string' ? j.a2aEndpoint : undefined,
    typeof j?.a2aUrl === 'string' ? j.a2aUrl : undefined,
    typeof j?.baseUrl === 'string' ? j.baseUrl : undefined,
    profile.text.url,
  );

  const delegateRaw =
    profile.text['com.lobbie.agent-delegate']?.trim() ||
    (typeof j?.delegate === 'string' ? j.delegate.trim() : '') ||
    (typeof j?.authorizedSigner === 'string' ? j.authorizedSigner.trim() : '') ||
    '';
  const delegate = delegateRaw || null;

  const urlOnly = profile.text.url?.trim();
  const url = pickFirstHttpUrl(urlOnly) || (urlOnly ? urlOnly : null);

  return {
    name: profile.name,
    resolvedAddress: profile.resolvedAddress,
    serviceEndpoint,
    url,
    delegate,
    lobbieAgentJson: profile.lobbieAgentJson,
  };
}

/** Addresses this server will accept as “peer identity” for EIP-191 verification (forward addr + optional EVM delegate). */
export function ensCoordinationTrustedAddresses(coord: EnsAgentCoordination): Address[] {
  const out: Address[] = [];
  if (coord.resolvedAddress && isAddress(coord.resolvedAddress)) out.push(coord.resolvedAddress);
  const d = coord.delegate?.trim();
  if (d && isAddress(d)) out.push(d as Address);
  return out;
}

/** Reverse lookup + text records in one call for agent cards/registry enrichment. */
export async function resolveAddressProfile(
  address: Address,
  options?: Pick<ForwardResolveEnsOptions, 'sessionKey'>,
): Promise<ResolvedAddressProfile> {
  const { ensName } = await reverseResolveAddress(address, options);
  const profile = ensName ? await fetchEnsAgentProfile(ensName, options) : null;
  return {
    address,
    ensName,
    profile,
  };
}

export async function getEnsNameOwner(nameInput: string): Promise<Address | null> {
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
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: 'owner',
      args: [node],
    });
    owner = out && isAddress(out) ? (out as Address) : null;
  } catch {
    owner = null;
  }
  cacheSet(ck, owner, ensCacheTtlMs());
  return owner;
}

export async function getEnsTextRecord(
  nameInput: string,
  key: string,
  options?: Pick<ForwardResolveEnsOptions, 'sessionKey'>,
): Promise<string | null> {
  if (!ensResolutionEnabled()) return null;
  const name = normalizeEnsName(nameInput);
  if (!name || !key.trim()) return null;
  const cacheKey = `text:${name}:${key}:${ensResolutionSessionCacheKey(options?.sessionKey)}`;
  const hit = cacheGet<string | null>(cacheKey);
  if (hit !== undefined) return hit;
  const gw = ensGatewayOpts(options?.sessionKey);
  let value: string | null = null;
  try {
    value = await getEnsEthClient().getEnsText({ name, key: key.trim(), ...gw });
  } catch {
    value = null;
  }
  cacheSet(cacheKey, value, ensCacheTtlMs());
  return value;
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

export type EnsAdminAccessCheck = {
  adminName: string;
  walletAddress: Address;
  ownerAddress: Address | null;
  resolvedAddress: Address | null;
  allowlistTextKey: string;
  allowlistValue: string | null;
  allowlistAddresses: Address[];
  passes: boolean;
  reason:
    | 'owner-match'
    | 'resolver-match'
    | 'allowlist-match'
    | 'allowlist-merkle-unsupported'
    | 'no-match'
    | 'invalid-admin-name';
};

export async function checkEnsAdminAccess(input: {
  adminName: string;
  walletAddress: Address;
  allowlistTextKey?: string;
}): Promise<EnsAdminAccessCheck> {
  const normalizedName = normalizeEnsName(input.adminName);
  const key = (input.allowlistTextKey || 'com.lobbie.allowlist').trim();
  if (!normalizedName) {
    return {
      adminName: input.adminName,
      walletAddress: input.walletAddress,
      ownerAddress: null,
      resolvedAddress: null,
      allowlistTextKey: key,
      allowlistValue: null,
      allowlistAddresses: [],
      passes: false,
      reason: 'invalid-admin-name',
    };
  }

  const [ownerAddress, resolvedAddress, allowlistValue] = await Promise.all([
    getEnsNameOwner(normalizedName),
    forwardResolveEnsName(normalizedName),
    getEnsTextRecord(normalizedName, key),
  ]);

  const walletLower = input.walletAddress.toLowerCase();
  if (ownerAddress && ownerAddress.toLowerCase() === walletLower) {
    return {
      adminName: normalizedName,
      walletAddress: input.walletAddress,
      ownerAddress,
      resolvedAddress,
      allowlistTextKey: key,
      allowlistValue,
      allowlistAddresses: [],
      passes: true,
      reason: 'owner-match',
    };
  }
  if (resolvedAddress && resolvedAddress.toLowerCase() === walletLower) {
    return {
      adminName: normalizedName,
      walletAddress: input.walletAddress,
      ownerAddress,
      resolvedAddress,
      allowlistTextKey: key,
      allowlistValue,
      allowlistAddresses: [],
      passes: true,
      reason: 'resolver-match',
    };
  }

  const raw = (allowlistValue || '').trim();
  if (raw) {
    if (/^(merkle:)?0x[0-9a-fA-F]{64}$/.test(raw)) {
      return {
        adminName: normalizedName,
        walletAddress: input.walletAddress,
        ownerAddress,
        resolvedAddress,
        allowlistTextKey: key,
        allowlistValue,
        allowlistAddresses: [],
        passes: false,
        reason: 'allowlist-merkle-unsupported',
      };
    }
    const allowlistAddresses = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter((a): a is Address => isAddress(a));
    if (allowlistAddresses.some(a => a.toLowerCase() === walletLower)) {
      return {
        adminName: normalizedName,
        walletAddress: input.walletAddress,
        ownerAddress,
        resolvedAddress,
        allowlistTextKey: key,
        allowlistValue,
        allowlistAddresses,
        passes: true,
        reason: 'allowlist-match',
      };
    }
    return {
      adminName: normalizedName,
      walletAddress: input.walletAddress,
      ownerAddress,
      resolvedAddress,
      allowlistTextKey: key,
      allowlistValue,
      allowlistAddresses,
      passes: false,
      reason: 'no-match',
    };
  }

  return {
    adminName: normalizedName,
    walletAddress: input.walletAddress,
    ownerAddress,
    resolvedAddress,
    allowlistTextKey: key,
    allowlistValue,
    allowlistAddresses: [],
    passes: false,
    reason: 'no-match',
  };
}

/** When `ENS_AGENT_NAME` is set: resolve forward + profile + compare with env-derived wallet. */
export async function getConfiguredAgentEnsSummary(): Promise<ConfiguredAgentEnsSummary | null> {
  const ENS_AGENT_NAME_RAW = ensAgentNameRaw();
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
