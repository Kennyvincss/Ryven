# Ryven setup guide (beginner friendly)

This guide assumes no backend or blockchain experience. Follow it top to bottom.
It takes about 20 minutes. Everything runs on **Solana devnet**, where coins are free test
coins with no real value.

---

## 0. What you need installed

| Tool | Why | How to get it |
|---|---|---|
| **Node.js 20+** (22 recommended) | runs the app | https://nodejs.org → download the LTS installer |
| **PostgreSQL 15+** | the app's database | Local: https://www.postgresql.org/download/ **or** a free hosted DB at https://supabase.com |
| **Phantom** or **Solflare** browser extension | your wallet | https://phantom.app / https://solflare.com |
| **Git** | to download the code | https://git-scm.com |

Check Node is installed by opening a terminal and running:

```bash
node -v
```

You should see `v20` or higher.

---

## 1. Download and install

```bash
git clone https://github.com/kennyvincss/Ryven.git
```

```bash
cd Ryven
```

```bash
npm install
```

---

## 2. Create your `.env` file

The `.env` file holds your settings and secrets. It is **never** committed to Git.

```bash
cp .env.example .env
```

Open `.env` in any text editor. Fill it in using the steps below.

### 2a. Generate the server secrets

```bash
npm run keys
```

This prints three lines (`SESSION_SECRET=…`, `AGENT_KEY_ENCRYPTION_KEY=…`,
`FEE_PAYER_SECRET_KEY=…`) plus a **fee payer public address**. Paste the three lines
into `.env`, replacing the empty ones.

> **Keep `AGENT_KEY_ENCRYPTION_KEY` safe.** It encrypts every agent's signing key. If you
> lose it, existing agents can no longer make payments (their funds stay safe in the
> creator's treasury, and the creator can still withdraw).

### 2b. Fund the fee payer with devnet SOL

The fee payer pays the tiny network fees (~0.000005 SOL) for agent payments.

1. Copy the **fee payer public address** printed by `npm run keys`.
2. Go to https://faucet.solana.com, paste the address, choose **Devnet**, request 1 SOL.

### 2c. Database

**Option A: local Postgres.** Create a database and user:

```bash
psql -U postgres -c "CREATE USER ryven WITH PASSWORD 'ryven' CREATEDB;"
```

```bash
psql -U postgres -c "CREATE DATABASE ryven OWNER ryven;"
```

Then in `.env`: `DATABASE_URL=postgres://ryven:ryven@localhost:5432/ryven`

**Option B: Supabase (no install).** Create a project at https://supabase.com →
*Project Settings → Database → Connection string → URI*. Copy it (replace `[YOUR-PASSWORD]`)
into `DATABASE_URL`.

Create the tables:

```bash
npm run db:migrate
```

### 2d. AI key (Anthropic Claude)

1. Go to https://console.anthropic.com → sign up → **API Keys** → **Create Key**.
2. Paste it into `.env` as `ANTHROPIC_API_KEY=sk-ant-…`.

Without this key the app still works, but the agent terminal will tell you AI is not
configured. You can still send payments manually through the same policy engine.

### 2e. Devnet USDC

Agents pay in USDC. On devnet you have two options:

- **Circle devnet USDC (recommended, default):** go to https://faucet.circle.com, pick
  **Solana Devnet**, paste *your Phantom wallet address*, and request USDC. Leave
  `NEXT_PUBLIC_USDC_MINT` at its default.
- **Your own "Test USDC":** if the Circle faucet doesn't work for you, run

  ```bash
  npm run test-usdc
  ```

  and copy the printed lines into `.env` (`NEXT_PUBLIC_USDC_MINT`,
  `TEST_USDC_FAUCET_ENABLED=true`, and `TEST_USDC_MINT_AUTHORITY_SECRET_KEY` set to the same
  value as `FEE_PAYER_SECRET_KEY`). The dashboard then shows a **Get 100 Test USDC**
  button. The UI labels this currency "Test USDC" so nobody mistakes it for Circle's.

### 2f. Admin access (optional)

Put your wallet address in `ADMIN_WALLETS=` to unlock `/admin` (global payment kill switch).

---

## 3. Run it

```bash
npm run dev
```

Open http://localhost:3000.

### Set your wallet to devnet

- **Phantom:** Settings → Developer Settings → *Testnet Mode* ON → Solana **Devnet**.
- **Solflare:** Settings → Network → **Devnet**.

Get devnet SOL for your own wallet at https://faucet.solana.com (you need ~0.05 SOL to
launch a token and create a treasury).

