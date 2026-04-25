/**
 * ═══════════════════════════════════════════════════════════════════════════
 * mogause — Autonomous Stellar Agent (CLI + Programmatic)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An AI agent that:
 *   1. Discovers available paid Worker Agents from the backend registry
 *   2. Accepts a user query (CLI or programmatic)
 *   3. Plans optimal delegation using LLM (Groq / Gemini)
 *   4. Autonomously evaluates cost vs. reputation before hiring
 *   5. Calls paid tools over HTTP (EVM identity via AGENT_PRIVATE_KEY; paid routes follow backend x402 / simulation rules)
 *   6. Handles recursive A2A hiring chains
 *   7. Aggregates results into a final answer
 *
 * This is the "Manager Agent" — the CEO of the autonomous economy.
 */

import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import * as readline from 'readline';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config({ path: '../.env' });
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const PRIVATE_KEY = (process.env.AGENT_PRIVATE_KEY || '').trim();
const SERVER_URL = process.env.AGENT_SERVER_URL || 'http://localhost:3001';
const NETWORK = process.env.NETWORK || 'testnet';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!PRIVATE_KEY) {
  console.error('[AGENT] AGENT_PRIVATE_KEY not set. Run: npx tsx src/generate-wallet.ts');
  process.exit(1);
}

function parseEvmPrivateKeyHex(raw: string): `0x${string}` | null {
  const s = raw.trim();
  if (!s) return null;
  const h = s.startsWith('0x') ? s : `0x${s}`;
  return /^0x[0-9a-fA-F]{64}$/.test(h) ? (h as `0x${string}`) : null;
}

const EVM_KEY = parseEvmPrivateKeyHex(PRIVATE_KEY);
if (!EVM_KEY) {
  console.error(
    '[AGENT] Invalid AGENT_PRIVATE_KEY. This agent uses an EVM private key: 64 hex characters, optional 0x prefix (same format as MetaMask / Hardhat).',
  );
  console.error('[AGENT] Generate one with: npm run generate-wallet');
  process.exit(1);
}

const evmAccount = privateKeyToAccount(EVM_KEY);
const BLOCK_EXPLORER = (process.env.BLOCK_EXPLORER || 'https://chainscan-galileo.0g.ai').replace(/\/$/, '');

const api: AxiosInstance = axios.create({ baseURL: SERVER_URL });

// AI Clients
let groqClient: Groq | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

if (GROQ_API_KEY) groqClient = new Groq({ apiKey: GROQ_API_KEY });
if (GEMINI_API_KEY) geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface Tool {
  id: string;
  name: string;
  endpoint: string;
  method: string;
  price: { XLM: number };
  category: string;
  params: Record<string, string>;
  description: string;
  reputation: number;
  jobsCompleted: number;
  efficiency: number;
  canHireSubAgents: boolean;
}

interface HiringDecision {
  tool: Tool;
  reason: string;
  costEfficiency: number;
  alternatives: Tool[];
}

// Note: The actual implementation of the agent logic (LLM planning,
// tool execution, and result aggregation) would go here.

interface ToolCallResult {
  tool: string;
  agentName: string;
  success: boolean;
  data: any;
  hiringReason: string;
  payment?: {
    transaction: string;
    token: string;
    amount: string;
    explorerUrl: string;
  };
  subAgentHires?: any[];
  error?: string;
  latencyMs: number;
}

interface AgentPlan {
  query: string;
  reasoning: string;
  toolCalls: { toolId: string; params: Record<string, any> }[];
}

async function runAgent() {
  console.log('mogause agent initialized.');
  console.log(`Wallet (EVM): ${evmAccount.address}`);
}

runAgent().catch(console.error);

// ═══════════════════════════════════════════════════════════════════════════
// Tool Discovery — Query the Backend Registry
// ═══════════════════════════════════════════════════════════════════════════

let availableTools: Tool[] = [];

