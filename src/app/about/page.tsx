import type { Metadata } from "next";

export const metadata: Metadata = { title: 'About Ryven' };

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">About Ryven</h1>
      <div className="mt-6 space-y-4">
        <p className="text-[15px] leading-relaxed text-muted">{'Ryven is a token launchpad where every token can deploy an autonomous AI agent with its own treasury, spending limits and the ability to execute real USDC payments on Solana.'}</p>
        <p className="text-[15px] leading-relaxed text-muted">{"Pump-style launchpads let anyone create a token. Ryven goes further: the token's community economy (rewards, bounties, contributor payouts) can be run by an agent that acts on its own, inside limits enforced by code and by the Solana runtime."}</p>
        <p className="text-[15px] leading-relaxed text-muted">{'Built for the UBC 2026 Hackathon, Agentic Payments & AI track. Running on Solana mainnet.'}</p>
      </div>
    </div>
  );
}