---

## 4. Check everything works

```bash
npm test
```

This runs the policy-engine tests and the LiteSVM tests that execute Ryven's real
treasury transactions against the real SPL Token program.

Full end-to-end on devnet (needs the Test-USDC setup from 2e and a funded fee payer):

```bash
npm run dev
```

Then, in a second terminal:

```bash
npx tsx scripts/e2e-devnet.ts
```

---

## 5. Deploying (e.g. Vercel + Supabase)

1. Push the repo to GitHub, import it at https://vercel.com/new.
2. In Vercel → *Settings → Environment Variables*, add every variable from your `.env`.
   Set `NEXT_PUBLIC_APP_URL` to your Vercel URL.
3. Use a hosted Postgres (Supabase / Neon) for `DATABASE_URL`; run `npm run db:migrate`
   once from your computer against it.
4. Note: the built-in rate limiter is in-memory (per server instance). For multi-instance
   production, back it with Redis.

---

## 6. Optional: launch coins on pump.fun (mainnet, real SOL)

This adds a **"pump.fun · mainnet"** choice on the Launch page. Coins launched this way
are created by pump.fun's own program (through PumpPortal's API) on Solana **mainnet**, so
they appear on pump.fun. **It costs real SOL** (about 0.02–0.03 SOL plus any dev buy).

1. Create a free Pinata account at https://app.pinata.cloud → **API Keys** → **New Key**
   (admin permissions are simplest) → copy the **JWT**. pump.fun no longer hosts metadata,
   so this is required.
2. In `.env` set:
   ```
   PINATA_JWT=<your JWT>
   PUMPFUN_ENABLED=true
   ```
3. Restart the app (Ctrl+C, then `npm run dev`).
4. In Phantom, switch to **Solana Mainnet** (turn **Testnet Mode** off) and make sure the
   wallet has a little real SOL.
5. Go to **Launch** → choose **pump.fun · mainnet** → fill in the coin → tick the
   confirmation box → **Launch on pump.fun**.

What Ryven does for safety: before you sign, it checks the transaction PumpPortal built
(only your wallet and the new mint sign it; it only calls pump.fun and standard Solana
programs) and simulates it on mainnet. PumpPortal charges 0.5% on the dev buy.

Not supported yet: AI agents for mainnet coins (agents run on devnet in this build).

---

## 7. Optional: deploying the bonding-curve program

Bonding-curve trading needs the Anchor program in `onchain/`. It is **devnet-only and
unaudited**. Requirements: Rust, the Solana CLI (https://solana.com/docs/intro/installation)
and Anchor 0.32.

```bash
cd onchain
```

```bash
anchor build
```

```bash
anchor deploy --provider.cluster devnet
```

Put the printed program ID into `NEXT_PUBLIC_CURVE_PROGRAM_ID`. Trading UI integration for
the curve is **not enabled in this build** (see `docs/ARCHITECTURE.md` roadmap).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Missing required environment variable …" | Fill that variable in `.env`, restart `npm run dev`. |
| "Not enough SOL for fees/rent" | Get devnet SOL at https://faucet.solana.com for the wallet shown. |
| Payment "Rejected by Solana simulation" | Usually the fee payer has no SOL, or the treasury allowance is used up. Top up the allowance from the console's **Fund** panel. |
| Payment rejected "Creator has not delegated" | Open the console → **Fund** → set an allowance. |
| Wallet shows mainnet | Switch your wallet to Devnet (step 3). |
| 429 errors from RPC | Public devnet RPC is rate-limited; use a free Helius/QuickNode devnet URL in `NEXT_PUBLIC_SOLANA_RPC_URL`. |
