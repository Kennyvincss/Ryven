"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { ArrowUpFromLine, CandlestickChart, Coins, ExternalLink, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { explorerTx, pumpFunCoinUrl } from "@/lib/shared/config";
import { shortAddress } from "@/lib/shared/amounts";
import { AddressLink, Alert, Badge, Button, Empty, Field, Input, Spinner, Stat, Textarea, cn, timeAgo } from "./ui";

type TradeView = {
  id: string;
  mode: string;
  action: "buy" | "sell" | "swap";
  mint: string;
  amount: string;
  swap: { inputSymbol: string; outputSymbol: string; inputAmount: string | null; quotedOutput: string | null; received: string | null; valueSol: number } | null;
  reason: string;
  status: string;
  signature: string | null;
  solChange: number | null;
  error: string | null;
  policy: { summary: string };
  createdAt: string;
};
const actionTone = { buy: "accent", sell: "danger", swap: "info" } as const;

/** "buy 0.05 SOL of Abc…xyz" / "swap 10 USDC → SOL (quote ≈0.06 SOL)". */
function TradeLabel({ t, link }: { t: TradeView; link?: boolean }) {
  const badge = <Badge tone={actionTone[t.action]}>{t.action}</Badge>;
  if (t.action === "swap" && t.swap) {
    return (
      <>
        {badge}{" "}
        <span className="font-mono">
          {t.swap.inputAmount} {t.swap.inputSymbol} → {t.swap.outputSymbol}
        </span>
        {t.swap.quotedOutput && <span className="text-muted"> · quote ≈{t.swap.quotedOutput} {t.swap.outputSymbol}</span>}
      </>
    );
  }
  return (
    <>
      {badge} <span className="font-mono">{t.amount}</span> of{" "}
      {link ? (
        <a href={pumpFunCoinUrl(t.mint)} target="_blank" rel="noreferrer" className="font-mono underline">
          {shortAddress(t.mint, 5)}
        </a>
      ) : (
        <span className="font-mono text-muted">{shortAddress(t.mint, 5)}</span>
      )}
    </>
  );
}

type TradingResp = {
  settings: { mode: "off" | "proposal" | "autonomous"; maxSolPerTrade: number; dailySol: number; mints: string[] };
  spentTodaySol: number;
  wallet: { address: string; sol?: number; tokens?: { mint: string; amount: string }[]; error?: string };
  trades: TradeView[];
};

const statusTone: Record<string, "accent" | "warn" | "danger" | "info" | "neutral"> = {
  confirmed: "accent",
  awaiting_signature: "warn",
  executing: "info",
  rejected: "danger",
  failed: "danger",
  cancelled: "neutral",
};

