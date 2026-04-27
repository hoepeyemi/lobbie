import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';

const require = createRequire(import.meta.url);
const {
  createZGComputeNetworkBroker,
  createZGComputeNetworkReadOnlyBroker,
} = require('@0glabs/0g-serving-broker') as {
  createZGComputeNetworkBroker: (...args: any[]) => Promise<any>;
  createZGComputeNetworkReadOnlyBroker: (...args: any[]) => Promise<any>;
};

export type SwarmRole = 'planner' | 'researcher' | 'critic' | 'executor';

export type SwarmStep = {
  role: SwarmRole;
  prompt: string;
  output: string;
  providerAddress: string;
  model: string;
  chatId?: string;
  teeVerified?: boolean | null;
  timestamp: string;
};

export type SwarmSession = {
  id: string;
  query: string;
  createdAt: string;
  updatedAt: string;
  steps: SwarmStep[];
  finalAnswer: string;
};

export type SwarmMemoryEvent = {
  id: string;
  ts: string;
  type:
    | 'session_started'
    | 'step_completed'
    | 'session_completed'
    | 'root_published'
    | 'pointer_updated'
    | 'pointer_synced';
  sessionId?: string;
  role?: SwarmRole;
  rootHash?: string;
  detail?: string;
};

type InferenceService = {
  provider: string;
  serviceType: string;
  model: string;
  url: string;
};

const DEFAULT_RPC = process.env.ZG_COMPUTE_RPC_URL || process.env.EVM_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const DEFAULT_PROVIDER = (process.env.ZG_COMPUTE_PROVIDER_ADDRESS || '').trim();
const DEFAULT_MODEL = (process.env.ZG_COMPUTE_MODEL || '').trim();
const DEFAULT_SERVICE_TYPE = (process.env.ZG_COMPUTE_SERVICE_TYPE || 'chatbot').trim();
const AUTO_FUND_ENABLED = process.env.ZG_COMPUTE_AUTO_FUND !== 'false';
const AUTO_FUND_MIN_SUBACCOUNT_0G = Number(process.env.ZG_COMPUTE_MIN_SUBACCOUNT_0G || '1');
const AUTO_FUND_TOPUP_0G = Number(process.env.ZG_COMPUTE_TOPUP_0G || '1');
const ZG_COMPUTE_BOOTSTRAP_DEPOSIT_0G = Number(process.env.ZG_COMPUTE_BOOTSTRAP_DEPOSIT_0G || '3');
const ZG_SHARED_MEMORY_ENABLED = process.env.ZG_SHARED_MEMORY_ENABLED === 'true';
const ZG_STORAGE_INDEXER_RPC = (
  process.env.ZG_STORAGE_INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai'
).trim();
const ZG_STORAGE_MEMORY_ROOT_HASH = (process.env.ZG_STORAGE_MEMORY_ROOT_HASH || '').trim();

const MEMORY_PATH = path.resolve(process.cwd(), 'data', 'swarm-memory.json');
const MEMORY_ROOT_PATH = path.resolve(process.cwd(), 'data', 'swarm-memory.root.json');
const memory = new Map<string, SwarmSession>();
const swarmEvents: SwarmMemoryEvent[] = [];
let latestMemoryRootHash = ZG_STORAGE_MEMORY_ROOT_HASH;
let sharedMemoryWarned = false;
const INSTANCE_ID = process.env.ZG_INSTANCE_ID || `inst_${Math.random().toString(36).slice(2, 8)}`;

let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (ZG_SHARED_MEMORY_ENABLED) {
    try {
      const sessions = await readSessionsFromSharedStorage();
      for (const s of sessions) memory.set(s.id, s);
      if (sessions.length > 0) return;
    } catch (err) {
      if (!sharedMemoryWarned) {
        console.warn('[0G STORAGE] Failed to load shared swarm memory, falling back to local file.', err);
        sharedMemoryWarned = true;
      }
    }
  }
  try {
    const raw = await fs.readFile(MEMORY_PATH, 'utf8');
    const sessions = JSON.parse(raw) as SwarmSession[];
    for (const s of sessions) memory.set(s.id, s);
  } catch {
    // no-op (first run or invalid file)
  }
}

