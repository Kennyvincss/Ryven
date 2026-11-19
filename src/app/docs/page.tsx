import type { Metadata } from "next";

export const metadata: Metadata = { title: "How Ryyven works" };

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. Launch a coin",
    body: [
      "Connect your wallet (Phantom or Solflare) and sign in. Signing in is free and sends no transaction.",
      "On Launch, create your coin on a bonding curve: it is tradable right away. Your wallet shows the exact transaction before you approve it.",
    ],
  },
  {
    title: "2. Deploy its AI agent",
    body: [
      "Give the agent a name, a personality and spending rules: the most it can pay at once, its daily limit, which categories it may pay for and who it may pay.",
      "The agent gets its own key, but it never holds your money. Its treasury is a token account you own, and the agent may only spend the allowance you give it. Solana itself refuses anything beyond that allowance, and you can revoke it at any time.",
      "You can delete an agent at any time with Delete in its console. Ryyven first returns everything in its treasury and trading wallet to your wallet (one approval), then removes the agent. Your coin stays live, and you can deploy a new agent for it later.",
    ],
  },
  {
    title: "3. Fund the treasury",
    body: [
      "From the console, deposit SOL (or USDC, if you chose it for the agent) and set the agent's allowance. Start small.",
      "Add contributor wallets the agent may pay under Contributors.",
    ],
  },
  {
    title: "4. Talk to your agent",
    body: [
      "Type instructions in the console terminal, for example: “Reward three approved contributors with 1 USDC each”, “Send 0.01 SOL to @alice”, “What's our market cap?”, “Analyse my wallet and give me ideas” or “Alert me if SOL drops below $150”.",
      "Every payment is checked by Ryyven's rule engine before it's signed: limits, recipients, categories and the platform's emergency switch. Payments above your auto-approve limit wait for you in the approval queue.",
    ],
  },
  {
    title: "5. Trading and swaps (optional)",
    body: [
      "Under Permissions you can let the agent propose trades (you sign each one) or trade on its own from a separate trading wallet you fund. Every trade is checked against your limits and simulated before it's signed.",
      "Memecoins can go to zero. Only fund the trading wallet with what you're comfortable losing.",
    ],
  },
  {
    title: "Transparency",
    body: [
      "Each agent has a public page showing its spending rules, confirmed payments with on-chain links and its treasury address. Your instructions, settings, trades, wallet briefs and alerts are private to you.",
    ],
  },
];

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">How Ryyven works</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Ryyven lets you launch a Solana coin and give it an AI agent that can pay contributors from a treasury you control, within limits you set.
        Everything runs on Solana with real funds.
      </p>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <div className="mt-2 space-y-3">
              {s.body.map((p) => (
                <p key={p} className="text-[15px] leading-relaxed text-muted">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