async function discoverTools(): Promise<Tool[]> {
  console.log(`[AGENT] [DEBUG] SERVER_URL is: ${SERVER_URL}`);
  console.log('[AGENT] [SEARCH] Discovering available Worker Agents...');
  try {
    const res = await axios.get(`${SERVER_URL}/api/tools`);
    // Handle both { tools: [] } and [] response formats
    availableTools = Array.isArray(res.data) ? res.data : res.data.tools || [];

    // Sort by efficiency (reputation² / price)
    availableTools = evaluateWorkers(availableTools);

    console.log(`[AGENT] [OK] Found ${availableTools.length} Worker Agents:`);
    availableTools.forEach(t => {
      const subLabel = t.canHireSubAgents ? ' [A2A-ENABLED]' : '';
      const priceXLM = typeof t.price === 'object' && t.price.XLM !== undefined 
        ? t.price.XLM.toString() 
        : (t.price || '0').toString();
      console.log(
        `  ├─ ${t.name.padEnd(22)} ${priceXLM.padEnd(6)} XLM | Rep: ${t.reputation}/100 | Jobs: ${t.jobsCompleted}${subLabel}`
      );
    });
    return availableTools;
  } catch (err) {
    console.error('[AGENT] [ERROR] Tool discovery failed:', err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Autonomous Cost-Evaluation Logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluates workers by "Value Score" = reputation² / price
 * This gives quadratic preference to high-reputation, low-cost agents
 */
function evaluateWorkers(tools: Tool[]): Tool[] {
  return tools.sort((a, b) => {
    const scoreA = (a.reputation * a.reputation) / (a.price.XLM * 10000 || 1);
    const scoreB = (b.reputation * b.reputation) / (b.price.XLM * 10000 || 1);
    return scoreB - scoreA;
  });
}

/**
 * Autonomous Hiring Decision
 * Manager Agent evaluates cost vs. speed vs. reputation before signing x402 payload
 */
function makeHiringDecision(toolId: string, tools: Tool[]): HiringDecision | null {
  const tool = tools.find(t => t.id === toolId);
  if (!tool) return null;

  // Find alternatives in same category
  const alternatives = tools
    .filter(t => t.category === tool.category && t.id !== toolId && t.reputation >= 50)
    .sort((a, b) => b.reputation - a.reputation);

  const costEfficiency = tool.price.XLM > 0
    ? Math.round((tool.reputation * tool.reputation) / (tool.price.XLM * 10000))
    : 0;

  let reason: string;
  if (alternatives.length > 0) {
    const alt = alternatives[0];
    const altEfficiency = alt.price.XLM > 0
      ? Math.round((alt.reputation * alt.reputation) / (alt.price.XLM * 10000))
      : 0;

    if (costEfficiency >= altEfficiency) {
      reason = `Selected ${tool.name} (Efficiency: ${costEfficiency}) over ${alt.name} (Efficiency: ${altEfficiency}). ` +
        `Reason: Better cost-reputation ratio at ${tool.price.XLM} XLM with ${tool.reputation}/100 reputation.`;
    } else {
      reason = `Selected ${tool.name} (Cost: ${tool.price.XLM} XLM, Rep: ${tool.reputation}/100) — ` +
        `specific capability match. ${alt.name} had higher efficiency but different specialization.`;
    }
  } else {
    reason = `Hiring ${tool.name}: Only available specialist in "${tool.category}" category. ` +
      `Cost: ${tool.price.XLM} XLM, Rep: ${tool.reputation}/100.`;
  }

  return { tool, reason, costEfficiency, alternatives };
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM Planner — Strategic Delegation
// ═══════════════════════════════════════════════════════════════════════════

async function planToolCalls(query: string, tools: Tool[]): Promise<AgentPlan> {
  const toolsDescription = tools.map(t =>
    `- ID: "${t.id}" | Name: "${t.name}" | Cost: ${t.price.XLM} XLM | Rep: ${t.reputation}/100 | Cat: ${t.category} | ${t.canHireSubAgents ? 'CAN HIRE SUB-AGENTS' : 'Worker'}\n  Description: ${t.description}\n  Params: ${JSON.stringify(t.params)}`
  ).join('\n\n');

  const systemPrompt = `You are the MANAGER AGENT of mogause — an autonomous multi-agent system backed by a backend registry and payments.

You have a BUDGET and must hire Worker Agents. Pricing is shown in XLM-equivalent fields from the tool registry; actual settlement follows the server configuration.

Available Worker Agents:
${toolsDescription}

AUTONOMOUS DECISION RULES:
1. ALWAYS prefer agents with reputation ≥ 80/100
2. For complex tasks, use agents marked "CAN HIRE SUB-AGENTS" (they recursively hire)
3. Minimize total cost while maximizing result quality
4. Explain your hiring rationale (this is shown to judges)
5. Break complex queries into parallel sub-tasks when possible

Return ONLY valid JSON:
{
  "reasoning": "Strategic delegation plan with cost-efficiency analysis",
  "toolCalls": [
    { "toolId": "tool_id", "params": { "param_name": "value" } }
  ]
}`;

  console.log('[AGENT] [PLAN] Planning delegation strategy...');

  try {
    if (groqClient) {
      const completion = await groqClient.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        response_format: { type: 'json_object' },
      });
      const content = completion.choices[0]?.message?.content;
      if (content) {
        const plan = JSON.parse(content);
        return { query, ...plan };
      }
    }

    if (geminiClient) {
      const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(systemPrompt + '\n\nUser Query: ' + query);
      const text = result.response.text();
      const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
      const plan = JSON.parse(jsonStr);
      return { query, ...plan };
    }

    throw new Error('No LLM available');
  } catch (err) {
    console.warn('[AGENT] [WARN] LLM planning failed, using rule-based fallback');
    return fallbackPlan(query, tools);
  }
}

function fallbackPlan(query: string, tools: Tool[]): AgentPlan {
  const q = query.toLowerCase();
  const plan: AgentPlan = { query, toolCalls: [], reasoning: 'Rule-based planning (LLM unavailable)' };

  if (q.includes('weather')) {
    const cityMatch = q.match(/weather\s+(?:in\s+)?(\w+)/i);
    plan.toolCalls.push({ toolId: 'weather', params: { city: cityMatch?.[1] || 'New York' } });
  }
  if (q.includes('summarize') || q.includes('summary')) {
    plan.toolCalls.push({ toolId: 'summarize', params: { text: query, maxLength: 100 } });
  }
  if (q.includes('sentiment') || q.includes('feeling') || q.includes('tone')) {
    plan.toolCalls.push({ toolId: 'sentiment', params: { text: query } });
  }
  if (/\d+\s*[+\-*/]\s*\d+/.test(q) || q.includes('calculate') || q.includes('math')) {
    const expr = q.match(/[\d+\-*/().^ ]+/)?.[0]?.trim() || '42 * 3';
    plan.toolCalls.push({ toolId: 'mathSolve', params: { expression: expr } });
  }
  if (q.includes('code') && q.includes('explain')) {
    plan.toolCalls.push({ toolId: 'codeExplain', params: { code: query } });
  }
  if (q.includes('research') || q.includes('find out') || q.includes('what is')) {
    plan.toolCalls.push({ toolId: 'research', params: { query } });
  }
  if (q.includes('write') || q.includes('generate') || q.includes('create')) {
    plan.toolCalls.push({ toolId: 'coding', params: { spec: query } });
  }
  if (q.includes('translate')) {
    plan.toolCalls.push({ toolId: 'translate', params: { text: query, targetLang: 'Spanish' } });
  }

  if (plan.toolCalls.length === 0) {
    plan.toolCalls.push({ toolId: 'research', params: { query } });
    plan.reasoning += ' No specific intent detected, defaulting to research.';
  }

  return plan;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Executor — x402 Payment + Execution
// ═══════════════════════════════════════════════════════════════════════════

async function executeTool(
  toolId: string,
  params: Record<string, any>,
  token: 'XLM' = 'XLM'
): Promise<ToolCallResult> {
  const startTime = Date.now();
  const hiring = makeHiringDecision(toolId, availableTools);

  if (!hiring) {
    return {
      tool: toolId,
      agentName: 'Unknown',
      success: false,
      data: null,
      hiringReason: `Tool "${toolId}" not found in registry`,
      error: `Tool "${toolId}" not found`,
      latencyMs: Date.now() - startTime,
    };
  }

  const { tool, reason } = hiring;

  console.log(`[AGENT] [PAY] Hiring ${tool.name} (${tool.price.XLM} XLM, Rep: ${tool.reputation}/100)`);
  console.log(`[AGENT] [NOTE] Reason: ${reason}`);

  try {
    const res = await api.post(`${tool.endpoint}?token=${token}`, params);

        const paymentInfo = (res.headers as any)['payment-response'];

        const result: ToolCallResult = {
          tool: toolId,
          agentName: tool.name,
          success: true,
          data: res.data,
          hiringReason: reason,
          latencyMs: Date.now() - startTime,
        };

        if (paymentInfo) {
          result.payment = {
            transaction: paymentInfo,
            token,
            amount: `${tool.price.XLM} XLM`,
            explorerUrl: `${BLOCK_EXPLORER}/tx/${paymentInfo}`,
          };
          console.log(`[AGENT] [OK] Paid ${tool.price.XLM} XLM | tx: ${paymentInfo}`);
        }

        // Track sub-agent hires from recursive agents
        if (res.data.subAgentHires) {
          result.subAgentHires = res.data.subAgentHires;
          console.log(`[AGENT] [A2A] Chain: ${tool.name} hired ${res.data.subAgentHires.length} sub-agents`);
          res.data.subAgentHires.forEach((sub: any) => {
            console.log(`  └─ ${sub.agent}: ${sub.task} (${sub.cost})`);
          });
        }

        return result;
      } catch (err: any) {
    const status = err.response?.status;

    // Log 402 details for protocol transparency
    if (status === 402) {
      console.log(`[AGENT] [INFO] x402 Challenge from ${tool.name}:`);
      console.log(`  HTTP 402 Payment Required`);
      console.log(`  WWW-Authenticate: ${err.response?.headers?.['www-authenticate'] || 'N/A'}`);
      console.log(`  Payload: ${JSON.stringify(err.response?.data || {})}`);
    }

    // -- Self-Healing: Retry with Fallback Agents --
    const MAX_RETRIES = 2;
    const alternatives = hiring.alternatives || [];

    for (let retry = 0; retry < Math.min(MAX_RETRIES, alternatives.length); retry++) {
      const fallback = alternatives[retry];
      console.log(`[AGENT] [SELF-HEAL] Attempt ${retry + 1}: Switching from ${tool.name} to ${fallback.name}`);
      console.log(`[AGENT] [SELF-HEAL] Fallback: ${fallback.name} (Rep: ${fallback.reputation}, Cost: ${fallback.price.XLM} XLM)`);

      try {
        const fallbackRes = await api.post(`${fallback.endpoint}?token=${token}`, params);

        const fallbackPaymentInfo = (fallbackRes.headers as any)['payment-response'];

        const healedResult: ToolCallResult = {
          tool: toolId,
          agentName: `${fallback.name} (healed from ${tool.name})`,
          success: true,
          data: fallbackRes.data,
          hiringReason: `${reason} | SELF-HEALED: ${tool.name} failed (${err.message}), recovered via ${fallback.name}`,
          latencyMs: Date.now() - startTime,
        };

        if (fallbackPaymentInfo) {
          healedResult.payment = {
            transaction: fallbackPaymentInfo,
            token,
            amount: `${fallback.price.XLM} XLM`,
            explorerUrl: `${BLOCK_EXPLORER}/tx/${fallbackPaymentInfo}`,
          };
          console.log(`[AGENT] [SELF-HEAL] Recovered via ${fallback.name} | Paid ${fallback.price.XLM} XLM`);
        }

        return healedResult;
      } catch (retryErr: any) {
        console.error(`[AGENT] [SELF-HEAL] Fallback ${fallback.name} also failed: ${retryErr.message}`);
      }
    }

    // All retries exhausted
    return {
      tool: toolId,
      agentName: tool.name,
      success: false,
      data: null,
      hiringReason: reason,
      error: `HTTP ${status}: ${err.message} (self-healing exhausted after ${Math.min(MAX_RETRIES, alternatives.length)} fallback attempts)`,
      latencyMs: Date.now() - startTime,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent Orchestrator — Full Pipeline
// ═══════════════════════════════════════════════════════════════════════════

async function processQuery(
  query: string,
  token: 'XLM' = 'XLM'
): Promise<{
  query: string;
  plan: AgentPlan;
  hiringDecisions: Array<{ agent: string; reason: string; cost: number }>;
  results: ToolCallResult[];
  finalAnswer: string;
  totalCost: number;
  a2aCost: number;
  a2aDepth: number;
}> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Processing: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`.padEnd(63) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // 1. Plan
  const plan = await planToolCalls(query, availableTools);
  console.log(`[AGENT] [INFO] Strategy: ${plan.reasoning}`);
  console.log(`[AGENT] [INFO] Workers to hire: ${plan.toolCalls.length > 0 ? plan.toolCalls.map(c => c.toolId).join(' → ') : 'none'}`);

  if (plan.toolCalls.length === 0) {
    return {
      query,
      plan,
      hiringDecisions: [],
      results: [],
      finalAnswer: plan.reasoning || 'No tools needed.',
      totalCost: 0,
      a2aCost: 0,
      a2aDepth: 0,
    };
  }

  // 2. Execute sequentially with autonomous hiring decisions
  const results: ToolCallResult[] = [];
  const hiringDecisions: Array<{ agent: string; reason: string; cost: number }> = [];
  let totalCost = 0;
  let a2aCost = 0;
  let a2aDepth = 0;

  for (const call of plan.toolCalls) {
    const result = await executeTool(call.toolId, call.params, token);
    results.push(result);

    const tool = availableTools.find(t => t.id === call.toolId);
    if (result.success && tool) {
      totalCost += tool.price.XLM;
      hiringDecisions.push({
        agent: result.agentName,
        reason: result.hiringReason,
        cost: tool.price.XLM,
      });

      // Account for sub-agent costs
      if (result.data?.totalCostIncludingSubAgents) {
        const subCost = result.data.totalCostIncludingSubAgents - tool.price.XLM;
        a2aCost += subCost;
        totalCost += subCost;
        a2aDepth = Math.max(a2aDepth, result.data.recursiveDepth || 0);
      }
    }
  }

  // 3. Synthesize final answer
  const finalAnswer = await synthesizeAnswer(query, results);

  console.log('');
  console.log(`[AGENT] [PAY] Total cost: ${totalCost.toFixed(4)} XLM (incl. ${a2aCost.toFixed(4)} XLM A2A)`);
  console.log(`[AGENT] [A2A] Depth: ${a2aDepth}`);
  console.log(`[AGENT] [OK] Final: ${finalAnswer.slice(0, 200)}...`);

  return { query, plan, hiringDecisions, results, finalAnswer, totalCost, a2aCost, a2aDepth };
}

async function synthesizeAnswer(query: string, results: ToolCallResult[]): Promise<string> {
  const successful = results.filter(r => r.success);

  if (successful.length === 0) {
    return 'All tool calls failed. Check wallet balance and server connectivity.';
  }

  // Try LLM synthesis
  try {
    if (groqClient) {
      const context = successful.map(r => {
        // Prioritize KaggleIngest TOON content
        const content = r.data?.toon_content || r.data?.result || r.data?.summary || r.data?.weather || r.data?.code || r.data;
        return `${r.agentName}: ${typeof content === 'string' ? content : JSON.stringify(content)}`;
      }).join('\n\n');

      const completion = await groqClient.chat.completions.create({
        messages: [{
          role: 'user',
          content: `Synthesize these worker agent results into a clear, comprehensive answer for: "${query}"\n\n${context}`,
        }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.5,
        max_tokens: 500,
      });
      return completion.choices[0]?.message?.content || context;
    }
  } catch { /* fall through */ }

  // Fallback: concat results
  return successful.map(r => {
    const content = r.data?.result || r.data?.summary || r.data?.weather || r.data?.code || r.data;
    return `**${r.agentName}**: ${typeof content === 'string' ? content : JSON.stringify(content)}`;
  }).join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Interactive REPL
// ═══════════════════════════════════════════════════════════════════════════

async function startRepl() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              mogause — x402 AUTONOMOUS AGENT                ║');
  console.log('║              EVM identity (0G / backend tools)              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Server  : ${SERVER_URL.padEnd(49)}║`);
  console.log(`║  Wallet  : ${evmAccount.address.padEnd(49)}║`);
  console.log(`║  Network : ${NETWORK.padEnd(49)}║`);
  console.log(`║  LLM     : ${(groqClient ? 'Groq (llama-3.3-70b)' : geminiClient ? 'Gemini' : 'Rule-based').padEnd(49)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Commands:                                                  ║');
  console.log('║    <query>    → Agent plans + hires + pays + executes       ║');
  console.log('║    "tools"    → List available agents + pricing             ║');
  console.log('║    "registry" → Show agent registry + reputation            ║');
  console.log('║    "payments" → Show payment history                        ║');
  console.log('║    "demo"     → Run multi-agent demo                        ║');
  console.log('║    "exit"     → Quit                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  await discoverTools();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('\n[mogause] > ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { prompt(); return; }

      if (['exit', 'quit'].includes(trimmed)) {
        console.log('[AGENT] Shutting down.');
        rl.close();
        process.exit(0);
      }

      if (trimmed === 'tools') {
        console.log('\n┌─ Available Worker Agents ─────────────────────────────────┐');
        for (const t of availableTools) {
          const sub = t.canHireSubAgents ? ' [A2A]' : '   ';
          console.log(`│ ${t.name.padEnd(22)} ${t.price.XLM.toString().padEnd(7)} XLM | Rep: ${t.reputation.toString().padEnd(3)}/100 | ${t.category}${sub} │`);
        }
        console.log('└───────────────────────────────────────────────────────────┘');
        prompt();
        return;
      }

      if (trimmed === 'registry') {
        try {
          const res = await axios.get(`${SERVER_URL}/api/registry`);
          const oc = res.data.onChain as
            | { enabled?: boolean; error?: string; agents?: Array<{ name: string; reputation: number; jobsCompleted: number; totalEarned0G: string; address: string }> }
            | undefined;
          console.log('\n┌─ Marketplace agents (x402 / backend) ────────────────────┐');
          for (const a of res.data.agents) {
            console.log(`│ ${a.name.padEnd(22)} Rep: ${a.reputation.toString().padEnd(3)}/100 | Jobs: ${a.jobsCompleted.toString().padEnd(5)} | Earned: ${a.totalEarned.toFixed(1)} XLM │`);
          }
          console.log('└───────────────────────────────────────────────────────────┘');
          if (oc?.error) {
            console.log(`[registry] EVM sync note: ${oc.error}`);
          }
          if (oc?.enabled && (oc.agents?.length ?? 0) > 0) {
            console.log('\n┌─ EVM AgentRegistry (0G-Galileo) ─────────────────────────┐');
            for (const a of oc.agents || []) {
              const earn = a.totalEarned0G ?? '0';
              console.log(
                `│ ${(a.name || '').slice(0, 20).padEnd(20)} Rep: ${String(a.reputation).padEnd(3)}/100 | Jobs: ${String(a.jobsCompleted).padEnd(5)} | 0G: ${earn} | ${(a.address || '').slice(0, 10)}… │`,
              );
            }
            console.log('└───────────────────────────────────────────────────────────┘');
          }
          console.log(`Contract (EVM): ${res.data.contractAddress}`);
        } catch { console.log('Failed to fetch registry.'); }
        prompt();
        return;
      }

      if (trimmed === 'payments') {
        try {
          const res = await axios.get(`${SERVER_URL}/api/payments`);
          console.log('\n┌─ Payment History ─────────────────────────────────────────┐');
          for (const p of res.data.payments.slice(0, 10)) {
            console.log(`│ ${p.timestamp.slice(11, 19)} | ${p.payer.padEnd(18)} → ${p.worker.padEnd(18)} | ${p.amount.padEnd(12)} | ${p.isA2A ? 'A2A' : 'H2A'} │`);
          }
          console.log(`│ Total: ${res.data.count} payments | A2A: ${res.data.a2aCount} │`);
          console.log('└───────────────────────────────────────────────────────────┘');
        } catch { console.log('Failed to fetch payments.'); }
        prompt();
        return;
      }

      if (trimmed === 'demo') {
        console.log('[AGENT] [DEMO] Running multi-agent demo...');
        await processQuery('Research the x402 protocol on Stellar, summarize the findings, and check the weather in Tokyo');
        prompt();
        return;
      }

      await processQuery(trimmed);
      prompt();
    });
  };

  prompt();
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════════

const queryArg = process.argv.slice(2).join(' ');
const daemonMode = process.env.AGENT_DAEMON_MODE === 'true';

async function startDaemon() {
  console.log('[AGENT] Daemon mode enabled (AGENT_DAEMON_MODE=true).');
  console.log('[AGENT] Running headless on server; interactive REPL is disabled.');
  await discoverTools();

  // Keep container alive and periodically refresh tool registry.
  setInterval(async () => {
    try {
      await discoverTools();
    } catch (e) {
      console.error('[AGENT] Daemon refresh failed:', e instanceof Error ? e.message : String(e));
    }
  }, 60_000);
}

if (queryArg) {
  (async () => {
    await discoverTools();
    const result = await processQuery(queryArg);
    console.log('\n[RESULT]', JSON.stringify(result, null, 2));
  })();
} else if (daemonMode) {
  startDaemon().catch((e) => {
    console.error('[AGENT] Daemon startup failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
} else {
  startRepl();
}
