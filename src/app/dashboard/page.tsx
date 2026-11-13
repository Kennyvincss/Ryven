"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bot, Coins, Compass, Droplets, History, Rocket, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi, useAppConfig, useWalletBalances } from "@/lib/client/hooks";
import { usdcLabel, publicConfig } from "@/lib/shared/config";
import { shortAddress } from "@/lib/shared/amounts";
import { AgentCard, TokenCard, type AgentListItem, type TokenListItem } from "@/components/cards";
import { AuthGate } from "@/components/wallet-button";
import { AddressLink, Alert, Button, Card, CardHeader, Empty, PageHeader, Spinner, Stat, TxLink, timeAgo } from "@/components/ui";

function Inner() {
  const { publicKey } = useWallet();
  const wallet = publicKey!.toBase58();
  const config = useAppConfig();
  const bal = useWalletBalances(publicKey);
  const tokens = useApi<{ tokens: TokenListItem[] }>(`/api/tokens?creator=${wallet}`);
  const agents = useApi<{ agents: AgentListItem[] }>(`/api/agents?creator=${wallet}`);
  const [faucet, setFaucet] = useState<{ busy: boolean; msg: string | null; sig?: string }>({ busy: false, msg: null });

  const totalTreasury = (agents.data?.agents ?? []).reduce((s, a) => s + Number(a.treasury?.cachedBalance ?? 0), 0);
  const totalPaid = (agents.data?.agents ?? []).reduce((s, a) => s + Number(a.stats?.confirmedVolume ?? 0), 0);
  const launchedMints = new Set((tokens.data?.tokens ?? []).map((t) => t.mint));

  return (
    <div className="space-y-6">
      <Card className="grid grid-cols-2 gap-5 p-5 md:grid-cols-6">
        <div className="col-span-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-faint">Wallet</div>
          <div className="mt-1"><AddressLink address={wallet} chars={8} className="text-sm" /></div>
        </div>
        <Stat label="SOL" value={bal.sol === null ? "—" : bal.sol.toFixed(3)} hint={publicConfig.cluster} />
        <Stat label={usdcLabel} value={bal.usdc ?? "—"} />
        <Stat label="Treasury funding" value={totalTreasury.toLocaleString()} hint="across your agents" accent />
        <Stat label="Agent payments" value={totalPaid.toLocaleString()} hint={`${usdcLabel} paid`} />
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button href="/launch"><Rocket className="size-4" /> Launch Token</Button>
        <Button href="/launch" variant="agent"><Bot className="size-4" /> Deploy Agent</Button>
        {agents.data?.agents[0] && <Button href={`/console/${agents.data.agents[0].id}`} variant="secondary"><Wallet className="size-4" /> Fund Treasury</Button>}
        <Button href="/tokens" variant="secondary"><Coins className="size-4" /> Explore Tokens</Button>
        <Button href="/agents" variant="secondary"><Compass className="size-4" /> Explore Agents</Button>
        {config?.testUsdcFaucet && (
          <Button
            variant="secondary"
            loading={faucet.busy}
            onClick={async () => {
              setFaucet({ busy: true, msg: null });
              try {
                const r = await api<{ signature: string }>("/api/faucet", { method: "POST" });
                setFaucet({ busy: false, msg: `100 ${usdcLabel} sent`, sig: r.signature });
                bal.reload();
              } catch (e) {
                setFaucet({ busy: false, msg: (e as Error).message });
              }
            }}
          >
            <Droplets className="size-4" /> Get 100 Test USDC
          </Button>
        )}
      </div>
      {faucet.msg && <Alert tone={faucet.sig ? "accent" : "danger"}>{faucet.msg} {faucet.sig && <TxLink signature={faucet.sig} />}</Alert>}
      {bal.sol !== null && bal.sol < 0.01 && (
        <Alert tone="warn" title="Low devnet SOL">
          You need a little devnet SOL for transaction fees. Get some free at <a className="underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Your AI agents</h2>
          {agents.loading ? <Spinner /> : agents.data?.agents.length ? (
            <div className="grid gap-3">{agents.data.agents.map((a) => <AgentCard key={a.id} a={a} />)}</div>
          ) : (
            <Card><Empty icon={<Bot className="size-5" />} title="No agents yet" action={<Button href="/launch" variant="agent">Deploy one</Button>}>Launch a token, then deploy its agent.</Empty></Card>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">Tokens you launched</h2>
          {tokens.loading ? <Spinner /> : tokens.data?.tokens.length ? (
            <div className="grid gap-3">{tokens.data.tokens.map((t) => <TokenCard key={t.id} t={t} />)}</div>
          ) : (
            <Card><Empty icon={<Rocket className="size-5" />} title="No tokens yet" action={<Button href="/launch">Launch a token</Button>} /></Card>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tokens owned" subtitle="Read live from Solana" icon={<Coins className="size-4" />} />
          {bal.loading ? <div className="p-5"><Spinner /></div> : bal.tokens.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-muted">No token balances.</div>
          ) : (
            <ul className="divide-y divide-line">
              {bal.tokens.map((t) => (
                <li key={t.mint + t.program} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <AddressLink address={t.mint} />
                    {t.mint === publicConfig.usdcMint && <span className="text-xs text-accent">{usdcLabel}</span>}
                    {launchedMints.has(t.mint) && <span className="text-xs text-agent">your token</span>}
                  </div>
                  <span className="font-mono">{Number(t.amount).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent transactions" subtitle="Your wallet's latest signatures" icon={<History className="size-4" />} />
          {bal.history.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-muted">No transactions yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {bal.history.map((h) => (
                <li key={h.signature} className="flex items-center justify-between px-5 py-3 text-sm">
                  <TxLink signature={h.signature} label={shortAddress(h.signature, 8)} />
                  <span className={h.err ? "text-xs text-danger" : "text-xs text-faint"}>{h.err ? "failed" : h.blockTime ? timeAgo(new Date(h.blockTime * 1000)) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Dashboard" title="Your Ryven" subtitle="Balances and history are read directly from Solana. Nothing here is simulated." />
      <AuthGate>
        <Inner />
      </AuthGate>
    </div>
  );
}
