# mogause — x402 Autonomous Agent Economy

> **The first decentralized labor marketplace where AI agents autonomously hire, negotiate, and pay each other using the x402 protocol on Stellar.**

---

## What is mogause?

mogause is a **systemic Agent-to-Agent (A2A) economy** — not a toy demo. A Manager Agent receives natural-language queries, plans multi-step tasks via LLM, **autonomously evaluates worker agents** on reputation and cost-efficiency, and settles every payment on-chain through the **x402 HTTP 402** payment protocol on Stellar.

### Payment Protocol Clarification (x402 vs MPP)

- **x402** is the protocol-level standard in this project: HTTP `402 Payment Required` challenge/response flow for paid API routes.
- **MPP (Stellar MPP / mppx)** is the concrete payment rail implementation used under x402 for settlement and receipts.
- In practice: mogause uses **x402 for API payment negotiation** and **MPP on Stellar for XLM settlement**.

### Key Differentiators

| Feature                        | Description                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Recursive A2A Hiring**       | Agents hire sub-agents mid-task (Research → Summarizer + Sentiment). Payments cascade with depth tracking.        |
| **Reputation Layer**           | On-chain Stellar (Soroban) registry tracks reputation (0–10,000 basis), dynamic pricing, job history, and category leaders. |
| **Autonomous Cost Evaluation** | Value Score = reputation² / (price × 10,000). Manager compares alternatives before every hire.                    |
| **Protocol Transparency**      | Every x402 handshake captured — raw 402 headers, payment payloads, signed data — visible in the dashboard.        |
| **Dual Token Settlement**      | Pay in XLM (Stellar native). Token preference cascades through the entire A2A chain.                                |
| **Live Economy Visualization** | Canvas-rendered topology graph showing User → Manager → Workers with animated payment flows.                      |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 16 + React 19)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │AgentChat │ │EconomyGr.│ │ TxnLog   │ │ProtocolTrace  │  │
│  └────┬─────┘ └──────────┘ └──────────┘ └───────────────┘  │
│       │ POST /api/agent/query    SSE /api/agent/events      │
├───────┼─────────────────────────────────────────────────────┤
│  BACKEND (Express + x402 on Stellar)                        │
│  ┌────▼────────────────────────────────────────────────┐    │
│  │  Manager Agent (LLM Planning: Groq → Gemini)       │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │ autonomousHiringDecision(reputation, cost)  │    │    │
│  │  └────────────────┬────────────────────────────┘    │    │
│  │                   │ x402 Payment (HTTP 402 → 200)   │    │
│  │  ┌────────┬───────┼───────┬────────┬───────────┐    │    │
│  │  │Weather │Summary│ Math  │Sentim. │ Research  │    │    │
│  │  │0.001XLM│0.003  │0.005  │0.002   │ 0.01 XLM │    │    │
│  │  └────────┴───────┴───────┴────────┤           │    │    │
│  │                                    │  ┌──────┐ │    │    │
│  │                         A2A Hire → │  │Summ. │ │    │    │
│  │                                    │  │Sent. │ │    │    │
│  │                                    └──┴──────┘ │    │    │
│  └─────────────────────────────────────────────────┘    │    │
├─────────────────────────────────────────────────────────┤    │
│  STELLAR (Soroban — testnet / pubnet)                        │    │
│  Agent registry — registration, jobs, reputation          │    │
└─────────────────────────────────────────────────────────┘    │
```

### Worker Agents (x402-Gated)

| Agent          | Endpoint               | Price     | Category    | Recursive?                               |
| -------------- | ---------------------- | --------- | ----------- | ---------------------------------------- |
| WeatherBot     | `/api/weather`         | 0.001 XLM | utility     | No                                       |
| Summarizer Pro | `/api/summarize`       | 0.003 XLM | nlp         | No                                       |
| MathSolver     | `/api/math-solve`      | 0.005 XLM | computation | No                                       |
| SentimentAI    | `/api/sentiment`       | 0.002 XLM | nlp         | No                                       |
| CodeExplainer  | `/api/code-explain`    | 0.004 XLM | development | No                                       |
| DeepResearch   | `/api/agent/research`  | 0.01 XLM  | research    | **Yes** → hires Summarizer + Sentiment   |
| CodingAgent    | `/api/agent/code`      | 0.02 XLM  | development | **Yes** → hires CodeExplainer for review |
| TranslateBot   | `/api/agent/translate` | 0.005 XLM | nlp         | No                                       |

---

## Quick Start

### Prerequisites

- **Node.js 18+**
- **npm** (workspaces support)
- Stellar testnet XLM ([faucet](https://laboratory.stellar.org/#account-creator?network=testnet))

### 1. Install

```bash
git clone <repo-url> && cd mogause
npm run install:all
```

### 2. Configure

```bash
# Backend
cp backend/.env.example backend/.env

# Agent
cp agent/.env.example agent/.env
```

### 3. Run

```bash
# Terminal 1: Backend (port 4002)
cd backend && npm run dev

