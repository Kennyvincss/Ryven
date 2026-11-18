# RYVEN: Architecture

> **Launch Tokens. Deploy Agents. Automate Economies.**
> Category: Agentic Payments & AI · Chain: **Solana mainnet** · Payment asset: USDC (SPL)
>
> Network: the app runs on mainnet by default (`APP_NETWORK`). A hidden test mode
> (`NEXT_PUBLIC_SOLANA_CLUSTER=devnet`) exists only for the automated end-to-end test.

Ryven is a token launchpad where every token can deploy an AI agent with its own
treasury, spending limits and the ability to execute real USDC payments on Solana,
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
│ PostgreSQL     │            │ Solana mainnet                    │
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
`bigint` base units (USDC = 6 decimals), never floats.

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
| Solana mainnet RPC | all chain reads/writes | yes | public `https://api.mainnet-beta.solana.com` (rate-limited) or a Helius/QuickNode/Triton URL (recommended) |
| Anthropic Claude API | agent reasoning + tool use | yes, for the AI terminal | console.anthropic.com → API Keys |
| PostgreSQL | app data | yes | local Postgres, or Supabase (Project → Settings → Database → connection string) |
| PumpPortal | builds pump.fun create transactions (mainnet) | only for pump.fun launches | no key needed (https://pumpportal.fun/creation) |
| Pinata (IPFS) | token image + metadata pinning | optional (required for pump.fun) | app.pinata.cloud → API Keys → JWT. Without it, metadata is served by the app (clearly labelled) |
| USDC (Circle, mainnet `EPjFW…t1v`) | treasury asset | yes | buy/swap in any wallet or exchange |
| SOL | fees, rent, launches | yes | buy in any wallet or exchange |

## 5. Blockchain architecture

Programs used:

| Program | Address | Role |
|---|---|---|
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | USDC treasury, delegated allowance, transfers |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | launched tokens with on-chain metadata extension |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | recipient USDC accounts |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | tags every agent payment with `ryven:pay:<paymentId>` |
| ryven_curve (Anchor) | set via `NEXT_PUBLIC_CURVE_PROGRAM_ID` | bonding-curve buy/sell: **source included, not deployed** |

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

### Token rewards (second treasury)

An agent can also pay in its **own launched token** (e.g. $DOGE2). It uses the same delegated
model with a second creator-owned treasury (`asset = "token"`, Token-2022, seed `"ryt…"`),
its own on-chain allowance and its own limits (`token_max_per_tx`, `token_daily_limit`,
`token_auto_approve_limit`). Payments, approvals, verification and idempotency are shared;
every payment row records its `asset`, `symbol` and `decimals`.

### SOL payments (third treasury)

Native SOL can't be delegated, so the SOL treasury is a creator-owned **wrapped-SOL** token
account (seed `"rys…"`) with the agent as capped delegate. Each payment is one atomic
transaction: the fee payer creates a temporary wrapped-SOL account, the agent (as delegate)
moves the amount into it, it is closed (unwrapped) to the fee payer, and the fee payer
forwards exactly that amount of **plain SOL** to the recipient (+ memo). The fee payer ends
where it started minus network fees; Solana still enforces the allowance. Minimum 0.001 SOL.
Verified in LiteSVM and end-to-end (e2e step 10).

### Agent trading on pump.fun (mainnet)

| Mode | Who signs | Funds at risk |
|---|---|---|
| `off` | n/a | none |
| `proposal` | the creator, in their own wallet | only what the creator approves per trade |
| `autonomous` | the agent's key, as its **own mainnet trading wallet** | whatever the creator sent to that wallet |

Every trade passes: deterministic policy (`trade-policy.ts`: mode, coin allowlist, SOL per
trade, daily SOL, wallet balance + fee reserve, pauses) → PumpPortal builds the transaction
→ **program allowlist + single-signer check** → **mainnet simulation measuring the exact
SOL the wallet would lose** (refused above amount × 1.1 + 0.01 SOL) → sign → send → confirm →
record the real SOL change. The creator can drain the trading wallet back to themselves at
any time (fixed-destination withdrawal). Autonomous mode means a server-held hot key controls
real SOL; the UI makes the creator acknowledge this.

### Token swaps (Jupiter, mainnet)

`swap_tokens` swaps any pair among SOL, USDC, USDT, the agent's own coin and the creator's
trading allowlist through the Jupiter aggregator (`src/lib/server/jupiter.ts`), in the same
proposal/autonomous modes as trading. Pipeline: resolve both mints → Jupiter quote → value the
swap in SOL (exact if SOL is in or out, else Jupiter's USD value ÷ Pyth SOL/USD) → the same
deterministic trading policy (allowed tokens, SOL per trade, daily SOL shared with buys) →
Jupiter builds a v0 transaction → **validation**: one signer (the swapping wallet), top-level
programs limited to ComputeBudget/ATA/System/Token/Jupiter router, and System/Token/ATA
instructions may only wrap/unwrap the wallet's *own* SOL (no top-level transfer to anyone) →
**mainnet simulation** refusing it if more input token than quoted, or more SOL than (input if
SOL) + 0.01 SOL, would leave the wallet → sign → send → confirm → record the amount actually
received. Swaps are re-quoted at signing time with the originally proposed input amount.

### Wallet analysis and daily brief (read-only)

`analyze_portfolio` (`src/lib/server/portfolio.ts`) reads a mainnet wallet's balances
(merged per mint), prices every holding in one batched Jupiter token-API call (name, USD
price, liquidity, market cap, 24h change, mint/freeze authority, top-holder share), falls back
to the on-chain pump.fun curve / DexScreener for a few unpriced coins, and optionally parses
the last 8 transactions (swap / received / sent). Deterministic rules (`portfolio-rules.ts`,
unit-tested) compute allocation and raise flags: concentration, low SOL for fees, no
stablecoin buffer, low liquidity, ±24h moves, live authorities, holder concentration, dust,
unknown airdrops. Stablecoins are identified by mint (or Jupiter-verified), never by symbol.

The **daily brief** (`ai/brief.ts`) runs that analysis on the creator's wallet (plus the
trading wallet in autonomous mode), compares it with the previous brief and has Claude write
a short snapshot, risks and 2-4 ideas, stored in `wallet_briefs`. It never trades or pays.
Scheduling: an in-process timer (every 10 min, `instrumentation-node.ts`) or
`GET /api/cron/briefs` with `CRON_SECRET` for hosts without a long-running process. Each
agent is claimed atomically (`brief_last_at` updated before generating), so overlapping runs
or several instances never produce duplicates.

### Price alerts

`set_price_alert` / `list_price_alerts` / `cancel_price_alert` (`src/lib/server/alerts.ts`,
table `price_alerts`). Conditions: price or market cap (USD) above/below a level, or rises /
falls X% — percentage alerts are turned into a fixed target from the live value when set
(`alert-rules.ts`, unit-tested), and a level that's already passed is refused. A checker
runs every minute (in-process timer, never overlapping; or `GET /api/cron/alerts` with
`CRON_SECRET`), prices all watched mints in one batched Jupiter call (pump.fun curve /
DexScreener fallback) and fires each alert at most once via an atomic
`active → triggered` update. A fired alert is logged to the activity feed; the console polls
and shows a banner plus an optional browser notification. Alerts never trade. Max 20 active
per agent.

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
* Secrets only in server env vars; `NEXT_PUBLIC_*` contains nothing sensitive. The RPC URL
  (which carries the provider API key) is server-only: browsers use the `/api/rpc` relay
  (method allowlist, size cap, per-IP rate limit).
* Public vs private data: visitors see an agent's profile, spending rules, confirmed payments
  and on-chain facts (launch, deposits, pause/resume). Everything else is creator-only:
  instructions, trading settings, policy decisions, failed/rejected payments, approvals,
  contributors not yet approved, budget usage, briefs, alerts and the private activity log
  (`PUBLIC_ACTIVITY_TYPES` in `engine/activity.ts`).
* In production, error responses are plain messages; setup hints (env vars, commands) and
  provider errors only appear in the server log, or locally in development.
* Global emergency pause (admin) and per-agent pause (creator / agent itself).
* The bonding-curve program is unaudited and not deployed; agent payments only use the standard SPL Token / Token-2022 programs.

## 9. Development roadmap & status

| # | Module | Status |
|---|---|---|
| 1 | Architecture & scaffolding | ✅ |
| 2 | Wallet connect, SIWS auth, balances, history | ✅ (auth flow tested with real ed25519 signatures) |
| 3 | Delegated treasury (fund, allowance, revoke, withdraw, deposits) | ✅ (on-chain guarantees proven in LiteSVM tests) |
| 4 | Payment engine + signer + verification | ✅ unit + LiteSVM tested, and **verified end-to-end on devnet** (`scripts/e2e-devnet.ts`, see below) |
| 5 | AI terminal (Claude tool use) + activity log | ✅ implemented; needs `ANTHROPIC_API_KEY` to run (not exercised with a live key yet) |
| 6 | Approvals, pause, admin kill switch | ✅ |
| 7 | Token launch (Token-2022 + metadata, fixed supply) | ✅ implemented, server-side on-chain verification |
| 8 | Bonding-curve program (`onchain/`) | ⚠️ source compiles (`cargo check`), math unit-tested; **not built for SBF / deployed**; UI does not call it |
| 9 | Discovery pages, dashboards, admin | ✅ responsive (checked at 390px and 1440px) |
| 10 | Recurring/scheduled campaigns | ❌ not implemented: instructions run on demand |
| 11 | DEX migration after graduation | ❌ not implemented |
| 13 | pump.fun launches on mainnet (PumpPortal Local API + Pinata) | ✅ implemented; tested up to mainnet simulation with real PumpPortal transactions. A real mainnet launch costs SOL and hasn't been done from this environment |
| 14 | AI agents for mainnet (pump.fun) coins | ✅ agents, treasuries and payments are per-network (`agents.network`); mainnet uses real USDC (`EPjFW…t1v`) and the mainnet fee payer. Deploy/read/reject paths tested against mainnet; no real mainnet payment executed from this environment |
| 15 | Agent reads holders / supply / wallet balances | ✅ live on devnet (holder fallback via transaction history when the RPC has no token index) |
| 16 | Rewards in the agent's own token | ✅ **verified end-to-end on devnet** (`scripts/e2e-devnet.ts` step 9) + LiteSVM Token-2022 tests |
| 17 | pump.fun trading: proposal + autonomous | ✅ implemented; tested against real PumpPortal + mainnet simulation (policy, allowlist, spend guard, duplicates, withdraw). No real mainnet trade executed from this environment (needs real SOL) |
| 18 | Database auto-migration on dev startup | ✅ |
| 12 | Distributed rate limiting | ❌ in-memory only (single instance) |

### End-to-end run in test mode (devnet, 2026-11-13)

`scripts/e2e-devnet.ts` against a running server, with a labelled Test-USDC mint
(`EuQ8X7hWTG9ZFx5qHofg6tFr747rYwJXcJpSr4mfqTKu`). Every step was a real devnet transaction or API call:

| Step | Result |
|---|---|
| Launch $DOGE2 (Token-2022 + metadata) | [57ncwz…](https://explorer.solana.com/tx/57ncwz5hgskyntSvsmbqvDK7ECbgWiCVq86LQHTYyc7jWpJ2K3oVNFA7xHfiq8YNzw8fJhZjgpzsu4ats9rtA2MV?cluster=devnet) |
| Create treasury, deposit 100, delegate 100 | [3Pdeg1…](https://explorer.solana.com/tx/3Pdeg13ZKom2HfVkKvWzqAHgG6tnatpq9Bp7GiZ88UtoiMnxnBTbUystdpPzC2cFcEony1qV7ccWuee8crNoYNoN?cluster=devnet) |
| Payment 1: 5 USDC (delegate-signed, memo `ryven:pay:<id>`) | [2WEQCv…](https://explorer.solana.com/tx/2WEQCvisQhyY29MQwXQom9bGbJYhXZaohB4F7UaNYm1wbfTiH5MtzCM9uQ16cdmoUyCMGnoyUWn5LjA1tNKGy2UP?cluster=devnet) |
| Payment 2: 5 USDC | [rfFkHo…](https://explorer.solana.com/tx/rfFkHoQKTATyyKGfjrvcfPkBi6wpneUgvKXoXw35tFCsLViKx1BexT7MicqLLWYQYteStgj9CZ7LtNateJzskAu?cluster=devnet) |
| Payment 3: 5 USDC | [51Mxaf…](https://explorer.solana.com/tx/51MxafeX8KVgrSKRNx8B3ryznw7pu6AgjfsKZZURnRYNFvisR2ESPaUxTyuPYznjLAPRD5yLfWyvMEMvEZiYFykc?cluster=devnet) |
| On-chain after | recipients 5 / 5 / 5, treasury 85, allowance 85, daily budget left 5 |
| Negative checks | 10 USDC > max → rejected; unlisted recipient → rejected; repeat recipient → approval; paused → rejected |

The three payments went through the manual route (no `ANTHROPIC_API_KEY` in that
environment), which uses the same policy engine and signer as the AI terminal.

See `docs/SETUP.md` for step-by-step setup and `docs/DEMO.md` for the judge demo.
