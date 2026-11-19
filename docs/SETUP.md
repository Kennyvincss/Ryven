# Ryyven setup guide (beginner friendly)

This guide assumes no backend or blockchain experience. Follow it top to bottom.

> **Ryyven runs on Solana mainnet.** Launching coins, funding agents and agent payments use
> **real SOL and real USDC** and can't be undone. Start with small amounts.

---

## 0. What you need

| Tool | Why | How to get it |
|---|---|---|
| **Node.js 20+** (22 recommended) | runs the app | https://nodejs.org → download the LTS installer |
| **PostgreSQL** | the app's database | free hosted DB at https://supabase.com (or local Postgres) |
| **Phantom** or **Solflare** | your wallet | https://phantom.app / https://solflare.com |
| **Git** | to download the code | https://git-scm.com |
| **A little SOL and USDC** | fees, launches, agent treasuries | buy in Phantom (or any exchange) |

---

## 1. Download and install

```bash
git clone https://github.com/kennyvincss/Ryven.git
```

```bash
cd Ryyven
```

```bash
npm install
```

---

## 2. Create your `.env` file

```bash
cp .env.example .env
```

(Windows: `copy .env.example .env`.) Open `.env` in VS Code and fill it in as below.

### 2a. Server secrets

```bash
npm run keys
```

Paste the three printed lines (`SESSION_SECRET`, `AGENT_KEY_ENCRYPTION_KEY`,
`FEE_PAYER_SECRET_KEY`) into `.env`. Keep the printed **fee payer address**.

> Keep `AGENT_KEY_ENCRYPTION_KEY` safe: it encrypts every agent's signing key.

### 2b. Fund the fee payer (real SOL)

The fee payer pays the network fees of agent payments (~0.000005 SOL each, plus ~0.002 SOL
the first time a wallet receives a token). From Phantom, send **about 0.05 SOL** to the fee
payer address.

### 2c. Database

Supabase: create a project → **Connect** → **Direct** → **Session pooler** → copy the string
into `DATABASE_URL` (replace `[YOUR-PASSWORD]`, remove the brackets). Then:

```bash
npm run db:migrate
```

It should say **"Migrations applied successfully"**. (The app also updates the database by
itself whenever it starts in development.)

### 2d. RPC (strongly recommended)

The public Solana RPC is heavily rate-limited. Create a free account at https://helius.dev,
copy your **mainnet RPC URL** and set it in `.env`:

```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
```

This URL stays on your server: browsers talk to Solana through Ryyven's `/api/rpc` relay, so
visitors never see your API key.

### 2e. IPFS for coin images (Pinata)

On mainnet, a coin's image and metadata must be publicly reachable. While running on your
computer, use Pinata: https://app.pinata.cloud → **API Keys** → **New Key** (Admin) → copy
the JWT into `PINATA_JWT=`.

### 2f. AI key (Anthropic)

https://console.anthropic.com → **API Keys** → **Create Key** → put it in `ANTHROPIC_API_KEY=`.
Add a few dollars under **Billing** (API credit is separate from a Claude subscription).

### 2g. Optional

- `PUMPFUN_ENABLED=true` adds **pump.fun** launches (needs `PINATA_JWT`).
- `ADMIN_WALLETS=<your wallet>` unlocks `/admin` (global payment kill switch).

---

## 3. Run it

```bash
npm run dev
```

Open http://localhost:3000. Check http://localhost:3000/api/config shows
`"network":"mainnet"`, `"aiEnabled":true`.

In Phantom make sure **Testnet Mode is OFF** (Settings → Developer Settings), so the wallet
is on Solana **Mainnet**.

---

## 4. Use it

1. **Connect wallet** → click your address → **Sign in** (free, no transaction).
2. **Launch** → fill in your coin → choose **Ryyven · fixed supply** (or **pump.fun**) →
   approve in Phantom (~0.005 SOL for Ryyven, ~0.02–0.03 SOL for pump.fun).
3. **Deploy agent** → set limits → tick the real-money box → **Deploy agent**.
4. **Fund the treasury** with USDC and set the agent's allowance (start small, e.g. 5–10).
5. Console → **Contributors** → add wallets the agent may pay.
6. Type an instruction in the terminal, e.g.
   *"Reward three approved community contributors with 1 USDC each."*

### Sending SOL

