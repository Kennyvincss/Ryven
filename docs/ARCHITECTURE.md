# RYVEN — Architecture

> **Launch Tokens. Deploy Agents. Automate Economies.**
> Category: Agentic Payments & AI · Chain: Solana (Devnet) · Payment asset: USDC (SPL)

Ryven is a token launchpad where every token can deploy an AI agent with its own
treasury, spending limits and the ability to execute real USDC payments on Solana —
without ever giving the AI (or the server) unrestricted access to anyone's funds.

This document covers, in order:

1. [System architecture](#1-system-architecture)
2. [Project folder structure](#2-project-folder-structure)
3. [Database schema](#3-database-schema)
4. [External integrations](#4-external-integrations)
5. [Blockchain architecture](#5-blockchain-architecture)
6. [Agent wallet architecture](#6-agent-wallet-architecture-the-delegated-treasury)
7. [Payment execution architecture](#7-payment-execution-architecture)
8. [Security model](#8-security-model)
9. [Development roadmap & status](#9-development-roadmap--status)

---

## 1. System architecture

```
┌──────────────────────────── Browser ─────────────────────────────┐
│ Next.js (React 19) UI · Tailwind · Solana Wallet Adapter          │
│  • wallet signs: token launch, treasury funding, allowance,       │
│    revoke (kill switch), trades, sign-in message                  │
│  • never sees: agent keys, fee-payer key, LLM key                 │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS (session cookie = signed JWT after SIWS)
┌───────────────▼──────────────── Next.js server (Node) ───────────┐
│ API routes                                                        │
│  ├─ auth/       Sign-In-With-Solana (nonce + ed25519 verify)      │
│  ├─ tokens/     verify launch tx on-chain → record token          │
│  ├─ agents/     deploy, config, contributors, treasury            │
│  ├─ agents/:id/terminal  ── AI Orchestrator (Claude tool use)     │
│  │                              │ proposes payments only          │
│  │                              ▼                                 │
│  │                   ┌──── Payment Engine (deterministic) ────┐   │
│  │                   │ policy → reserve → approve → execute   │   │
│  │                   │ idempotency · daily budget · allowlist │   │
│  │                   └───────────────┬────────────────────────┘   │
│  │                                   ▼                            │
│  │                   ┌──── Signer (isolated module) ──────────┐   │
│  │                   │ decrypts agent key (AES-256-GCM) only  │   │
│  │                   │ to sign an engine-built USDC transfer  │   │
│  │                   └───────────────┬────────────────────────┘   │
│  ├─ approvals/  creator approve / reject                          │
│  └─ admin/      RBAC (ADMIN_WALLETS) · global payment pause       │
└───────┬──────────────────────────────┬───────────────────────────┘
        │ SQL                          │ JSON-RPC
┌───────▼────────┐            ┌────────▼──────────────────────────┐
│ PostgreSQL     │            │ Solana Devnet                     │
│ (Supabase ok)  │            │  SPL Token · Token-2022 · Memo ·  │
│ records + logs │            │  Associated Token Account ·       │
│ NOT proof of   │            │  ryven_curve (Anchor, optional)   │
│ funds          │            └───────────────────────────────────┘
└────────────────┘
```

**Separation of concerns (the core idea):**

| Layer | Can do | Cannot do |
|---|---|---|
| LLM (Claude) | read treasury/contributors/payments, *propose* payments, pause agent | sign, see keys, change limits, approve, unpause, choose arbitrary programs |
| Payment engine | validate proposals against deterministic policy, reserve budget, queue approvals | exceed on-chain allowance, spend from anything but the treasury |
| Signer | sign one specific USDC `TransferChecked` (+ ATA create + Memo) built by the engine | sign arbitrary transactions (builder is fixed, no generic `sign(tx)` API) |
| Solana (SPL Token) | enforce allowance cap, mint, ownership; creator can revoke instantly | — |

## 2. Project folder structure

```
Ryven/
├─ docs/                    ARCHITECTURE.md, SETUP.md, DEMO.md
├─ drizzle/                 generated SQL migrations
├─ onchain/                 Anchor workspace (bonding curve program)
│  └─ programs/ryven-curve/ Rust source
├─ scripts/                 setup helpers (keygen, test-USDC mint, db seed)
├─ src/
│  ├─ app/                  Next.js App Router pages + API routes
│  │  ├─ page.tsx           landing
│  │  ├─ tokens/            discovery + [mint] dashboard
│  │  ├─ agents/            discovery + [id] public profile
│  │  ├─ launch/            token launch wizard
│  │  ├─ dashboard/         user dashboard
│  │  ├─ console/[id]/      creator console (terminal, treasury, approvals)
│  │  ├─ admin/             admin monitor
│  │  └─ api/               route handlers
│  ├─ components/           UI components
│  ├─ lib/
│  │  ├─ shared/            isomorphic: constants, curve math, formatting
│  │  ├─ solana/            client tx builders (launch, treasury, curve)
│  │  └─ server/            server-only: db, auth, engine, signer, ai
│  └─ styles/
├─ tests/                   vitest unit + LiteSVM transaction tests
├─ .env.example
└─ drizzle.config.ts
```

## 3. Database schema

PostgreSQL via Drizzle ORM (`src/lib/server/db/schema.ts`). Amounts are stored as
`bigint` base units (USDC = 6 decimals) — never floats.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `users` | wallet identities | `wallet` **unique**, `created_at` |
| `auth_nonces` | SIWS replay protection | `nonce` PK, `wallet`, `expires_at`, `used_at` |
| `tokens` | launched tokens | `mint` **unique**, `creator_wallet` (idx), `name`, `symbol`, `description`, `image_uri`, `metadata_uri`, `launch_mode`, `launch_status`, `launch_signature`, `socials` jsonb |
| `token_trades` | verified curve trades | `signature` **unique**, `token_id` (idx), `side`, `sol_amount`, `token_amount`, `trader` |
| `token_metadata_blobs` | app-hosted metadata/images when IPFS not configured | `id`, `content_type`, `bytes` |
| `agents` | agent identity + policy | `token_id` FK **unique** (one agent per token), `name`, `personality`, `objectives`, `instructions`, `status` (`active`/`paused`), `mode` (`autonomous`/`approval`), `max_per_tx`, `auto_approve_limit`, `daily_limit`, `categories[]`, `recipient_policy`, `signer_pubkey` **unique** |
| `agent_signers` | encrypted agent keys (server only) | `agent_id` PK/FK, `ciphertext`, `iv`, `auth_tag`, `key_version` |
| `treasuries` | treasury account per agent | `agent_id` **unique**, `address` **unique**, `mint`, `seed`, `owner_wallet`, cached `last_balance` / `last_allowance` (display cache only), `total_deposits`, `total_spent` |
| `treasury_deposits` | verified deposits | `signature` **unique**, `amount`, `from_wallet` |
| `contributors` | approved recipient registry | (`agent_id`,`wallet`) **unique**, `handle`, `role`, `status`, `note`, `activity_score` |
| `payments` | every payment intent | `idempotency_key` **unique**, `agent_id` (idx), `recipient`, `amount`, `mint`, `category`, `reason`, `status` (idx), `signature` **unique**, `policy_decision` jsonb, `error`, `instruction_id`, `executed_at`, `confirmed_at` |
| `approvals` | creator decisions | `payment_id` **unique**, `status`, `approver_wallet`, `decided_at` |
| `agent_activities` | structured activity log | `agent_id`+`created_at` (idx), `type`, `status`, `message`, `data` jsonb, `instruction_id` |
| `agent_messages` | terminal conversation | `agent_id`, `role`, `content` jsonb |
| `platform_settings` | global kill switch etc. | `key` PK, `value` jsonb |

Relationships: `tokens 1─1 agents 1─1 treasuries`, `agents 1─n payments 1─1 approvals`,
`agents 1─n contributors / agent_activities / agent_messages`.

**The database is never proof of funds.** Treasury balance and remaining allowance are
always read from the SPL token account on-chain; payments are marked `confirmed` only
after the transaction is fetched from the chain and its token-balance deltas match.

## 4. External integrations

| Service | Used for | Required? | Where to get it |
|---|---|---|---|
| Solana Devnet RPC | all chain reads/writes | yes | public `https://api.devnet.solana.com` (rate-limited) or Helius/QuickNode/Triton devnet URL |
| Anthropic Claude API | agent reasoning + tool use | yes, for the AI terminal | console.anthropic.com → API Keys |
| PostgreSQL | app data | yes | local Postgres, or Supabase (Project → Settings → Database → connection string) |
| Pinata (IPFS) | token image + metadata pinning | optional | app.pinata.cloud → API Keys → JWT. Without it, metadata is served by the app (clearly labelled) |
| Circle devnet USDC | treasury asset | yes (or Test USDC) | faucet.circle.com (Solana Devnet). Alternatively `scripts/create-test-usdc.ts` creates a *labelled* Test-USDC mint with a faucet |
| Solana faucet | devnet SOL for fees | yes | faucet.solana.com |

## 5. Blockchain architecture

Programs used:

| Program | Address | Role |
|---|---|---|
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | USDC treasury, delegated allowance, transfers |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | launched tokens with on-chain metadata extension |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | recipient USDC accounts |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | tags every agent payment with `ryven:pay:<paymentId>` |
| ryven_curve (Anchor) | set via `NEXT_PUBLIC_CURVE_PROGRAM_ID` | bonding-curve buy/sell — **source included, deploy required** |

**Token launch** (wallet-signed, Token-2022): create mint account with
`MetadataPointer` → initialize mint (6 decimals) → initialize `TokenMetadata`
(name, symbol, uri) → create creator ATA → mint initial supply → **revoke mint
authority** (fixed supply). The server then fetches the transaction and the mint
account from the chain and only records the token if they match.

**Bonding curve** (`onchain/programs/ryven-curve`): pump-style constant-product curve
over *virtual* reserves (`x·y = k`), SOL in / tokens out, slippage limits on every
trade, 1% fee, `complete` flag when the curve's real token reserve is exhausted
(graduation). DEX migration after graduation is out of scope for the MVP.

## 6. Agent wallet architecture: the Delegated Treasury

The problem: an agent needs to pay people on its own, but must never be able to
drain funds, and the creator should never hand their wallet to a server or an LLM.

The solution uses only the audited **SPL Token program**, so there's no custom contract
holding user USDC:

```
 Creator wallet (owner) ──owns──▶ Treasury token account (USDC mint only)
        │                              │  delegate = Agent signer key
        │  approve(allowance)          │  delegated_amount = allowance  ◀── enforced on-chain
        │  revoke()  = KILL SWITCH     │
        │  withdraw anytime            ▼
        │                     Agent signer (server, encrypted at rest)
        │                              │ TransferChecked ≤ allowance
        │                              ▼
        │                     Recipient USDC ATA
```

* **Treasury address** = `createAccountWithSeed(base = creator, seed = "ryv:<agent>", program = SPL Token)`.
  Deterministic, owned by the **creator**: the creator can withdraw or close it at any time.
* **Agent signer** = a fresh ed25519 keypair per agent, generated server-side,
  encrypted with AES-256-GCM (`AGENT_KEY_ENCRYPTION_KEY`), stored in `agent_signers`,
  and never returned by any API. It holds **no funds and no SOL**.
* **Allowance** = SPL `ApproveChecked(treasury → agent signer, amount)`. The Solana
  runtime refuses any transfer above the remaining `delegated_amount`. Even a fully
  compromised server can't spend more than the creator approved, from any account
  other than the treasury, or in any token other than USDC.
* **Kill switch**: (a) *Pause* (instant, off-chain: engine refuses everything);
  (b) *Revoke* (on-chain, creator-signed `Revoke`: the agent key loses all authority).
* **Fees**: a platform fee-payer key pays SOL fees and recipient-ATA rent so agents
  never need SOL.

On-chain guarantees: total cap, mint, source account, creator custody, revocation.
Engine guarantees (deterministic TypeScript, not the LLM): per-tx max,
autonomous-approval threshold, daily limit, recipient allowlist, categories,
duplicate prevention, pause.

## 7. Payment execution architecture

```
instruction ─▶ Claude (tool: propose_payments) ─▶ ENGINE
                                                  │ 1 validate schema + recipient pubkey
                                                  │ 2 global pause? agent paused?
                                                  │ 3 category allowed?
                                                  │ 4 recipient in approved registry?
                                                  │ 5 amount ≤ max_per_tx?
                                                  │ 6 idempotency key unique? (instruction+recipient)
                                                  │ 7 duplicate in 24h → force approval
                                                  │ 8 (advisory lock per agent)
                                                  │   today_spent + amount ≤ daily_limit?
                                                  │ 9 on-chain balance & allowance ≥ reserved?
                                                  ▼
                       rejected ◀── decision ──▶ awaiting_approval ──creator──▶ approved
                                                  │ (autonomous & ≤ threshold)
                                                  ▼
                                               approved
                                                  │ atomic claim: UPDATE … WHERE status='approved'
                                                  ▼
                                               executing ── build fixed tx (ATA idempotent,
                                                  │          TransferChecked, Memo) → sign
                                                  │          → store signature BEFORE send
                                                  ▼
                                           send + confirm ─▶ fetch tx, verify deltas
                                                  ▼
                                       confirmed (Explorer link) | failed (reason)
```

* **Idempotency**: `idempotency_key = sha256(agent | instruction | recipient)` with a
  unique index, so retries of the same instruction can't create a second payment.
* **No double send**: execution is claimed with a conditional `UPDATE`, and the
  signature is persisted before broadcast. A crash mid-flight is reconciled by
  `getSignatureStatuses`; a payment is only marked failed when its blockhash has
  expired without landing.
* **Verification**: after confirmation the engine fetches the transaction and checks
  that the recipient's USDC balance delta equals the amount. Only then: `confirmed`.
* **Approvals re-check policy** (pause, daily limit, balance) at approval time.

## 8. Security model

* Sign-In With Solana: server nonce → wallet `signMessage` → ed25519 verify →
  httpOnly JWT cookie (HS256, `SESSION_SECRET`). Nonces are single-use, 5-minute TTL.
* Server-side authorization on every mutation (creator-only for agent config,
  approvals, contributors; `ADMIN_WALLETS` allowlist for admin).
* The LLM's tools are an allowlist; none of them change limits, approve, unpause
  or sign. Tool inputs are re-validated with zod in the engine (`strict: true` schemas).
* Rate limiting on auth, terminal and payment routes.
* Secrets only in server env vars; `NEXT_PUBLIC_*` contains nothing sensitive.
* Global emergency pause (admin) and per-agent pause (creator / agent itself).
* Custom programs (bonding curve) are devnet-only and unaudited. Never use them with real funds.

## 9. Development roadmap & status

| # | Module | Status |
|---|---|---|
| 1 | Architecture & scaffolding | ✅ |
| 2 | Wallet connect, SIWS auth, balances | ✅ |
| 3 | Delegated treasury (fund, allowance, revoke, withdraw) | ✅ |
| 4 | Payment engine + signer + verification | ✅ |
| 5 | AI terminal (Claude tool use) + activity log | ✅ |
| 6 | Approvals, pause, admin kill switch | ✅ |
| 7 | Token launch (Token-2022 + metadata) | ✅ |
| 8 | Bonding curve program | ⚠️ source written & `cargo check`ed; **needs deploy** (see SETUP.md) |
| 9 | Discovery pages, dashboards | ✅ |
| 10 | Recurring/scheduled campaigns | ❌ not implemented: instructions run on demand |
| 11 | DEX migration after graduation | ❌ not implemented |

See `docs/SETUP.md` for step-by-step setup and `docs/DEMO.md` for the judge demo.
