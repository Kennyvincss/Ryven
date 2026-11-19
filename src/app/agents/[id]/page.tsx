"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, ShieldCheck, Users, Wallet } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { PAYMENT_CATEGORIES, usdcLabel, usdcLabelFor } from "@/lib/shared/config";
import { ActivityFeed, ContributorsPanel, PaymentsTable, type ActivityItem, type Contributor, type Payment } from "@/components/console-panels";
import { DepositToTreasury } from "@/components/treasury-actions";
import { AddressLink, AgentAvatar, Alert, Badge, Button, Card, CardHeader, Spinner, Stat, TokenImage, timeAgo } from "@/components/ui";

type Resp = {
  agent: {
    id: string;
    name: string;
    description: string;
    personality: string;
    objectives: string;
    avatarSeed: string;
    status: string;
    pausedReason: string | null;
    mode: string;
    network: "devnet" | "mainnet";
    creatorWallet: string;
    signerPubkey: string;
    policy: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string; categories: string[]; recipientPolicy: string };
    treasury: { address: string; mint: string; cachedBalance: string; cachedAllowance: string; totalDeposits: string; totalSpent: string; lastSyncedAt: string | null; unit?: string; asset?: "usdc" | "sol" | "token"; decimals?: number; tokenProgram?: string } | null;
    stats: { confirmedPayments: number; confirmedVolume: string; tasksCompleted: number } | null;
    createdAt: string;
  };
  isCreator: boolean;
  token: { mint: string; name: string; symbol: string; imageUri: string | null } | null;
  contributors: Contributor[];
  payments: Payment[];
};

export default function AgentProfile() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<Resp>(`/api/agents/${id}`);
  const act = useApi<{ activities: ActivityItem[] }>(`/api/agents/${id}/activities`, { refreshMs: 15000 });
  if (q.loading) return <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6"><Spinner /></div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6"><Alert tone="danger">{q.error ?? "Not found"}</Alert></div>;
  const { agent: a, token, contributors } = q.data;
  const confirmed = q.data.payments.filter((p) => p.status === "confirmed");
  const cats = a.policy.categories.map((c) => PAYMENT_CATEGORIES.find((x) => x.id === c)?.label ?? c);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Card className="relative overflow-hidden p-6">
        <div className="glow-accent pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <AgentAvatar seed={a.avatarSeed} size={84} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
              {a.status === "active" ? <Badge tone="accent" dot>Active</Badge> : <Badge tone="warn">Paused</Badge>}
              <Badge tone="agent">{a.mode === "autonomous" ? "Autonomous" : "Approval mode"}</Badge>
              {a.network === "mainnet" && <Badge tone="warn">Real {a.treasury?.unit ?? "SOL"}</Badge>}
            </div>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{a.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              {token && (
                <Link href={`/tokens/${token.mint}`} className="flex items-center gap-1.5 hover:text-text">
                  <TokenImage src={token.imageUri} symbol={token.symbol} size={16} className="rounded" /> ${token.symbol}
                </Link>
              )}
              <span>Creator <AddressLink address={a.creatorWallet} /></span>
              <span>Deployed {timeAgo(a.createdAt)}</span>
            </div>
          </div>
          {q.data.isCreator && <Button variant="agent" href={`/console/${a.id}`}>Open console</Button>}
        </div>
      </Card>

      <Card className="mt-5 grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Treasury" value={Number(a.treasury?.cachedBalance ?? 0).toLocaleString()} hint={`${a.treasury?.unit ?? usdcLabelFor(a.network)} · synced ${a.treasury?.lastSyncedAt ? timeAgo(a.treasury.lastSyncedAt) : "never"}`} accent />
        <Stat label="Total paid out" value={Number(a.stats?.confirmedVolume ?? 0).toLocaleString()} hint={a.treasury?.unit ?? usdcLabel} />
        <Stat label="Confirmed payments" value={a.stats?.confirmedPayments ?? 0} />
        <Stat label="Tasks completed" value={a.stats?.tasksCompleted ?? 0} hint="instructions with confirmed payouts" />
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Verified payment history" subtitle="Only confirmed, on-chain-verified payments are public" />
            <PaymentsTable payments={confirmed} />
          </Card>
          <Card>
            <CardHeader title="Activity" icon={<Activity className="size-4" />} />
            <ActivityFeed items={act.data?.activities ?? []} />
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Objectives" />
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>{a.objectives || "—"}</p>
              <p className="text-xs">Personality: {a.personality || "—"}</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Public spending policy" subtitle="Enforced by the Ryven engine and Solana" icon={<ShieldCheck className="size-4" />} />
            <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
              <div><dt className="text-xs text-faint">Max per payment</dt><dd className="font-mono">{a.policy.maxPerTx}</dd></div>
              <div><dt className="text-xs text-faint">Daily limit</dt><dd className="font-mono">{a.policy.dailyLimit}</dd></div>
              <div><dt className="text-xs text-faint">On-chain allowance</dt><dd className="font-mono">{a.treasury?.cachedAllowance ?? "0"}</dd></div>
              <div><dt className="text-xs text-faint">Recipients</dt><dd>{a.policy.recipientPolicy === "allowlist_only" ? "Approved only" : "Approved / with approval"}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-faint">Categories</dt><dd className="mt-1 flex flex-wrap gap-1">{cats.map((c) => <Badge key={c}>{c}</Badge>)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-faint">Agent signing key (delegate)</dt><dd><AddressLink address={a.signerPubkey} chars={6} network={a.network} /></dd></div>
              {a.treasury && <div className="col-span-2"><dt className="text-xs text-faint">Treasury account</dt><dd><AddressLink address={a.treasury.address} chars={6} network={a.network} /></dd></div>}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Support this treasury" subtitle={`Anyone can deposit ${a.treasury?.unit ?? usdcLabel}`} icon={<Wallet className="size-4" />} />
            <div className="p-5">
              <DepositToTreasury agent={{ id: a.id, signerPubkey: a.signerPubkey, creatorWallet: a.creatorWallet, network: a.network, treasury: a.treasury }} onDone={q.reload} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Approved contributors" icon={<Users className="size-4" />} />
            <ContributorsPanel agentId={a.id} contributors={contributors} onChange={q.reload} editable={false} />
          </Card>
        </div>
      </div>
    </div>
  );
}