async function persist(): Promise<void> {
  const sessions = [...memory.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const json = JSON.stringify(sessions, null, 2);
  await writeLocalMemorySnapshot(json);
  if (!ZG_SHARED_MEMORY_ENABLED) return;

  try {
    const rootHash = await uploadSessionsToSharedStorage(json);
    latestMemoryRootHash = rootHash;
    await fs.writeFile(
      MEMORY_ROOT_PATH,
      JSON.stringify({ rootHash, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    publishSwarmEvent({
      type: 'root_published',
      rootHash,
      detail: `instance=${INSTANCE_ID}`,
    });
  } catch (err) {
    if (!sharedMemoryWarned) {
      console.warn('[0G STORAGE] Failed to persist shared swarm memory; local fallback remains active.', err);
      sharedMemoryWarned = true;
    }
  }
}

function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function publishSwarmEvent(input: Omit<SwarmMemoryEvent, 'id' | 'ts'>): void {
  swarmEvents.push({
    id: newEventId(),
    ts: new Date().toISOString(),
    ...input,
  });
  if (swarmEvents.length > 1000) {
    swarmEvents.splice(0, swarmEvents.length - 1000);
  }
}

async function writeLocalMemorySnapshot(json: string): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  await fs.writeFile(MEMORY_PATH, json, 'utf8');
}

function newSessionId(): string {
  return `swarm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isHexPrivateKey(value: string): boolean {
  const h = value.startsWith('0x') ? value : `0x${value}`;
  return /^0x[0-9a-fA-F]{64}$/.test(h);
}

function getStorageSigner(): ethers.Wallet {
  const pk = (process.env.ZG_STORAGE_PRIVATE_KEY || process.env.ZG_COMPUTE_PRIVATE_KEY || process.env.EVM_SETTLEMENT_PRIVATE_KEY || '').trim();
  if (!pk || !isHexPrivateKey(pk)) {
    throw new Error(
      'ZG_STORAGE_PRIVATE_KEY (or ZG_COMPUTE_PRIVATE_KEY / EVM_SETTLEMENT_PRIVATE_KEY) must be a valid 0x-prefixed EVM key for 0G Storage uploads.',
    );
  }
  const provider = new ethers.JsonRpcProvider(DEFAULT_RPC);
  return new ethers.Wallet(pk.startsWith('0x') ? pk : `0x${pk}`, provider);
}

function getMemoryRootFromTx(tx: any): string | null {
  if (!tx || typeof tx !== 'object') return null;
  if (typeof tx.rootHash === 'string' && tx.rootHash.trim()) return tx.rootHash.trim();
  if (Array.isArray(tx.rootHashes) && typeof tx.rootHashes[0] === 'string') return String(tx.rootHashes[0]).trim();
  return null;
}

async function resolveLatestSharedMemoryRoot(): Promise<string | null> {
  if (latestMemoryRootHash) return latestMemoryRootHash;
  try {
    const raw = await fs.readFile(MEMORY_ROOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { rootHash?: string };
    const root = typeof parsed.rootHash === 'string' ? parsed.rootHash.trim() : '';
    if (root) {
      latestMemoryRootHash = root;
      return root;
    }
  } catch {
    // no-op
  }
  return null;
}

async function persistRootPointer(rootHash: string): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_ROOT_PATH), { recursive: true });
  await fs.writeFile(
    MEMORY_ROOT_PATH,
    JSON.stringify({ rootHash, updatedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

function normalizeSessions(raw: unknown): SwarmSession[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is SwarmSession => {
    return Boolean(
      x &&
      typeof x === 'object' &&
      typeof (x as SwarmSession).id === 'string' &&
      typeof (x as SwarmSession).query === 'string' &&
      Array.isArray((x as SwarmSession).steps),
    );
  });
}

async function uploadSessionsToSharedStorage(json: string): Promise<string> {
  const indexer = new Indexer(ZG_STORAGE_INDEXER_RPC);
  const signer = getStorageSigner();
  const data = new TextEncoder().encode(json);
  const memData = new MemData(data);
  const [, treeErr] = await memData.merkleTree();
  if (treeErr) throw new Error(`0G Storage merkleTree failed: ${String(treeErr)}`);
  const [tx, uploadErr] = await indexer.upload(memData, DEFAULT_RPC, signer as any);
  if (uploadErr) throw new Error(`0G Storage upload failed: ${String(uploadErr)}`);
  const rootHash = getMemoryRootFromTx(tx);
  if (!rootHash) throw new Error('0G Storage upload succeeded but rootHash was missing.');
  return rootHash;
}

async function readSessionsFromSharedStorage(): Promise<SwarmSession[]> {
  const rootHash = await resolveLatestSharedMemoryRoot();
  if (!rootHash) return [];
  const indexer = new Indexer(ZG_STORAGE_INDEXER_RPC);
  const [blob, dlErr] = await indexer.downloadToBlob(rootHash, { proof: true });
  if (dlErr) throw new Error(`0G Storage download failed: ${String(dlErr)}`);
  const text = typeof (blob as Blob).text === 'function'
    ? await (blob as Blob).text()
    : Buffer.from(await (blob as any).arrayBuffer()).toString('utf8');
  return normalizeSessions(JSON.parse(text));
}

export async function getSharedMemoryPointer(): Promise<{
  enabled: boolean;
  indexerRpc: string;
  rootHash: string | null;
  localSessionCount: number;
}> {
  await ensureLoaded();
  return {
    enabled: ZG_SHARED_MEMORY_ENABLED,
    indexerRpc: ZG_STORAGE_INDEXER_RPC,
    rootHash: await resolveLatestSharedMemoryRoot(),
    localSessionCount: memory.size,
  };
}

export async function setSharedMemoryPointer(
  rootHash: string,
  opts: { syncNow?: boolean; replaceLocal?: boolean } = {},
): Promise<{ rootHash: string; synced: boolean; loadedSessions: number }> {
  const nextRoot = String(rootHash || '').trim();
  if (!nextRoot) throw new Error('rootHash is required.');
  latestMemoryRootHash = nextRoot;
  await persistRootPointer(nextRoot);
  publishSwarmEvent({
    type: 'pointer_updated',
    rootHash: nextRoot,
    detail: `syncNow=${opts.syncNow !== false}`,
  });

  const syncNow = opts.syncNow !== false;
  if (!syncNow) return { rootHash: nextRoot, synced: false, loadedSessions: 0 };

  const sessions = await readSessionsFromSharedStorage();
  if (opts.replaceLocal !== false) memory.clear();
  for (const s of sessions) memory.set(s.id, s);
  await writeLocalMemorySnapshot(JSON.stringify([...memory.values()], null, 2));
  publishSwarmEvent({
    type: 'pointer_synced',
    rootHash: nextRoot,
    detail: `loadedSessions=${sessions.length}`,
  });
  return { rootHash: nextRoot, synced: true, loadedSessions: sessions.length };
}

export function getSwarmMemoryEvents(sinceIso?: string): SwarmMemoryEvent[] {
  if (!sinceIso) return [...swarmEvents];
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return [...swarmEvents];
  return swarmEvents.filter((e) => Date.parse(e.ts) > since);
}

async function initWritableBroker(): Promise<any> {
  const pk = (process.env.ZG_COMPUTE_PRIVATE_KEY || process.env.EVM_SETTLEMENT_PRIVATE_KEY || '').trim();
  if (!pk || !isHexPrivateKey(pk)) {
    throw new Error('ZG_COMPUTE_PRIVATE_KEY (hex EVM key) is required for authenticated 0G Compute requests.');
  }
  const provider = new ethers.JsonRpcProvider(DEFAULT_RPC);
  const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : `0x${pk}`, provider);
  return createZGComputeNetworkBroker(wallet as any);
}

async function initReadOnlyBroker(): Promise<any> {
  return createZGComputeNetworkReadOnlyBroker(DEFAULT_RPC);
}

type ResolveServiceOpts = {
  providerAddress?: string;
  serviceType?: string;
  model?: string;
  strictProvider?: boolean;
  strictModel?: boolean;
};

async function resolveService(opts: ResolveServiceOpts): Promise<InferenceService> {
  const readOnly = await initReadOnlyBroker();
  const list = ((await readOnly.inference.listService()) || []) as InferenceService[];
  const requestedType = (opts.serviceType || DEFAULT_SERVICE_TYPE || 'chatbot').trim();
  const requestedModel = (opts.model || DEFAULT_MODEL || '').trim();
  const requestedProvider = (opts.providerAddress || DEFAULT_PROVIDER || '').trim();

  const byType = list.filter((s) => s.serviceType === requestedType);
  if (byType.length === 0) {
    throw new Error(`No providers found for serviceType="${requestedType}" on 0G Compute.`);
  }

  let candidates = byType;
  if (requestedProvider) {
    const hit = candidates.filter((s) => s.provider.toLowerCase() === requestedProvider.toLowerCase());
    if (hit.length === 0 && opts.strictProvider) {
      throw new Error(`Requested providerAddress="${requestedProvider}" not found for serviceType="${requestedType}".`);
    }
    if (hit.length > 0) candidates = hit;
  }

  if (requestedModel) {
    const hit = candidates.filter((s) => (s.model || '').toLowerCase() === requestedModel.toLowerCase());
    if (hit.length === 0 && opts.strictModel) {
      const models = [...new Set(candidates.map((s) => s.model).filter(Boolean))].join(', ');
      throw new Error(`Requested model="${requestedModel}" not found for serviceType="${requestedType}". Available: ${models}`);
    }
    if (hit.length > 0) candidates = hit;
  }

  return candidates[0];
}

async function autoFundProviderIfNeeded(broker: any, providerAddress: string): Promise<void> {
  if (!AUTO_FUND_ENABLED) return;
  const minRequired = ethers.parseEther(String(AUTO_FUND_MIN_SUBACCOUNT_0G));
  const topUpAmount = ethers.parseEther(String(AUTO_FUND_TOPUP_0G));
  if (topUpAmount <= 0n) return;

  let subBal = 0n;
  try {
    const details = await broker.inference.getAccountWithDetail(providerAddress);
    const sub = Array.isArray(details) ? details[0] : details?.account || details;
    subBal = BigInt(sub?.balance ?? 0n);
  } catch {
    subBal = 0n;
  }
  if (subBal >= minRequired) return;

  const ledger = await getOrCreateLedger(broker);
  const available = BigInt(ledger?.availableBalance ?? 0n);
  if (available < topUpAmount) {
    throw new Error(
      `Auto-funding required but insufficient main ledger funds. Available=${ethers.formatEther(available)} 0G, required=${ethers.formatEther(topUpAmount)} 0G.`,
    );
  }
  await broker.ledger.transferFund(providerAddress, 'inference', topUpAmount);
}

function isMissingLedgerError(err: unknown): boolean {
  const e = err as { message?: string; reason?: string; shortMessage?: string };
  const blob = `${e?.message || ''} ${e?.reason || ''} ${e?.shortMessage || ''}`.toLowerCase();
  return blob.includes('ledgernotexists') || blob.includes('account does not exist') || blob.includes('add-account');
}

/** Matches `@0glabs/0g-serving-broker` LedgerProcessor.MIN_LEDGER_BALANCE_OG */
const MIN_LEDGER_OG = 3;

function bootstrapAmountOg(): number {
  return Math.max(MIN_LEDGER_OG, ZG_COMPUTE_BOOTSTRAP_DEPOSIT_0G || 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After addLedger/depositFund txs, RPC read can lag — poll until getLedger succeeds.
 */
async function waitForLedgerAfterCreate(broker: any, opts: { attempts?: number; delayMs?: number } = {}): Promise<any> {
  const attempts = opts.attempts ?? 20;
  const delayMs = opts.delayMs ?? 1500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await broker.ledger.getLedger();
    } catch (e) {
      lastErr = e;
      if (!isMissingLedgerError(e)) throw e;
      await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`getLedger still failing after ${attempts} attempts (~${Math.round((attempts * delayMs) / 1000)}s wait).`);
}

/**
 * Creates the on-chain ledger if missing (`LedgerNotExists`).
 * Uses broker SDK order: depositFund first (creates ledger when ≥3 0G), then addLedger fallback.
 * Requires native 0G on the wallet for msg.value + gas (Galileo testnet).
 */
async function ensureComputeLedgerExists(broker: any): Promise<void> {
  try {
    await broker.ledger.getLedger();
    return;
  } catch (e) {
    if (!isMissingLedgerError(e)) throw e;
  }

  const amt = bootstrapAmountOg();
  const errs: string[] = [];

  if (typeof broker?.ledger?.depositFund === 'function') {
    try {
      await broker.ledger.depositFund(amt);
      await waitForLedgerAfterCreate(broker);
      return;
    } catch (e) {
      errs.push(`depositFund(${amt} 0G): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (typeof broker?.ledger?.addLedger === 'function') {
    try {
      await broker.ledger.addLedger(amt);
      await waitForLedgerAfterCreate(broker);
      return;
    } catch (e) {
      errs.push(`addLedger(${amt} 0G): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(
    [
      `Could not create a 0G Compute ledger for this wallet on chain ${process.env.CHAIN_ID || '16602'}.`,
      `You need at least ${amt} native 0G (plus gas) in the wallet used by ZG_COMPUTE_PRIVATE_KEY.`,
      `CLI equivalent: npx 0g-compute-cli add-account (or depositFund/addLedger via broker).`,
      errs.length ? `Attempts:\n${errs.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}

async function getOrCreateLedger(broker: any): Promise<any> {
  try {
    return await broker.ledger.getLedger();
  } catch (err) {
    if (!isMissingLedgerError(err)) throw err;
    await ensureComputeLedgerExists(broker);
    return await broker.ledger.getLedger();
  }
}

async function callInference(
  broker: any,
  providerAddress: string,
  prompt: string,
  modelHint?: string,
): Promise<{ output: string; model: string; chatId?: string; teeVerified?: boolean | null }> {
  const md = await broker.inference.getServiceMetadata(providerAddress);
  const endpoint = String(md?.endpoint || md?.url || '');
  const model = String(modelHint || DEFAULT_MODEL || md?.model || 'default');
  const headers = await broker.inference.getRequestHeaders(providerAddress);
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`0G inference failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as any;
  const output =
    data?.choices?.[0]?.message?.content ||
    data?.output ||
    data?.text ||
    JSON.stringify(data);
  const chatId =
    res.headers.get('ZG-Res-Key') ||
    res.headers.get('zg-res-key') ||
    data?.id ||
    data?.chatID;
  let teeVerified: boolean | null = null;
  if (chatId) {
    try {
      teeVerified = await broker.inference.processResponse(providerAddress, chatId);
    } catch {
      teeVerified = null;
    }
  }
  return { output: String(output), model, chatId: chatId || undefined, teeVerified };
}

function rolePrompt(role: SwarmRole, query: string, context: string): string {
  switch (role) {
    case 'planner':
      return [
        'You are PLANNER in a specialist swarm.',
        'Break the user query into 3-6 actionable tasks.',
        'Return concise bullets with dependencies and success criteria.',
        `User query: ${query}`,
        `Shared memory context: ${context}`,
      ].join('\n');
    case 'researcher':
      return [
        'You are RESEARCHER in a specialist swarm.',
        'Produce factual findings, references, and assumptions.',
        'Keep it concise and structured.',
        `User query: ${query}`,
        `Planner output: ${context}`,
      ].join('\n');
    case 'critic':
      return [
        'You are CRITIC in a specialist swarm.',
        'Identify risks, weak assumptions, and missing tests.',
        'Return severity-ranked issues and mitigations.',
        `User query: ${query}`,
        `Research output: ${context}`,
      ].join('\n');
    case 'executor':
      return [
        'You are EXECUTOR in a specialist swarm.',
        'Synthesize planner+researcher+critic into a concrete action plan.',
        'Output next actions, ordered with rationale.',
        `User query: ${query}`,
        `Prior swarm memory: ${context}`,
      ].join('\n');
  }
}

export async function runSwarmQuery(input: {
  query: string;
  providerAddress?: string;
  serviceType?: string;
  model?: string;
  strictProvider?: boolean;
  strictModel?: boolean;
  sessionId?: string;
}): Promise<SwarmSession> {
  await ensureLoaded();
  const broker = await initWritableBroker();
  const service = await resolveService({
    providerAddress: input.providerAddress,
    serviceType: input.serviceType,
    model: input.model,
    strictProvider: input.strictProvider ?? Boolean(input.providerAddress),
    strictModel: input.strictModel ?? Boolean(input.model || DEFAULT_MODEL),
  });
  await autoFundProviderIfNeeded(broker, service.provider);

  const existing = input.sessionId ? memory.get(input.sessionId) : undefined;
  const session: SwarmSession =
    existing ||
    {
      id: input.sessionId || newSessionId(),
      query: input.query,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      finalAnswer: '',
    };

  publishSwarmEvent({
    type: 'session_started',
    sessionId: session.id,
    detail: `query="${input.query.slice(0, 120)}"`,
  });

  const roles: SwarmRole[] = ['planner', 'researcher', 'critic', 'executor'];
  let rollingContext = session.steps.map((s) => `${s.role}: ${s.output}`).join('\n\n');
  rollingContext = rollingContext.slice(-10_000);

  for (const role of roles) {
    const prompt = rolePrompt(role, input.query, rollingContext || 'none');
    const r = await callInference(broker, service.provider, prompt, input.model);
    const step: SwarmStep = {
      role,
      prompt,
      output: r.output,
      providerAddress: service.provider,
      model: r.model,
      chatId: r.chatId,
      teeVerified: r.teeVerified,
      timestamp: new Date().toISOString(),
    };
    session.steps.push(step);
    session.updatedAt = new Date().toISOString();
    memory.set(session.id, session);
    if (ZG_SHARED_MEMORY_ENABLED) {
      // Publish each role completion to shared storage for near real-time cross-instance sync.
      await persist();
    }
    publishSwarmEvent({
      type: 'step_completed',
      sessionId: session.id,
      role,
      detail: `${r.model} @ ${service.provider}`,
      rootHash: latestMemoryRootHash || undefined,
    });
    rollingContext = `${rollingContext}\n\n${role.toUpperCase()}: ${r.output}`.slice(-12_000);
  }

  const last = session.steps[session.steps.length - 1];
  session.finalAnswer = last?.output || '';
  session.updatedAt = new Date().toISOString();
  memory.set(session.id, session);
  await persist();
  publishSwarmEvent({
    type: 'session_completed',
    sessionId: session.id,
    rootHash: latestMemoryRootHash || undefined,
  });
  return session;
}

export async function getSwarmSessions(): Promise<SwarmSession[]> {
  await ensureLoaded();
  return [...memory.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getComputeAccountSummary(): Promise<{
  totalBalance: string;
  availableBalance: string;
}> {
  const broker = await initWritableBroker();
  const ledger = await getOrCreateLedger(broker);
  return {
    totalBalance: ethers.formatEther(ledger.totalBalance),
    availableBalance: ethers.formatEther(ledger.availableBalance),
  };
}

export async function depositToComputeLedger(amount0G: number): Promise<void> {
  const broker = await initWritableBroker();
  const amountWei = ethers.parseEther(String(amount0G));
  try {
    await broker.ledger.depositFund(amount0G);
    return;
  } catch {
    try {
      await broker.ledger.depositFund(String(amount0G));
      return;
    } catch {
      await broker.ledger.depositFund(amountWei);
    }
  }
}

export async function transferToInferenceProvider(providerAddress: string, amount0G: string): Promise<void> {
  const broker = await initWritableBroker();
  await broker.ledger.transferFund(providerAddress, 'inference', ethers.parseEther(amount0G));
}

export async function bootstrapComputeAccount(): Promise<{
  ok: boolean;
  ledgerCreated: boolean;
  bootstrapAmountOg: number;
  totalBalance?: string;
  availableBalance?: string;
}> {
  const broker = await initWritableBroker();
  let ledgerCreated = false;

  try {
    const ledger = await broker.ledger.getLedger();
    return {
      ok: true,
      ledgerCreated,
      bootstrapAmountOg: bootstrapAmountOg(),
      totalBalance: ethers.formatEther(ledger.totalBalance ?? 0n),
      availableBalance: ethers.formatEther(ledger.availableBalance ?? 0n),
    };
  } catch (err) {
    if (!isMissingLedgerError(err)) throw err;
  }

  ledgerCreated = true;
  await ensureComputeLedgerExists(broker);
  const ledger = await broker.ledger.getLedger();
  return {
    ok: true,
    ledgerCreated,
    bootstrapAmountOg: bootstrapAmountOg(),
    totalBalance: ethers.formatEther(ledger.totalBalance ?? 0n),
    availableBalance: ethers.formatEther(ledger.availableBalance ?? 0n),
  };
}

