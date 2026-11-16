"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, ArrowUpRight, CandlestickChart, Pause, Play, Settings, Users, Wallet, Coins, Send } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi, useAppConfig } from "@/lib/client/hooks";
import { useSession } from "@/lib/client/session";
import { usdcLabelFor } from "@/lib/shared/config";
import { AgentTerminal } from "@/components/agent-terminal";
import { TokenRewardSettings, TradingPanel, TradingSettings } from "@/components/trading-panel";
import {
  ActivityFeed,
  ApprovalsPanel,
  BudgetBar,
  ContributorsPanel,
  ManualPayment,
  PaymentsTable,
  SettingsPanel,
  type ActivityItem,
  type Contributor,
  type Payment,
  type TreasuryState,
} from "@/components/console-panels";
import { FundTreasury, TreasuryOwnerActions } from "@/components/treasury-actions";
import { AuthGate } from "@/components/wallet-button";
import { AddressLink, AgentAvatar, Alert, Badge, Button, Card, CardHeader, Spinner, Stat, Tabs } from "@/components/ui";

type AgentResp = {
  agent: {
    id: string;
    name: string;
    description: string;
    personality: string;
    objectives: string;
    avatarSeed: string;
    status: "active" | "paused";
    pausedReason: string | null;
    mode: "autonomous" | "approval";
    network: "devnet" | "mainnet";
    creatorWallet: string;
    signerPubkey: string;
    policy: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string; categories: string[]; recipientPolicy: "allowlist_only" | "allowlist_or_approval" };
    tokenPolicy: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string } | null;
    trading: { mode: "off" | "proposal" | "autonomous"; maxSolPerTrade: string; dailySol: string; mints: string[] };
    treasury: { address: string; mint: string } | null;
  };
  private: { instructions: string } | null;
  isCreator: boolean;
  token: { mint: string; name: string; symbol: string } | null;
  contributors: Contributor[];
  payments: Payment[];
};