Console → **Permissions** → **SOL payments** → Enabled → set limits → Save. Then **Treasury**
→ **SOL** → **Fund** (deposit SOL and set the agent's allowance). Ask e.g. *"Send 0.01 SOL to
@alice"*. Recipients receive plain SOL; the minimum is 0.001 SOL per payment.

### Rewards in your own coin

Console → **Permissions** → **Rewards in $YOURCOIN** → Enabled → Save. Then **Treasury** →
**$YOURCOIN rewards** → **Fund**.

### Trading on pump.fun

Console → **Permissions** → **pump.fun trading**:
- **Proposals** (safer): the agent proposes trades; you sign each in the **Trading** tab.
- **Autonomous** (risky): the agent trades from its **own trading wallet** (address in the
  Trading tab). Send it only what you're fine losing. **Withdraw everything to me** pulls it
  all back.

**Swaps** use the same mode and limits: ask e.g. *"Swap 0.05 SOL to USDC"* or *"Swap 10 USDC
for SOL"*. Swaps go through Jupiter and can use SOL, USDC, USDT, your own coin and coins on
your trading allowlist. A swap's value in SOL counts toward your per-trade and daily limits.

Every trade is checked before signing: your limits, the coin allowlist, the programs it
calls, and a mainnet simulation that refuses it if the wallet would lose more than the trade
amount plus 10% slippage and fees. In autonomous mode the agent's key is held (encrypted) by
your Ryyven server, so a compromised server could misuse whatever is in that trading wallet.

### Wallet analysis and the daily brief

Ask the agent anytime, e.g. *"Analyse my wallet and give me ideas"* or *"What changed in my
wallet this week?"*. It values every holding in USD, shows your allocation, flags risks (one
coin too big, too little SOL for fees, coins with tiny liquidity, unknown airdrops) and
suggests a few ideas. Ideas only: it never trades unless you ask.

For a **daily brief**: Console → **Wallet brief** → Daily brief **On** → pick a time → Save.
**Generate now** makes one immediately. Briefs are generated while your Ryyven server is
running (`npm run dev` or `npm start`). On Vercel, set `CRON_SECRET` and add a cron job that
calls `/api/cron/briefs` hourly (see `.env.example`).

### Live terminal and trading

**Live** (top menu) shows pump.fun coins in three columns that update every few seconds:
**New pairs**, **About to graduate** and **Graduated**. Hovering a column pauses it. Each
column has **Filters** (token age, market cap, 24h volume, liquidity, holders, bonding-curve %,
top-10 / dev / sniper share, has socials); they search the whole market, are saved in your
browser, and accept shorthand like `10k` or `1.5m`. The data source returns at most 30 coins
per column. Click a
coin for its page: live chart (1s to 1d, market cap or price), live trades, safety info and
a **Buy / Sell** panel. The ⚡ button on each card buys instantly with your **Quick buy**
amount. pump.fun coins you launch on Ryyven get the same chart and Buy/Sell on their token page.

Trades use your own wallet and real SOL: Ryyven gets the best route from Jupiter, checks the
transaction (it can only swap your own funds) and simulates it before your wallet asks you
to approve. Nothing to configure: no new environment variables.

### Price alerts

Ask the agent, e.g. *"Alert me if SOL drops below $150"*, *"Tell me when our market cap hits
$1M"* or *"Alert me if &lt;coin&gt; falls 20%"*. Works for price or market cap, above/below a
level or a % move from now, on any mainnet token (up to 20 active). Alerts are checked every
minute while your Ryyven server runs. When one hits you see it in the console (banner,
**Alerts** tab, activity feed); click **Enable browser notifications** in the Alerts tab to
also get a desktop notification while the console is open. Alerts never trade. On Vercel,
call `/api/cron/alerts` from a cron job with `CRON_SECRET` (see `.env.example`).

---

## 5. Deploying publicly (Vercel + Supabase)

Once connected, Vercel redeploys automatically every time `main` changes.

**Before you start:** your app must already work locally against Supabase, and
`npm run db:migrate` must have succeeded (Vercel does not migrate the database for you).
Run `npm run db:migrate` again from your computer after every `git pull` that adds a migration.

1. **Import the project.** Go to https://vercel.com/new → sign in with GitHub → find
   **Ryyven** → **Import**. Leave the framework (Next.js) and build settings as they are.
   Don't click Deploy yet.
