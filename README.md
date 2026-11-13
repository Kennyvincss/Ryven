# RYVEN

**Launch Tokens. Deploy Agents. Automate Economies.**

Ryven is a Solana token launchpad where every token can deploy an **autonomous AI
agent with its own treasury, spending limits and the ability to execute real USDC
payments**, without ever handing an LLM (or the server) unrestricted access to funds.

> UBC 2026 Hackathon · Agentic Payments & AI · Solana devnet

## Why it's different

| Layer | Enforces |
|---|---|
| **Solana (SPL Token)** | The agent's key is only a *delegate* over a treasury **the creator owns**. The chain refuses any transfer above the allowance. The creator can revoke it or withdraw at any time. |
| **Ryven policy engine** (deterministic TypeScript) | Max per payment, autonomous-approval threshold, daily limit, recipient allowlist, categories, duplicate detection, pause / platform kill switch, idempotency |
| **Claude (AI)** | Interprets instructions and *proposes* payments through tools. Has no keys and no tool to change limits, approve or unpause. |

## What works today

- Wallet connect (Phantom, Solflare, Backpack, any Wallet Standard wallet) + Sign-In With Solana
- Token launch: Token-2022 mint with on-chain metadata, fixed supply, verified on-chain before listing
- Agent deployment with encrypted per-agent signing key and a deterministic treasury address
- Treasury funding, on-chain allowance, revoke (kill switch), withdraw, community deposits
- AI instruction terminal (Claude tool use) with live status streaming
- Autonomous & approval modes, approval queue, manual payments through the same engine
- Real USDC transfers on devnet, signature persisted before broadcast, on-chain verification of every payment
- Token & agent discovery, public agent profiles, user dashboard, admin monitor with global kill switch

**Not yet implemented** (clearly marked in the UI): bonding-curve trading (program source in
`onchain/`, needs to be deployed), recurring/scheduled campaigns, DEX migration.

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
npx tsx scripts/e2e-devnet.ts     # full demo against a running server on devnet
```
