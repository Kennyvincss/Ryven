"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bot, ExternalLink, Globe, LineChart, MessageCircle, Send } from "lucide-react";
import { useApi, useAppConfig } from "@/lib/client/hooks";
import { explorerAddress, explorerTx, pumpFunCoinUrl, usdcLabel } from "@/lib/shared/config";
import { formatCompact } from "@/lib/shared/amounts";
import { PaymentStatus } from "@/components/cards";
import { AddressLink, AgentAvatar, Alert, Badge, Button, Card, CardHeader, Empty, Spinner, Stat, TokenImage, TxLink, timeAgo } from "@/components/ui";

type Resp = {
  token: {
    mint: string;
    name: string;
    symbol: string;
    description: string;
    imageUri: string | null;
    metadataUri: string;
    creatorWallet: string;
    totalSupply: string;
    launchMode: "fixed_supply" | "bonding_curve" | "pumpfun";
    network: "devnet" | "mainnet";
    launchStatus: string;
    launchSignature: string;
    website: string | null;
    twitter: string | null;
    telegram: string | null;
    createdAt: string;
  };
  onchain: { supply: string; mintAuthority: string | null; freezeAuthority: string | null } | null;
  holders: number | null;
  trades: { id: string; side: string; trader: string; solAmount: string; tokenAmount: string; signature: string; blockTime: string }[];
  agent: {
    id: string;
    name: string;
    description: string;
    objectives: string;
    avatarSeed: string;
    status: string;
    mode: string;
    policy: { maxPerTx: string; dailyLimit: string; categories: string[] };
    treasury: { address: string; cachedBalance: string; totalSpent: string } | null;
    stats: { confirmedPayments: number; confirmedVolume: string } | null;
  } | null;
};

type AgentPayments = { payments: { id: string; amount: string; recipient: string; reason: string; status: string; signature: string | null; createdAt: string }[] };