2. **Add the environment variables.** In the import screen open **Environment Variables**
   and add each line below. Copy the values from your local `.env` (open it in VS Code), except
   where noted. Tip: you can paste your whole `.env` into the first box and Vercel splits it.

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your Supabase string, but use the **Transaction pooler** (Supabase → Connect → Transaction pooler, port **6543**) |
   | `SESSION_SECRET` | from `.env` |
   | `AGENT_KEY_ENCRYPTION_KEY` | from `.env` (must be the same, or existing agents can't sign) |
   | `FEE_PAYER_SECRET_KEY` | from `.env` |
   | `ANTHROPIC_API_KEY` | from `.env` |
   | `SOLANA_RPC_URL` | your Helius mainnet URL (required: the public RPC blocks most cloud servers). Server-only, never shown to visitors |
   | `PINATA_JWT` | from `.env` (optional on Vercel, recommended) |
   | `PUMPFUN_ENABLED` | `true` if you use pump.fun launches |
   | `ADMIN_WALLETS` | your wallet address (optional) |
   | `CRON_SECRET` | a new random password: run `npm run keys` and copy the `SESSION_SECRET` value it prints (don't reuse your real one) |
   | `NEXT_PUBLIC_APP_URL` | leave for now (step 4) |

   Never add the test-mode variables (`NEXT_PUBLIC_SOLANA_CLUSTER`, `TEST_USDC_*`).
3. **Deploy.** Click **Deploy** and wait for "Congratulations". Your URL looks like
   `https://ryven-xxxx.vercel.app`.
4. **Set the app URL.** Vercel → your project → **Settings → Environment Variables** → add
   `NEXT_PUBLIC_APP_URL` = your Vercel URL (no trailing slash) → **Deployments** → ⋯ on the
   latest → **Redeploy**. (Any change to a `NEXT_PUBLIC_…` variable needs a redeploy.)
5. **Check it.** Open `https://<your-url>/api/config`: it should show `"network":"mainnet"`
   and `"aiEnabled":true`. Then sign in with your wallet.
6. **Turn on price alerts and daily briefs.** On Vercel nothing runs between visits, so use a
   free cron service. At https://cron-job.org create an account and add two jobs:

   | Job | URL | Schedule |
   |---|---|---|
   | Price alerts | `https://<your-url>/api/cron/alerts` | every 1 minute |
   | Daily briefs | `https://<your-url>/api/cron/briefs` | every hour |

   For each job: **Advanced → Headers → Add**: key `Authorization`, value `Bearer ` followed
   by your `CRON_SECRET` (e.g. `Bearer abc123…`). Save, then **Test run**: it should answer
   `{"ok":true,…}`. A `401` means the header doesn't match `CRON_SECRET`.

**Notes**
- Vercel's free plan can only run its own cron jobs once a day, which is why step 6 uses
  cron-job.org.
- Agent replies, payments and trades can take a while (Claude + Solana confirmation); those
  routes are allowed up to 5 minutes.
- The built-in rate limiter is in memory, per server instance. That's fine to start; for
  heavy traffic, back it with Redis.
- Problems? Vercel → your project → **Logs** shows server errors.

---

## 6. Tests (for developers)

```bash
npm test
```

Unit tests (policy engines) and LiteSVM tests (real token-program transactions, in memory),
no money involved. `scripts/e2e-devnet.ts` is a full end-to-end test that only runs in the
hidden test mode (`NEXT_PUBLIC_SOLANA_CLUSTER=devnet` with a test USDC mint); it refuses to
run against mainnet.

---

## 7. Bonding-curve program (optional, not deployed)

The Anchor program in `onchain/` is **unaudited** and the UI doesn't use it. Don't deploy it
to mainnet with real funds without an audit.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Missing required environment variable …" | Fill it in `.env`, restart `npm run dev`. |
| "Not enough SOL in your wallet" | Add a little SOL to the wallet shown. |
| Payment "Rejected by Solana simulation" | The fee payer may have no SOL, or the allowance is used up: top it up from **Fund**. |
| "Creator has not delegated" | Console → **Fund** → set an allowance. |
| Launch says metadata must be publicly reachable | Set `PINATA_JWT` (§2e). |
| 429 / "Too many requests" | Use a Helius RPC URL (§2d). |
| "The database is out of date" | Run `npm run db:migrate`, restart. |
