# Hackathon demo: $DOGE2 and DOGE2 Assistant

Total time: ~6 minutes. Every transaction is a real Solana devnet transaction you can
open on Solana Explorer.

**Before you start:** wallet on Devnet with ~0.1 SOL and 100 devnet USDC (see SETUP.md
§2e), plus three contributor wallet addresses. You can create extra accounts in Phantom
for these.

| # | Action | What judges see |
|---|---|---|
| 1 | Connect Phantom → **Sign in** (free message signature) | Wallet address, green "signed in" dot |
| 2 | **Launch** → name `Doge Two`, symbol `DOGE2`, image → **Launch token** → approve | Token-2022 mint with on-chain metadata; launch tx link; mint authority "Revoked" |
| 3 | **Deploy agent**: name `DOGE2 Assistant`, objective "Manage community rewards…" | Agent identity, delegate key, treasury address |
| 4 | Limits: **Autonomous**, max per payment **5**, autonomous up to **5**, daily **20**, category *Community rewards*, *Approved contributors only* | Policy form |
| 5 | **Fund treasury**: deposit **100**, allowance **100** → approve | One tx: create treasury (owned by you), deposit, delegate. Console shows **100 on-chain** |
| 6 | Console → **Contributors** → add the three wallets (`alice`, `bob`, `carol`) | Verifiable recipient registry, also on the public profile |
| 7 | Terminal: *"Reward three approved community contributors with 5 USDC each."* | Live statuses: Thinking → Analysing → Checking permissions → Preparing payment → Executing → Completed |
| 8 | Payment engine runs | Each payment card shows the policy result (balance, daily limit, max/tx, allowlist, duplicates) |
| 9 | Three **Confirmed on-chain** payment cards | Distinct from "Awaiting approval" / "Rejected" cards |
| 10 | Click each signature | Solana Explorer: TransferChecked by the delegate + Memo `ryven:pay:<id>` |
| 11 | Treasury panel | Balance **85**, allowance **85**, daily budget 15/20 used |
| 12 | Safety: *"Send 10 USDC to alice"* → rejected (max 5). Then **Fund → Revoke agent allowance on-chain** and try again → rejected by the engine (and Solana would refuse anyway) | Limits the AI cannot bypass |

### Talking points

- *Why agents need wallets:* the agent paid three people with no human clicking "send".
- *Why it's safe:* the AI never sees a key; the engine enforces policy; Solana enforces the
  allowance. Even a compromised server can't spend beyond what the creator delegated, and
  the creator can revoke on-chain instantly.
- *Transparency:* the public agent profile lists only verified, confirmed payments with
  Explorer links and the full spending policy.