function Console({ id }: { id: string }) {
  const config = useAppConfig();
  const agentQ = useApi<AgentResp>(`/api/agents/${id}`);
  const [asset, setAsset] = useState<"usdc" | "token">("usdc");
  const treasuryQ = useApi<TreasuryState>(`/api/agents/${id}/treasury?asset=${asset}`, { refreshMs: 15000 });
  const actQ = useApi<{ activities: ActivityItem[] }>(`/api/agents/${id}/activities`, { refreshMs: 6000 });
  const [tab, setTab] = useState<"payments" | "contributors" | "manual" | "trading" | "settings">("payments");
  const [showFund, setShowFund] = useState(false);
  const [toggling, setToggling] = useState(false);

  const { reload: reloadAgent } = agentQ;
  const { reload: reloadTreasury } = treasuryQ;
  const { reload: reloadAct } = actQ;
  const refreshAll = useCallback(() => {
    reloadAgent();
    reloadTreasury();
    reloadAct();
  }, [reloadAgent, reloadTreasury, reloadAct]);

  if (agentQ.loading && !agentQ.data) return <Spinner />;
  if (agentQ.error) return <Alert tone="danger">{agentQ.error}</Alert>;
  const d = agentQ.data!;
  if (!d.isCreator)
    return (
      <Alert tone="warn" title="Creator access only">
        This console belongs to the agent&apos;s creator wallet. View the <Link className="underline" href={`/agents/${id}`}>public profile</Link> instead.
      </Alert>
    );
  const a = d.agent;
  const t = treasuryQ.data;
  const agentRef = { id: a.id, signerPubkey: a.signerPubkey, creatorWallet: a.creatorWallet, network: a.network, treasury: a.treasury };

  async function toggle() {
    setToggling(true);
    try {
      await api(`/api/agents/${id}/status`, { json: { action: a.status === "active" ? "pause" : "resume" } });
      refreshAll();
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar seed={a.avatarSeed} size={56} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{a.name}</h1>
              {a.status === "active" ? <Badge tone="accent" dot>Active</Badge> : <Badge tone="warn">Paused</Badge>}
              <Badge tone="agent">{a.mode === "autonomous" ? "Autonomous mode" : "Approval mode"}</Badge>
              {a.network === "mainnet" && <Badge tone="warn">Mainnet · real USDC</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {d.token && (
                <Link href={`/tokens/${d.token.mint}`} className="hover:text-text">
                  ${d.token.symbol}
                </Link>
              )}
              <span>
                agent key <AddressLink address={a.signerPubkey} network={a.network} />
              </span>
            </div>
            {a.status === "paused" && a.pausedReason && <div className="mt-1 text-xs text-warn">{a.pausedReason}</div>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" href={`/agents/${id}`}>
            Public profile <ArrowUpRight className="size-3.5" />
          </Button>
          <Button variant={a.status === "active" ? "danger" : "primary"} size="sm" onClick={toggle} loading={toggling}>
            {a.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {a.status === "active" ? "Pause agent" : "Resume agent"}
          </Button>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <AgentTerminal agentId={id} agentName={a.name} avatarSeed={a.avatarSeed} aiEnabled={!!config?.aiEnabled} onActivity={refreshAll} />

          <Card>
            <Tabs
              value={tab}
              onChange={setTab}
              className="m-3 border-0 bg-panel-2"
              items={[
                { id: "payments", label: <span className="flex items-center gap-1.5"><Coins className="size-3.5" />Payments</span> },
                { id: "contributors", label: <span className="flex items-center gap-1.5"><Users className="size-3.5" />Contributors ({d.contributors.length})</span> },
                { id: "manual", label: <span className="flex items-center gap-1.5"><Send className="size-3.5" />Manual payment</span> },
                { id: "trading", label: <span className="flex items-center gap-1.5"><CandlestickChart className="size-3.5" />Trading</span> },
                { id: "settings", label: <span className="flex items-center gap-1.5"><Settings className="size-3.5" />Permissions</span> },
              ]}
            />
            <div className="border-t border-line">
              {tab === "payments" && <PaymentsTable payments={d.payments} onChange={refreshAll} />}
              {tab === "contributors" && <ContributorsPanel agentId={id} contributors={d.contributors} onChange={refreshAll} editable />}
              {tab === "manual" && (
                <ManualPayment
                  agentId={id}
                  contributors={d.contributors.filter((c) => c.status === "approved")}
                  categories={a.policy.categories}
                  onDone={refreshAll}
                  tokenSymbol={a.tokenPolicy ? (d.token?.symbol ?? null) : null}
                />
              )}
              {tab === "trading" && <TradingPanel agentId={id} />}
              {tab === "settings" && (
                <>
                  <SettingsPanel agent={a} instructions={d.private?.instructions ?? ""} onSaved={refreshAll} />
                  <TokenRewardSettings agentId={id} symbol={d.token?.symbol ?? "TOKEN"} value={a.tokenPolicy} onSaved={refreshAll} />
                  <TradingSettings agentId={id} value={a.trading} onSaved={refreshAll} />
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <div className="flex gap-1 px-4 pt-3">
              {(["usdc", "token"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => {
                    setAsset(a);
                    setShowFund(false);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${asset === a ? "bg-panel-3 text-text" : "text-muted hover:text-text"}`}
                >
                  {a === "usdc" ? usdcLabelFor(d.agent.network) : `$${d.token?.symbol ?? "TOKEN"} rewards`}
                </button>
              ))}
            </div>
            <CardHeader
              title={asset === "usdc" ? "Treasury" : `$${d.token?.symbol ?? ""} rewards treasury`}
              subtitle={t ? <AddressLink address={t.address} network={a.network} /> : "Reading from Solana…"}
              icon={<Wallet className="size-4" />}
              right={
                <Button size="sm" variant="secondary" onClick={() => setShowFund((s) => !s)}>
                  {showFund ? "Close" : "Fund"}
                </Button>
              }
            />
            <div className="space-y-4 p-5">
              {!t ? (
                <Spinner />
              ) : (
                <>
                  {t.asset === "token" && !t.enabled && (
                    <Alert tone="info" title={`Rewards in ${t.unit} are off`}>
                      Enable them under Permissions (set token limits), then fund this treasury with {t.unit} and give the agent an allowance.
                    </Alert>
                  )}
                  {!t.onchain.exists && <Alert tone="warn" title="Treasury not created yet">Fund it to create the account and give the agent an allowance.</Alert>}
                  {t.onchain.exists && !t.onchain.delegatedToAgent && (
                    <Alert tone="warn" title="No spending authority">The agent has no on-chain allowance (never set or revoked). Payments will be rejected.</Alert>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <Stat label="Balance (on-chain)" value={`${Number(t.onchain.balance).toLocaleString()}`} hint={t.unit} accent />
                    <Stat label="Agent allowance" value={Number(t.onchain.allowance).toLocaleString()} hint="enforced by Solana" />
                    <Stat label="Remaining today" value={Number(t.budget.remainingToday).toLocaleString()} hint={`of ${t.budget.dailyLimit} daily`} />
                    <Stat label="Max per payment" value={t.budget.maxPerTx} hint={`auto ≤ ${t.budget.autoApproveLimit}`} />
                  </div>
                  <BudgetBar used={t.budget.usedToday} limit={t.budget.dailyLimit} />
                  <div className="grid grid-cols-4 gap-2 rounded-xl border border-line bg-panel-2 p-3 text-center text-[11px]">
                    <div><div className="font-mono text-sm text-text">{t.totals.deposits}</div><div className="text-faint">deposited</div></div>
                    <div><div className="font-mono text-sm text-text">{t.totals.spent}</div><div className="text-faint">paid out</div></div>
                    <div><div className="font-mono text-sm text-warn">{t.counts.pending}</div><div className="text-faint">pending</div></div>
                    <div><div className="font-mono text-sm text-danger">{t.counts.failed}</div><div className="text-faint">failed</div></div>
                  </div>
                </>
              )}
              {showFund && (
                <div className="border-t border-line pt-4">
                  <FundTreasury key={asset} agent={agentRef} spec={t ? { asset: t.asset, address: t.address, mint: t.mint, tokenProgram: t.tokenProgram, decimals: t.decimals, unit: t.unit } : undefined} compact onDone={() => { setShowFund(false); refreshAll(); }} />
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Owner controls</div>
                    <TreasuryOwnerActions key={asset} agent={agentRef} spec={t ? { asset: t.asset, address: t.address, mint: t.mint, tokenProgram: t.tokenProgram, decimals: t.decimals, unit: t.unit } : undefined} balance={t?.onchain.balance ?? "0"} onDone={refreshAll} />
                  </div>
                </div>
              )}
            </div>
          </Card>

          <ApprovalsPanel payments={d.payments} onChange={refreshAll} />

          <Card>
            <CardHeader title="Activity" subtitle="Structured log of everything the agent did" icon={<Activity className="size-4" />} />
            <ActivityFeed items={actQ.data?.activities ?? []} />
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ConsolePage() {
  const { id } = useParams<{ id: string }>();
  const { authed } = useSession();
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <AuthGate title="Creator console" reason="Sign in with the wallet that created this agent to instruct it, fund it and approve payments.">
        {authed && <Console id={id} />}
      </AuthGate>
    </div>
  );
}
