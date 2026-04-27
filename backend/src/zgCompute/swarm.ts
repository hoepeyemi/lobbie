import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ethers } from 'ethers';

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

const MEMORY_PATH = path.resolve(process.cwd(), 'data', 'swarm-memory.json');
const memory = new Map<string, SwarmSession>();

let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(MEMORY_PATH, 'utf8');
    const sessions = JSON.parse(raw) as SwarmSession[];
    for (const s of sessions) memory.set(s.id, s);
  } catch {
    // no-op (first run or invalid file)
  }
}

async function persist(): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  const sessions = [...memory.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  await fs.writeFile(MEMORY_PATH, JSON.stringify(sessions, null, 2), 'utf8');
}

function newSessionId(): string {
  return `swarm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isHexPrivateKey(value: string): boolean {
  const h = value.startsWith('0x') ? value : `0x${value}`;
  return /^0x[0-9a-fA-F]{64}$/.test(h);
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

  const ledger = await broker.ledger.getLedger();
  const available = BigInt(ledger?.availableBalance ?? 0n);
  if (available < topUpAmount) {
    throw new Error(
      `Auto-funding required but insufficient main ledger funds. Available=${ethers.formatEther(available)} 0G, required=${ethers.formatEther(topUpAmount)} 0G.`,
    );
  }
  await broker.ledger.transferFund(providerAddress, 'inference', topUpAmount);
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
    rollingContext = `${rollingContext}\n\n${role.toUpperCase()}: ${r.output}`.slice(-12_000);
  }

  const last = session.steps[session.steps.length - 1];
  session.finalAnswer = last?.output || '';
  session.updatedAt = new Date().toISOString();
  memory.set(session.id, session);
  await persist();
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
  const ledger = await broker.ledger.getLedger();
  return {
    totalBalance: ethers.formatEther(ledger.totalBalance),
    availableBalance: ethers.formatEther(ledger.availableBalance),
  };
}

export async function depositToComputeLedger(amount0G: number): Promise<void> {
  const broker = await initWritableBroker();
  await broker.ledger.depositFund(amount0G);
}

export async function transferToInferenceProvider(providerAddress: string, amount0G: string): Promise<void> {
  const broker = await initWritableBroker();
  await broker.ledger.transferFund(providerAddress, 'inference', ethers.parseEther(amount0G));
}

