"use client";
import Link from "next/link";
import { ArrowRight, Bot, CircleDollarSign, Coins, Eye, Rocket, ShieldCheck, Sparkles, Terminal, Wallet } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { AgentCard, TokenCard, type AgentListItem, type TokenListItem } from "@/components/cards";
import { Badge, Button, Card, Empty, Spinner } from "@/components/ui";
import { usdcLabel } from "@/lib/shared/config";

type Stats = {
  tokensLaunched: number;
  agentsDeployed: number;
  activeAgents: number;
  confirmedPayments: number;
  paymentVolume: string;
  usdcManaged: string;
};

const STEPS = [
  { n: "01", title: "Launch", body: "Create a token on Solana in one transaction: name, image, socials, fixed supply.", icon: Rocket },
  { n: "02", title: "Deploy", body: "Give your token an AI agent with its own identity, objectives and personality.", icon: Bot },
  { n: "03", title: "Fund", body: `Deposit ${usdcLabel} into a treasury you own, and delegate a capped allowance to the agent.`, icon: Wallet },
  { n: "04", title: "Automate", body: "Instruct the agent in plain English. It acts within spending limits enforced by code and by Solana.", icon: Terminal },
  { n: "05", title: "Track", body: "Every payment is a verifiable Solana transaction with a reason, a policy record and an Explorer link.", icon: Eye },
];

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/70 px-4 py-3.5 backdrop-blur">
      <div className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export default function Home() {
  const stats = useApi<Stats>("/api/stats", { refreshMs: 20000 });
  const recent = useApi<{ tokens: TokenListItem[] }>("/api/tokens?sort=new");
  const withAgents = useApi<{ tokens: TokenListItem[] }>("/api/tokens?sort=agents");
  const agents = useApi<{ agents: AgentListItem[] }>("/api/agents?sort=active");
  const s = stats.data;

  return (
    <div>
      {/* ─────────── hero ─────────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="glow-accent pointer-events-none absolute inset-0" />
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge tone="agent" className="mb-6">
              <Sparkles className="size-3" /> Agentic payments on Solana
            </Badge>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Every Token Deserves <br className="hidden sm:block" />
              <span className="text-gradient">Its Own AI Agent.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base text-muted sm:text-lg">
              Launch tokens, deploy autonomous agents and build self-operating economies on Solana.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button href="/launch" size="lg" className="w-full sm:w-auto">
                Launch a Token <ArrowRight className="size-4" />
              </Button>
              <Button href="/agents" size="lg" variant="secondary" className="w-full sm:w-auto">
                Explore Agents
              </Button>
            </div>
          </div>

          <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Tokens launched" value={s ? s.tokensLaunched.toLocaleString() : "—"} />
            <StatTile label="Agents deployed" value={s ? s.agentsDeployed.toLocaleString() : "—"} sub={s ? `${s.activeAgents} active` : undefined} />
            <StatTile label="Agent payments" value={s ? s.confirmedPayments.toLocaleString() : "—"} sub={s ? `${Number(s.paymentVolume).toLocaleString()} ${usdcLabel} paid` : "verified on-chain"} />
            <StatTile label={`${usdcLabel} managed by agents`} value={s ? Number(s.usdcManaged).toLocaleString() : "—"} sub="last synced from chain" />
          </div>
          {stats.error && <p className="mt-3 text-center text-xs text-faint">Live stats unavailable: {stats.error}</p>}
        </div>
      </section>

      {/* ─────────── live discovery ─────────── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Recently launched</h2>
            <p className="mt-1 text-sm text-muted">Live from the Ryven launchpad. Every token here was verified on-chain.</p>
          </div>
          <Link href="/tokens" className="hidden items-center gap-1 text-sm text-muted hover:text-text sm:flex">
            All tokens <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {recent.loading ? (
          <Spinner />
        ) : recent.data?.tokens.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.data.tokens.slice(0, 6).map((t) => (
              <TokenCard key={t.id} t={t} />
            ))}
          </div>
        ) : (
          <Card>
            <Empty icon={<Coins className="size-5" />} title="No tokens launched yet" action={<Button href="/launch">Be the first</Button>}>
              The launchpad is empty on this deployment. Launch a token to see it here.
            </Empty>
          </Card>
        )}

        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <div>
            <div className="mb-5 flex items-end justify-between">
              <h2 className="text-xl font-semibold tracking-tight">Most active agents</h2>
              <Link href="/agents" className="flex items-center gap-1 text-sm text-muted hover:text-text">
                All agents <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {agents.data?.agents.length ? (
              <div className="grid gap-3">
                {agents.data.agents.slice(0, 3).map((a) => (
                  <AgentCard key={a.id} a={a} />
                ))}
              </div>
            ) : (
              <Card>
                <Empty icon={<Bot className="size-5" />} title="No agents yet">
                  Agents appear here once a creator deploys one for their token.
                </Empty>
              </Card>
            )}
          </div>
          <div>
            <div className="mb-5 flex items-end justify-between">
              <h2 className="text-xl font-semibold tracking-tight">Tokens with active agents</h2>
              <Link href="/tokens?tab=agents" className="flex items-center gap-1 text-sm text-muted hover:text-text">
                View <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {withAgents.data?.tokens.length ? (
              <div className="grid gap-3">
                {withAgents.data.tokens.slice(0, 3).map((t) => (
                  <TokenCard key={t.id} t={t} />
                ))}
              </div>
            ) : (
              <Card>
                <Empty icon={<Coins className="size-5" />} title="None yet">
                  Launch a token and deploy its agent to appear here.
                </Empty>
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* ─────────── how it works ─────────── */}
      <section className="border-y border-line bg-panel/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-accent">How Ryven works</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">From token to self-operating economy in five steps</h2>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(({ n, title, body, icon: Icon }) => (
              <Card key={n} className="p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-faint">{n}</span>
                  <Icon className="size-4 text-accent" />
                </div>
                <div className="mt-6 text-base font-semibold">{title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── why agents need wallets ─────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-agent">Why agents need wallets</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Autonomy without handing over the keys</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              An agent that can only talk is a chatbot. An agent that can pay rewards, settle bounties and run campaigns by itself is an
              economic actor. Ryven gives every agent a wallet, and boxes its spending in at three independent layers.
            </p>
          </div>
          <div className="grid gap-3">
            {[
              { icon: ShieldCheck, t: "Solana enforces the cap", d: "The agent is only an SPL Token delegate on a treasury you own. The chain refuses any transfer above your allowance. Revoke it in one click." },
              { icon: CircleDollarSign, t: "Code enforces the policy", d: "A deterministic engine checks per-tx max, daily limit, approved recipients, categories and duplicates before anything is signed." },
              { icon: Bot, t: "The AI only proposes", d: "Claude interprets instructions and plans payments, but has no keys and no tool to change limits, approve or unpause." },
            ].map(({ icon: Icon, t, d }) => (
              <Card key={t} className="flex gap-4 p-5">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-agent/10 text-agent">
                  <Icon className="size-5" />
                </div>
                <div>
                  <div className="font-semibold">{t}</div>
                  <p className="mt-1 text-sm text-muted">{d}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