export function TradingPanel({ agentId }: { agentId: string }) {
  const wallet = useWallet();
  const q = useApi<TradingResp>(`/api/agents/${agentId}/trading`, { refreshMs: 20000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function signAndSend(t: TradeView) {
    setBusy(t.id);
    setMsg(null);
    try {
      if (!wallet.signTransaction) throw new Error("This wallet can't sign transactions here. Try Phantom or Solflare.");
      const { transaction } = await api<{ transaction: string }>(`/api/trades/${t.id}/build`, { method: "POST" });
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0)));
      const signed = await wallet.signTransaction(tx);
      const r = await api<{ trade: TradeView }>(`/api/trades/${t.id}/submit`, { json: { signedTransaction: btoa(String.fromCharCode(...signed.serialize())) } });
      setMsg({ ok: r.trade.status === "confirmed", text: r.trade.status === "confirmed" ? "Trade confirmed on mainnet." : `Trade ${r.trade.status}: ${r.trade.error ?? ""}` });
    } catch (e) {
      const m = (e as Error).message;
      setMsg({ ok: false, text: /User rejected|rejected the request/i.test(m) ? "You rejected the trade in your wallet. Nothing was spent." : m });
    } finally {
      setBusy(null);
      q.reload();
    }
  }

  async function act(path: string, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      await api(path, { method: "POST" });
      setMsg({ ok: true, text: label === "withdraw" ? "Withdrawal sent to your wallet on mainnet." : "Done." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      q.reload();
    }
  }

  if (q.loading) return <div className="p-5"><Spinner /></div>;
  if (q.error) return <div className="p-5"><Alert tone="danger">{q.error}</Alert></div>;
  const d = q.data!;
  const pending = d.trades.filter((t) => t.status === "awaiting_signature");

  return (
    <div className="space-y-5 p-5">
      <Alert tone="warn" title="Trading uses real SOL on Solana mainnet">
        Your wallet must be on <b>Mainnet</b> to sign trades. Configure limits under Permissions.
      </Alert>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Mode" value={d.settings.mode} />
        <Stat label="Max per trade" value={`${d.settings.maxSolPerTrade} SOL`} />
        <Stat label="Spent today" value={`${d.spentTodaySol} SOL`} hint={`of ${d.settings.dailySol} SOL`} />
        <Stat label="Allowed coins" value={d.settings.mints.length} />
      </div>

      {d.settings.mode === "autonomous" && (
        <div className="rounded-xl border border-line bg-panel-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Agent trading wallet (mainnet)</div>
              <div className="mt-0.5 text-xs text-muted">
                Send SOL here to let the agent trade. It can only trade allowlisted coins within your limits.
              </div>
            </div>
            <Button size="sm" variant="danger" loading={busy === "withdraw"} onClick={() => act(`/api/agents/${agentId}/trading/withdraw`, "withdraw")}>
              <ArrowUpFromLine className="size-3.5" /> Withdraw everything to me
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <AddressLink address={d.wallet.address} chars={8} network="mainnet" className="text-sm" />
            {d.wallet.error ? <span className="text-xs text-danger">{d.wallet.error}</span> : <span className="font-mono">{d.wallet.sol} SOL</span>}
          </div>
          {!!d.wallet.tokens?.length && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {d.wallet.tokens.map((t) => (
                <li key={t.mint} className="flex justify-between">
                  <a href={pumpFunCoinUrl(t.mint)} target="_blank" rel="noreferrer" className="font-mono hover:text-text">{shortAddress(t.mint, 6)}</a>
                  <span className="font-mono">{t.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg && <Alert tone={msg.ok ? "accent" : "danger"}>{msg.text}</Alert>}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Waiting for your signature</div>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-line px-4 py-4 text-center text-sm text-muted">No trade proposals.</div>
        ) : (
          <ul className="space-y-2">
            {pending.map((t) => (
              <li key={t.id} className="rounded-xl border border-warn/30 bg-warn/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <TradeLabel t={t} link />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" loading={busy === t.id} onClick={() => signAndSend(t)}>Sign &amp; send</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(`/api/trades/${t.id}/cancel`, t.id + "c")}>Dismiss</Button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted">“{t.reason}” · {timeAgo(t.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">History</div>
        {d.trades.filter((t) => t.status !== "awaiting_signature").length === 0 ? (
          <Empty icon={<CandlestickChart className="size-5" />} title="No trades yet">Ask the agent in the terminal, e.g. “buy 0.01 SOL of &lt;coin&gt;”.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {d.trades
              .filter((t) => t.status !== "awaiting_signature")
              .map((t) => (
                <li key={t.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <TradeLabel t={t} /> <Badge>{t.mode}</Badge>
                    </div>
                    <Badge tone={statusTone[t.status] ?? "neutral"} dot>{t.status.replace("_", " ")}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>“{t.reason}”</span>
                    {t.solChange !== null && <span>SOL change {t.solChange}</span>}
                    {t.swap?.received && <span>Received {t.swap.received} {t.swap.outputSymbol}</span>}
                    {t.signature && t.status === "confirmed" && (
                      <a href={explorerTx(t.signature, "mainnet")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
                        Explorer <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  {(t.status === "rejected" || t.status === "failed") && <div className="mt-1 text-xs text-danger">{t.error ?? t.policy.summary}</div>}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Creator settings for rewards in the agent's own token. */
export function TokenRewardSettings({
  agentId,
  symbol,
  value,
  onSaved,
  asset = "token",
}: {
  agentId: string;
  symbol: string;
  value: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string } | null;
  onSaved: () => void;
  /** "token" = the agent's own coin, "sol" = native SOL. */
  asset?: "token" | "sol";
}) {
  const isSol = asset === "sol";
  const label = isSol ? "SOL" : `$${symbol}`;
  const [enabled, setEnabled] = useState(!!value);
  const [f, setF] = useState(value ?? (isSol ? { maxPerTx: "0.05", autoApproveLimit: "0.05", dailyLimit: "0.2" } : { maxPerTx: "1000", autoApproveLimit: "1000", dailyLimit: "5000" }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/agents/${agentId}`, { method: "PATCH", json: { [isSol ? "solPolicy" : "tokenPolicy"]: enabled ? f : null } });
      setMsg({ ok: true, text: enabled ? `${label} payments on. Fund the ${label} treasury from the Treasury card.` : `${label} payments off.` });
      onSaved();
    } catch (e) {
      const issues = (e as { body?: { issues?: { message: string }[] } }).body?.issues;
      setMsg({ ok: false, text: issues?.map((i) => i.message).join("; ") || (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 border-t border-line p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Coins className="size-4 text-accent" /> {isSol ? "SOL payments" : `Rewards in $${symbol}`}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      </div>
      <p className="text-xs text-muted">
        {isSol
          ? "Let the agent send plain SOL from a SOL treasury you own (held as wrapped SOL), with its own limits and on-chain allowance. Minimum 0.001 SOL per payment."
          : "Let the agent pay contributors in your own token, with its own limits and on-chain allowance."}
      </p>
      {enabled && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Max per payment" hint={label}>
            <Input inputMode="decimal" value={f.maxPerTx} onChange={(e) => setF({ ...f, maxPerTx: e.target.value })} />
          </Field>
          <Field label="Autonomous up to">
            <Input inputMode="decimal" value={f.autoApproveLimit} onChange={(e) => setF({ ...f, autoApproveLimit: e.target.value })} />
          </Field>
          <Field label="Daily limit">
            <Input inputMode="decimal" value={f.dailyLimit} onChange={(e) => setF({ ...f, dailyLimit: e.target.value })} />
          </Field>
        </div>
      )}
      <Button variant="secondary" onClick={save} loading={busy} className="w-full">Save {isSol ? "SOL payments" : "token rewards"}</Button>
      {msg && <Alert tone={msg.ok ? "accent" : "danger"}>{msg.text}</Alert>}
    </div>
  );
}

/** Creator settings for pump.fun trading (mainnet). */
export function TradingSettings({
  agentId,
  value,
  onSaved,
}: {
  agentId: string;
  value: { mode: "off" | "proposal" | "autonomous"; maxSolPerTrade: string; dailySol: string; mints: string[] };
  onSaved: () => void;
}) {
  const [f, setF] = useState({ mode: value.mode, maxSolPerTrade: value.maxSolPerTrade === "0" ? "0.05" : value.maxSolPerTrade, dailySol: value.dailySol === "0" ? "0.2" : value.dailySol, mints: value.mints.join("\n") });
  const [ack, setAck] = useState(value.mode === "autonomous");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    if (f.mode === "autonomous" && !ack) return setMsg({ ok: false, text: "Please confirm you understand autonomous trading risks." });
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/agents/${agentId}`, {
        method: "PATCH",
        json: { trading: { mode: f.mode, maxSolPerTrade: f.maxSolPerTrade, dailySol: f.dailySol, mints: f.mints.split(/[\s,]+/).filter(Boolean) } },
      });
      setMsg({ ok: true, text: "Trading settings saved." });
      onSaved();
    } catch (e) {
      const issues = (e as { body?: { issues?: { message: string }[] } }).body?.issues;
      setMsg({ ok: false, text: issues?.map((i) => i.message).join("; ") || (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 border-t border-line p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CandlestickChart className="size-4 text-warn" /> pump.fun trading (mainnet, real SOL)
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["off", "Off", "The agent can't trade."],
            ["proposal", "Proposals", "The agent proposes; you sign each trade."],
            ["autonomous", "Autonomous", "Trades by itself from its own funded wallet."],
          ] as const
        ).map(([id, title, desc]) => (
          <button
            type="button"
            key={id}
            onClick={() => setF({ ...f, mode: id })}
            className={cn("rounded-xl border p-3 text-left", f.mode === id ? (id === "autonomous" ? "border-danger/60 bg-danger/5" : "border-agent/60 bg-agent/10") : "border-line-2 bg-panel-2 hover:bg-panel-3")}
          >
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-0.5 text-xs text-muted">{desc}</div>
          </button>
        ))}
      </div>
      {f.mode !== "off" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Max SOL per trade">
              <Input inputMode="decimal" value={f.maxSolPerTrade} onChange={(e) => setF({ ...f, maxSolPerTrade: e.target.value })} />
            </Field>
            <Field label="Daily SOL limit (buys)" hint="max 25">
              <Input inputMode="decimal" value={f.dailySol} onChange={(e) => setF({ ...f, dailySol: e.target.value })} />
            </Field>
          </div>
          <Field label="Other allowed coins" hint="your own coin is always allowed · one address per line">
            <Textarea value={f.mints} onChange={(e) => setF({ ...f, mints: e.target.value })} placeholder="e.g. your coin launched on pump.fun" />
          </Field>
        </>
      )}
      {f.mode === "autonomous" && (
        <div className="space-y-2 rounded-xl border border-danger/40 bg-danger/[0.06] p-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-danger">
            <TriangleAlert className="size-4" /> Autonomous trading risk
          </div>
          <p className="text-text/80">
            The agent trades real SOL without asking you. Memecoins can go to zero. Only fund its trading wallet with an amount you&apos;re fine losing.
            Its key is held (encrypted) by this Ryven server, so a compromised server could misuse whatever is in that wallet. Limits and the
            simulation check cap each trade; &quot;Withdraw everything to me&quot; is your exit.
          </p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" /> I understand and accept these risks.
          </label>
        </div>
      )}
      <Button variant="secondary" onClick={save} loading={busy} className="w-full">Save trading settings</Button>
      {msg && <Alert tone={msg.ok ? "accent" : "danger"}>{msg.text}</Alert>}
    </div>
  );
}
