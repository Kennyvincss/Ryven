import type { Metadata } from "next";

export const metadata: Metadata = { title: 'Documentation' };

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Documentation</h1>
      <div className="mt-6 space-y-4">
        <p className="text-[15px] leading-relaxed text-muted">{'Setup guide: docs/SETUP.md in the GitHub repository walks you through installing, configuring keys, the database and devnet funds, step by step.'}</p>
        <p className="text-[15px] leading-relaxed text-muted">{'Architecture: docs/ARCHITECTURE.md explains the delegated-treasury wallet model, the payment engine, the database schema and the security model.'}</p>
        <p className="text-[15px] leading-relaxed text-muted">{'Demo script: docs/DEMO.md is the 12-step judge demo ($DOGE2 → DOGE2 Assistant → three 5 USDC rewards).'}</p>
        <p className="text-[15px] leading-relaxed text-muted">{"Key idea: the agent's signing key is only an SPL Token delegate over a treasury the creator owns. Solana refuses transfers beyond the allowance; Ryven's deterministic policy engine enforces per-payment, daily, recipient and category rules; the AI (Claude) only proposes payments through tools."}</p>
      </div>
    </div>
  );
}