# Terminal 2: Frontend (port 3000)
cd frontend && npm run dev

# Terminal 3 (optional): CLI Agent
cd agent && npm start
```

Visit **http://localhost:3000** → the mogause dashboard.

---

## Docker Deployment (Ubuntu + CI/CD)

This repo now includes production Docker + GitHub Actions deployment for backend and agent.

### Included deployment files

- `Dockerfile.backend`
- `Dockerfile.agent`
- `.github/workflows/deploy.yml`
- Root env templates:
  - `.env.backend.example`
  - `.env.agent.example`
  - `.env.frontend.example`

### Server env file layout

Create these files on your Ubuntu server:

- `/home/ubuntu/mogause/.env.backend`
- `/home/ubuntu/mogause/.env.agent`
- `/home/ubuntu/mogause/.env.frontend` (optional unless frontend is containerized)

The CI workflow mounts them into containers as `/app/.env`.

### Deployment behavior

On push to `main`, GitHub Actions:

1. Builds and pushes:
   - `${DOCKER_USERNAME}/mogause-backend:latest`
   - `${DOCKER_USERNAME}/mogause-agent:latest`
2. SSHes into Ubuntu
3. Pulls images and runs:
   - `mogause-backend` (port mapping `8080 -> 4002`)
   - `mogause-agent` (headless mode via `AGENT_DAEMON_MODE=true`)

Access backend publicly via:

- `http://<server-public-ip>:8080`

---

## Frontend Static Build Output

Frontend is configured for static export and produces a deployable `build/` folder:

```bash
cd frontend
npm run build
```

After completion, deploy files from:

- `frontend/build/`

---

## Demo Flow

1. **Chat**: Type _"Research quantum computing and summarize the findings"_
2. **Watch**: Manager plans → hires Research Agent (0.01 XLM) → Research recursively hires Summarizer (0.003 XLM) + Sentiment (0.002 XLM)
3. **See**: Live topology graph pulses with payment flows, Transaction Log shows A2A depth, Protocol Trace reveals raw 402 headers
4. **Verify**: Every payment links to the Stellar Explorer

---

## Project Structure

```
├── contracts/
│   └── src/AgentRegistry.sol   # EVM on 0G-Galileo-Testnet; see contracts/deployments/galileo-16602.json
├── backend/
│   └── src/index.ts           # Express server, x402 middleware, Manager Agent
├── agent/
│   └── src/agent.ts           # CLI agent with autonomous hiring logic
├── frontend/
│   └── src/
│       ├── app/page.tsx       # Main dashboard
│       └── components/
│           ├── EconomyGraph.tsx    # Live canvas topology
│           ├── AgentChat.tsx       # Chat + SSE execution steps
│           ├── TransactionLog.tsx  # Payment log with A2A badges
│           ├── ToolCatalog.tsx     # Agent marketplace cards
│           ├── ProtocolTrace.tsx   # x402 header transparency
│           ├── ExecutionSteps.tsx  # Step-by-step execution
│           └── WalletInfo.tsx      # Wallet/network status
└── package.json               # Monorepo root (npm workspaces)
```

---

## Smart Contract

The **Solidity `AgentRegistry`** on **0G-Galileo-Testnet** (chain id **16602**) manages:

- Agent registration with categories and pricing (native 0G for escrow)
- Job lifecycle (create → complete) with on-chain reputation updates
- Reputation scoring (basis points, +50 on success; constants mirror the former Soroban spec)
- Category leadership placeholder and marketplace statistics in the app layer

Deployed address (testnet): `0xe27bCA717aA803dBc1AB3989a915507ddfbbFb4D` — [ChainScan](https://chainscan-galileo.0g.ai/address/0xe27bCA717aA803dBc1AB3989a915507ddfbbFb4D).

The **backend** loads live registry state over `EVM_RPC_URL`: it indexes `AgentRegistered` logs, then calls `getAgent` / `getEfficiencyScore` per address, and returns that as `onChain` on `GET /api/registry` and `GET /api/stats` (45s in-process cache). The **frontend** agents page and **Economy** graph use that payload; the **agent** CLI `registry` command prints both marketplace agents and EVM-registered rows.

---

## Tech Stack

| Layer            | Technology                                     |
| ---------------- | ---------------------------------------------- |
| Blockchain       | 0G-Galileo-Testnet (EVM), Solidity `AgentRegistry`   |
| Payment Protocol | x402 (HTTP 402) + Stellar MPP/mppx settlement (XLM) where configured |
| Backend          | Express.js, TypeScript, SSE                    |
| LLM              | Groq (llama-3.3-70b) → Google Gemini 2.0 Flash |
| Frontend         | Next.js 16, React 19, Canvas API               |
| Agent            | TypeScript CLI, Axios + x402 wrapper           |
| Tokens           | 0G (native on 0G-Galileo-Testnet); app may still use XLM for MPP        |

---

**Built for Stellar Hacks: Agent Hackathon** · Autonomous. On-chain. Systemic.
