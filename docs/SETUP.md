# Ryven setup guide (beginner friendly)

This guide assumes no backend or blockchain experience. Follow it top to bottom.

> **Ryven runs on Solana mainnet.** Launching coins, funding agents and agent payments use
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
cd Ryven
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
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
```

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
2. **Launch** → fill in your coin → choose **Ryven · fixed supply** (or **pump.fun**) →
   approve in Phantom (~0.005 SOL for Ryven, ~0.02–0.03 SOL for pump.fun).
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
your Ryven server, so a compromised server could misuse whatever is in that trading wallet.

---

## 5. Deploying publicly (Vercel + Supabase)

1. Import the GitHub repo at https://vercel.com/new.
2. Add every variable from your `.env` under *Settings → Environment Variables*. Set
   `NEXT_PUBLIC_APP_URL` to your Vercel URL.
3. Run `npm run db:migrate` once from your computer against the Supabase database.
4. The built-in rate limiter is in-memory; for multiple server instances, back it with Redis.

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