export default function TokenPage() {
  const { mint } = useParams<{ mint: string }>();
  const { publicKey } = useWallet();
  const config = useAppConfig();
  const { data, loading, error } = useApi<Resp>(`/api/tokens/${mint}`);
  const pays = useApi<AgentPayments>(data?.agent ? `/api/agents/${data.agent.id}` : null);

  if (loading) return <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6"><Spinner /></div>;
  if (error || !data) return <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6"><Alert tone="danger">{error ?? "Not found"}</Alert></div>;
  const { token: t, agent: a } = data;
  const isCreator = publicKey?.toBase58() === t.creatorWallet;
  const confirmed = (pays.data?.payments ?? []).filter((p) => p.status === "confirmed").slice(0, 8);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <TokenImage src={t.imageUri} symbol={t.symbol} size={80} className="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
            <span className="font-mono text-muted">${t.symbol}</span>
            <Badge tone="accent" dot>
              {t.launchStatus === "live" ? "Live" : t.launchStatus}
            </Badge>
            <Badge>{t.launchMode === "fixed_supply" ? "Fixed supply" : t.launchMode === "pumpfun" ? "pump.fun" : "Bonding curve"}</Badge>
            {t.network === "mainnet" && <Badge tone="warn">Solana mainnet</Badge>}
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">{t.description || "No description."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>Mint <AddressLink address={t.mint} chars={6} network={t.network} /></span>
            <span>Creator <AddressLink address={t.creatorWallet} network={t.network} /></span>
            <a href={explorerTx(t.launchSignature, t.network)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-info hover:underline">
              launch tx <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
        <div className="flex gap-2">
          {t.website && <Button variant="secondary" size="sm" href={t.website}><Globe className="size-3.5" /></Button>}
          {t.twitter && <Button variant="secondary" size="sm" href={t.twitter}><MessageCircle className="size-3.5" /></Button>}
          {t.telegram && <Button variant="secondary" size="sm" href={t.telegram}><Send className="size-3.5" /></Button>}
        </div>
      </div>

      <Card className="mt-6 grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Total supply" value={formatCompact(Number(data.onchain?.supply ?? t.totalSupply))} hint="read from mint" />
        <Stat label="Holders" value={data.holders ?? "—"} hint={t.network === "mainnet" ? "see pump.fun" : "token accounts with balance"} />
        <Stat label="Mint authority" value={data.onchain ? (data.onchain.mintAuthority ? "Active" : "Revoked") : "—"} hint={data.onchain?.mintAuthority ? "can mint more" : "supply is fixed forever"} />
        <Stat label="Market cap" value="—" hint={t.launchMode === "fixed_supply" ? "no curve market" : t.launchMode === "pumpfun" ? "see pump.fun" : "from curve price"} />
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Trading" subtitle="Bonding-curve market" icon={<LineChart className="size-4" />} />
            <div className="p-5">
              {t.launchMode === "pumpfun" ? (
                <div className="space-y-3">
                  <Alert tone="accent" title="Trades on pump.fun">
                    This coin was created on pump.fun (Solana mainnet). Its bonding curve, price and trading live on pump.fun.
                  </Alert>
                  <Button href={pumpFunCoinUrl(t.mint)}>
                    Trade on pump.fun <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              ) : t.launchMode === "fixed_supply" ? (
                <Alert tone="info" title="No bonding curve for this token">
                  This token was launched with a fixed supply minted to its creator, so it has no on-chain curve market on Ryven. Bonding-curve launches
                  require the <code className="font-mono">ryven_curve</code> program{config?.curveProgramId ? "" : ", which is not deployed on this deployment (see docs/SETUP.md)"}.
                  Holders can still transfer it with any Solana wallet.
                </Alert>
              ) : (
                <Alert tone="warn">Bonding-curve trading UI is not enabled in this build.</Alert>
              )}
              <div className="mt-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Trade history</div>
                {data.trades.length === 0 ? (
                  <div className="rounded-xl border border-line bg-panel-2 px-4 py-6 text-center text-sm text-muted">No verified trades recorded.</div>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.trades.map((tr) => (
                      <li key={tr.id} className="flex items-center justify-between py-2 text-sm">
                        <Badge tone={tr.side === "buy" ? "accent" : "danger"}>{tr.side}</Badge>
                        <TxLink signature={tr.signature} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Community rewards" subtitle="Confirmed agent payments, each one a Solana transaction" />
            {confirmed.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-muted">No reward payments yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {confirmed.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold">
                        {p.amount} {usdcLabel} <span className="font-sans text-xs font-normal text-muted">→ <AddressLink address={p.recipient} /></span>
                      </div>
                      <div className="truncate text-xs text-muted">{p.reason}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <PaymentStatus status={p.status} />
                      <div className="mt-1 text-[11px] text-faint">{p.signature && <TxLink signature={p.signature} label="Explorer" />}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="AI Agent" icon={<Bot className="size-4" />} />
            {a ? (
              <div className="p-5">
                <div className="flex items-center gap-3">
                  <AgentAvatar seed={a.avatarSeed} size={48} />
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="mt-0.5 flex gap-1.5">
                      {a.status === "active" ? <Badge tone="accent" dot>Active</Badge> : <Badge tone="warn">Paused</Badge>}
                      <Badge tone="agent">{a.mode}</Badge>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted">{a.objectives || a.description}</p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Stat label="Treasury" value={Number(a.treasury?.cachedBalance ?? 0).toLocaleString()} hint={`${usdcLabel} · last sync`} />
                  <Stat label="Paid out" value={Number(a.stats?.confirmedVolume ?? 0).toLocaleString()} hint={`${a.stats?.confirmedPayments ?? 0} payments`} />
                  <Stat label="Max / payment" value={a.policy.maxPerTx} />
                  <Stat label="Daily limit" value={a.policy.dailyLimit} />
                </div>
                <div className="mt-4 flex gap-2">
                  <Button href={`/agents/${a.id}`} variant="secondary" size="sm" className="flex-1">Public profile</Button>
                  {isCreator && <Button href={`/console/${a.id}`} variant="agent" size="sm" className="flex-1">Open console</Button>}
                </div>
                {a.treasury && (
                  <a href={explorerAddress(a.treasury.address)} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1 text-xs text-info hover:underline">
                    Treasury on Explorer <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            ) : t.network === "mainnet" ? (
              <Empty icon={<Bot className="size-5" />} title="Agents not available on mainnet yet">
                Agent treasuries and payments run on devnet in this build. Launch a devnet token to deploy an agent.
              </Empty>
            ) : isCreator ? (
              <Empty icon={<Bot className="size-5" />} title="Deploy Your AI Agent" action={<Button variant="agent" href={`/launch?token=${t.mint}`}>Deploy agent</Button>}>
                Give ${t.symbol} an autonomous agent with its own treasury and spending limits.
              </Empty>
            ) : (
              <Empty icon={<Bot className="size-5" />} title="No agent yet">The creator hasn&apos;t deployed an agent for this token.</Empty>
            )}
          </Card>
          <Card className="p-5 text-xs text-muted">
            <div className="mb-2 font-semibold text-text">Creator</div>
            <AddressLink address={t.creatorWallet} chars={8} />
            <div className="mt-2">Launched {timeAgo(t.createdAt)} · <Link className="underline" href={t.metadataUri} target="_blank">metadata</Link></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
