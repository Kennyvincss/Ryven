# ryven_curve: bonding-curve program (Anchor 0.32.1)

Pump-style constant-product curve over virtual reserves for Ryven launches.
**Devnet only. Unaudited. Never use with real funds.**

| Instruction | Who | What |
|---|---|---|
| `initialize_config` | platform | fee (≤5%), fee recipient, initial virtual SOL/token reserves |
| `create_curve` | token creator | requires revoked mint & freeze authority; moves the **entire** supply into the curve vault (no premine) |
| `buy(sol_amount, min_tokens_out)` | anyone | SOL → tokens with slippage bound; last buy is capped at the remaining reserve and marks the curve `complete` |
| `sell(token_amount, min_sol_out)` | anyone | tokens → SOL from real reserves only (rent is never touched) |

Rounding always favours the curve (`ceil` on the new reserve), so a buy→sell round trip can
never extract value (see `cargo test`).

## Status

- ✅ Compiles against `anchor-lang`/`anchor-spl` 0.32.1 (`cargo check`, host)
- ✅ Curve math unit tests (`cargo test --lib`)
- ⚠️ Not yet built for SBF / deployed / integration-tested: the Solana toolchain was not
  available in the environment this was written in. Treat it as untested on-chain.
- ❌ Ryven web UI does not call this program yet (launches use fixed supply).

## Build & deploy (devnet)

Requires the Solana CLI and Anchor 0.32.1 (https://www.anchor-lang.com/docs/installation).

```bash
anchor keys sync
```

```bash
anchor build
```

```bash
anchor deploy --provider.cluster devnet
```

Then set `NEXT_PUBLIC_CURVE_PROGRAM_ID` in the app's `.env`.
