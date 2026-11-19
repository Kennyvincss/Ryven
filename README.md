# RYYVEN

**Launch Tokens. Deploy Agents. Automate Economies.**

Ryyven is a Solana token launchpad where every token can deploy an **autonomous AI
agent with its own treasury, spending limits and the ability to execute real USDC
payments**, without ever handing an LLM (or the server) unrestricted access to funds.

> UBC 2026 Hackathon · Agentic Payments & AI · **Solana mainnet** (real SOL and USDC)

## Why it's different

| Layer | Enforces |
|---|---|
| **Solana (SPL Token)** | The agent's key is only a *delegate* over a treasury **the creator owns**. The chain refuses any transfer above the allowance. The creator can revoke it or withdraw at any time. |
| **Ryyven policy engine** (deterministic TypeScript) | Max per payment, autonomous-approval threshold, daily limit, recipient allowlist, categories, duplicate detection, pause / platform kill switch, idempotency |
| **Claude (AI)** | Interprets instructions and *proposes* payments through tools. Has no keys and no tool to change limits, approve or unpause. |

## What works today

- Wallet connect (Phantom, Solflare, Backpack, any Wallet Standard wallet) + Sign-In With Solana
- Token launch: Token-2022 mint with on-chain metadata, fixed supply, verified on-chain before listing
- Agent deployment with encrypted per-agent signing key and a deterministic treasury address
- Treasury funding, on-chain allowance, revoke (kill switch), withdraw, community deposits
- AI instruction terminal (Claude tool use) with live status streaming
- Autonomous & approval modes, approval queue, manual payments through the same engine
- Real USDC transfers, signature persisted before broadcast, on-chain verification of every payment (proven end-to-end in test mode, see `docs/ARCHITECTURE.md`)
- Token & agent discovery, public agent profiles, user dashboard, admin monitor with global kill switch
- Optional **pump.fun launches on Solana mainnet** (real SOL) via PumpPortal: coins show on pump.fun (setup: `docs/SETUP.md` §6)
- **SOL payments**: agents send plain SOL from a creator-owned (wrapped-SOL) treasury under a capped on-chain allowance
- **Rewards in your own token**: agents can pay contributors in the launched token (e.g. $DOGE2) from a second creator-owned treasury with its own limits
- Agent can read **token holders, supply and any wallet's balances**
- Optional **agent trading on pump.fun** (mainnet, real SOL): *proposal* mode (you sign each trade) or *autonomous* mode (agent trades from its own funded wallet within strict limits) (`docs/SETUP.md` §7)

- **Token swaps via Jupiter** (mainnet): the agent swaps SOL / USDC / USDT / its own coin / allowlisted coins under the same trading limits, validated and simulated before signing
- **Wallet analysis & daily brief**: ask the agent anytime to analyse your wallet (USD value, allocation, risk flags, recent activity) and suggest ideas; optionally get a scheduled daily brief in the console
- **Live terminal** (`/live`): pump.fun coins in three live columns (new pairs, about to graduate, graduated) with one-click quick buy; every coin has a trading page with a live chart, live trades and Buy/Sell from your own wallet
- **Price alerts**: ask the agent to alert you when a token's price or market cap crosses a level or moves X% (checked every minute; console banner + browser notification)
- **AI agents for pump.fun coins on mainnet**, paying in real USDC (explicit real-money confirmation required)

**Not yet implemented** (clearly marked in the UI): bonding-curve trading for Ryyven coins
(program source in `onchain/`, needs to be deployed), recurring/scheduled campaigns, DEX migration.

## Quick start

```bash
npm install
cp .env.example .env    # then follow docs/SETUP.md
npm run keys            # generates secrets
npm run db:migrate
npm run dev
```

- **Setup for beginners:** [`docs/SETUP.md`](docs/SETUP.md)
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Judge demo script:** [`docs/DEMO.md`](docs/DEMO.md)

## Tests

```bash
npm test                          # policy engine + LiteSVM on-chain guarantees
npx tsx scripts/e2e-devnet.ts     # full end-to-end test (test mode only; refuses to run on mainnet)
```
