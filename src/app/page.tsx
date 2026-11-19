"use client";
import Link from "next/link";
import { ArrowRight, Bot, CircleDollarSign, Coins, Eye, Rocket, ShieldCheck, Terminal, Wallet } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { AgentCard, TokenCard, type AgentListItem, type TokenListItem } from "@/components/cards";
import { Button, Card, Empty, Spinner, TokenImage } from "@/components/ui";
import { RyvenMark } from "@/components/brand";
import { usd, type Pulse } from "@/lib/client/live";
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
  { n: "01", title: "Launch", body: "Launch a coin on a bonding curve in one transaction: name, image, socials. Tradable right away.", icon: Rocket },
  { n: "02", title: "Deploy", body: "Give your token an AI agent with its own identity, objectives and personality.", icon: Bot },
  { n: "03", title: "Fund", body: `Deposit ${usdcLabel} into a treasury you own, and delegate a capped allowance to the agent.`, icon: Wallet },
  { n: "04", title: "Automate", body: "Instruct the agent in plain English. It acts within spending limits enforced by code and by Solana.", icon: Terminal },
  { n: "05", title: "Track", body: "Every payment is a verifiable Solana transaction with a reason, a policy record and an Explorer link.", icon: Eye },
];

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5 backdrop-blur">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-faint">{label}</div>
      <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/** Live "About to graduate" preview for the hero (same feed as the Live terminal). */
function LivePreview() {
  const q = useApi<Pulse>("/api/live/pulse", { refreshMs: 5000 });
  const coins = q.data?.aboutToGraduate.slice(0, 4) ?? [];
  return (
    <div className="rounded-[22px] border border-white/[0.08] bg-[#07090b]/80 p-3 shadow-[0_30px_80px_-40px_rgba(198,255,61,0.45)] backdrop-blur">
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-faint">Live / about to graduate</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          <span className="animate-pulse-dot size-1.5 rounded-full bg-accent" /> Live
        </span>
      </div>
      <div className="space-y-1.5">
        {coins.length === 0
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.03]" />)
          : coins.map((c) => (
              <Link key={c.mint} href={`/trade/${c.mint}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]">
                <TokenImage src={c.icon} symbol={c.symbol} size={36} className="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.symbol}</span>
                    <span className="font-mono text-xs text-text">{usd(c.mcap)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${c.bondingCurve ?? 100}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-muted">{(c.bondingCurve ?? 100).toFixed(0)}%</span>
                  </div>
                </div>
              </Link>
            ))}
      </div>
      <Link href="/live" className="mt-2 flex items-center justify-center gap-1 rounded-xl py-2 text-xs text-muted hover:text-accent">
        Open the Live terminal <ArrowRight className="size-3" />
      </Link>
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
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="glow-accent pointer-events-none absolute inset-0" />
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-6 font-mono text-[11px] font-medium uppercase tracking-[0.32em] text-accent">Memecoin terminal · AI</div>
            <h1 className="text-[42px] font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Trade memecoins live.
              <br />
              <span className="text-accent">Let your AI agent</span> run the rest.
            </h1>
            <p className="mt-6 max-w-xl text-base text-muted sm:text-lg">
              New pairs, coins about to graduate and live charts in one terminal. Launch your own coin and give it an agent that trades, pays
              and alerts you within limits Solana enforces.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/live" size="lg" className="w-full sm:w-auto">
                Open Live terminal <ArrowRight className="size-4" />
              </Button>
              <Button href="/launch" size="lg" variant="secondary" className="w-full sm:w-auto">
                <Rocket className="size-4" /> Launch a coin
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
              <span>Non-custodial</span>
              <span>Checked before you sign</span>
              <span>Agent limits enforced on-chain</span>
            </div>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute -right-6 -top-16 opacity-90 drop-shadow-[0_0_60px_rgba(198,255,61,0.35)]">
              <RyvenMark size={150} />
            </div>
            <div className="relative pt-24">
              <LivePreview />
            </div>
          </div>
        </div>
        <div className="relative mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 pb-14 sm:px-6 md:grid-cols-4">
          <StatTile label="Coins launched" value={s ? s.tokensLaunched.toLocaleString() : "—"} />
          <StatTile label="Agents deployed" value={s ? s.agentsDeployed.toLocaleString() : "—"} sub={s ? `${s.activeAgents} active` : undefined} />
          <StatTile label="Agent payments" value={s ? s.confirmedPayments.toLocaleString() : "—"} sub={s ? `${Number(s.paymentVolume).toLocaleString()} ${usdcLabel} paid` : "verified on-chain"} />
          <StatTile label={`${usdcLabel} in agent treasuries`} value={s ? Number(s.usdcManaged).toLocaleString() : "—"} sub="synced from chain" />
        </div>
      </section>

      {/* ─────────── live discovery ─────────── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Launched on Ryyven</h2>
            <p className="mt-1 text-sm text-muted">Every coin here was verified on-chain before it was listed.</p>
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
              <h2 className="text-2xl font-bold tracking-tight">Most active agents</h2>
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
              <h2 className="text-2xl font-bold tracking-tight">Tokens with active agents</h2>
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
      <section className="border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-accent"><span className="text-faint">Ryyven /</span> How it works</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">From token to self-operating economy in five steps</h2>
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
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-accent"><span className="text-faint">Ryyven /</span> Why agents need wallets</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Autonomy without handing over the keys</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              An agent that can only talk is a chatbot. An agent that can pay rewards, settle bounties and run campaigns by itself is an
              economic actor. Ryyven gives every agent a wallet, and boxes its spending in at three independent layers.
            </p>
          </div>
          <div className="grid gap-3">
            {[
              { icon: ShieldCheck, t: "Solana enforces the cap", d: "The agent is only an SPL Token delegate on a treasury you own. The chain refuses any transfer above your allowance. Revoke it in one click." },
              { icon: CircleDollarSign, t: "Code enforces the policy", d: "A deterministic engine checks per-tx max, daily limit, approved recipients, categories and duplicates before anything is signed." },
              { icon: Bot, t: "The AI only proposes", d: "Claude interprets instructions and plans payments, but has no keys and no tool to change limits, approve or unpause." },
            ].map(({ icon: Icon, t, d }) => (
              <Card key={t} className="flex gap-4 p-5">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
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
