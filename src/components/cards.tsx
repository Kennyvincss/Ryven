"use client";
import Link from "next/link";
import { Bot, Pause } from "lucide-react";
import { AgentAvatar, Badge, Card, TokenImage, timeAgo } from "./ui";
import { formatCompact, shortAddress } from "@/lib/shared/amounts";
import { usdcLabel } from "@/lib/shared/config";

export type TokenListItem = {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string | null;
  creatorWallet: string;
  totalSupply: string;
  launchMode: "fixed_supply" | "bonding_curve" | "pumpfun";
  network: "devnet" | "mainnet";
  launchStatus: string;
  createdAt: string;
  volumeLamports: string;
  trades: number;
  lastPriceLamports: string | null;
  agent: { id: string; name: string; status: string; paymentsVolume: string } | null;
};

export function TokenCard({ t }: { t: TokenListItem }) {
  const isCurve = t.launchMode === "bonding_curve";
  const isPump = t.launchMode === "pumpfun";
  return (
    <Link href={`/tokens/${t.mint}`} className="group block">
      <Card className="h-full p-4 transition group-hover:-translate-y-0.5 group-hover:border-accent/30 group-hover:shadow-[0_12px_40px_-20px_rgba(198,255,61,0.45)]">
        <div className="flex gap-3">
          <TokenImage src={t.imageUri} symbol={t.symbol} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{t.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted">${t.symbol}</span>
              {isPump && (
                <Badge tone="accent" className="shrink-0">
                  Curve
                </Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs text-faint">
              by {shortAddress(t.creatorWallet)} · {timeAgo(t.createdAt)}
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{t.description || "No description."}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11px]">
          <div>
            <div className="text-faint">Supply</div>
            <div className="mt-0.5 font-mono text-text">{formatCompact(Number(t.totalSupply))}</div>
          </div>
          <div>
            <div className="text-faint">{isCurve ? "Volume" : "Market"}</div>
            <div className="mt-0.5 font-mono text-text">
              {isCurve ? `${formatCompact(Number(t.volumeLamports) / 1e9)} SOL` : isPump ? "Curve" : "Fixed"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-faint">{isPump ? "Trade" : "Agent"}</div>
            <div className="mt-0.5">
              {isPump ? (
                <Badge tone="accent">Live</Badge>
              ) : t.agent ? (
                <Badge tone={t.agent.status === "active" ? "agent" : "warn"} dot>
                  {t.agent.status === "active" ? "Active" : "Paused"}
                </Badge>
              ) : (
                <span className="text-faint">None</span>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export type AgentListItem = {
  id: string;
  name: string;
  description: string;
  avatarSeed: string;
  status: "active" | "paused";
  mode: string;
  createdAt: string;
  treasury: { address: string; cachedBalance: string; totalSpent: string; unit?: string } | null;
  stats: { confirmedPayments: number; confirmedVolume: string; tasksCompleted: number; lastActivityAt: string | null } | null;
  token: { mint: string; name: string; symbol: string; imageUri: string | null };
};

export function AgentCard({ a }: { a: AgentListItem }) {
  return (
    <Link href={`/agents/${a.id}`} className="group block">
      <Card className="h-full p-4 transition group-hover:-translate-y-0.5 group-hover:border-accent/30 group-hover:shadow-[0_12px_40px_-20px_rgba(198,255,61,0.45)]">
        <div className="flex items-start gap-3">
          <AgentAvatar seed={a.avatarSeed} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{a.name}</span>
              {a.status === "active" ? (
                <Badge tone="accent" dot>
                  Active
                </Badge>
              ) : (
                <Badge tone="warn">
                  <Pause className="size-3" /> Paused
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <TokenImage src={a.token.imageUri} symbol={a.token.symbol} size={16} className="rounded" />${a.token.symbol}
              <span className="text-faint">· {timeAgo(a.createdAt)}</span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{a.description || "Autonomous treasury agent."}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11px]">
          <div>
            <div className="text-faint">Treasury</div>
            <div className="mt-0.5 font-mono text-text">{Number(a.treasury?.cachedBalance ?? 0).toLocaleString()} {a.treasury?.unit ?? usdcLabel}</div>
          </div>
          <div>
            <div className="text-faint">Paid out</div>
            <div className="mt-0.5 font-mono text-text">{Number(a.stats?.confirmedVolume ?? 0).toLocaleString()}</div>
          </div>
          <div className="text-right">
            <div className="text-faint">Payments</div>
            <div className="mt-0.5 font-mono text-text">{a.stats?.confirmedPayments ?? 0}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function PaymentStatus({ status }: { status: string }) {
  const map: Record<string, { tone: "accent" | "warn" | "danger" | "info" | "neutral" | "agent"; label: string }> = {
    confirmed: { tone: "accent", label: "Confirmed on-chain" },
    executing: { tone: "info", label: "Executing" },
    approved: { tone: "info", label: "Approved" },
    awaiting_approval: { tone: "warn", label: "Awaiting approval" },
    rejected: { tone: "danger", label: "Rejected by policy" },
    failed: { tone: "danger", label: "Failed" },
    cancelled: { tone: "neutral", label: "Cancelled" },
  };
  const m = map[status] ?? { tone: "neutral" as const, label: status };
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export function NoAgentsYet() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Bot className="size-4" /> No agents deployed yet.
    </div>
  );
}
