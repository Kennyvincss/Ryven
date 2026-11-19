"use client";
/**
 * One-click actions the agent hands to the creator: the console pops a dialog with the right
 * button (approve, sign, enable, add, raise, fund, resume) instead of sending them to another
 * tab. Every change goes through the normal creator-only API or the creator's own wallet.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { BellRing, CheckCircle2, ExternalLink, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useNetworkConnection } from "@/lib/client/network";
import { friendlyError, sendWalletTransaction } from "@/lib/client/wallet-tx";
import { toRaw } from "@/lib/client/live";
import { explorerTx } from "@/lib/shared/config";
import { FundTreasury, type AgentRef, type TreasurySpec } from "./treasury-actions";
import { Alert, Button, Field, Input, cn } from "./ui";

export type ConsoleAction =
  | { kind: "approve_payment"; key: string; paymentId: string; title: string; reason: string }
  | { kind: "sign_trade"; key: string; tradeId: string; title: string; reason: string }
  | { kind: "enable_trading"; key: string; title: string; reason: string }
  | { kind: "allow_coins"; key: string; mints: string[]; title: string; reason: string }
  | { kind: "raise_trade_limits"; key: string; neededSol: string; title: string; reason: string }
  | { kind: "fund_trading_wallet"; key: string; address: string; neededSol: string; title: string; reason: string }
  | { kind: "enable_asset"; key: string; asset: "sol" | "token"; title: string; reason: string }
  | { kind: "fund_treasury"; key: string; asset: "usdc" | "sol" | "token"; title: string; reason: string }
  | { kind: "add_contributor"; key: string; wallet: string; title: string; reason: string }
  | { kind: "raise_payment_limits"; key: string; asset: "usdc" | "sol" | "token"; title: string; reason: string }
  | { kind: "resume_agent"; key: string; title: string; reason: string };

type AgentResp = {
  agent: {
    policy: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string; categories: string[]; recipientPolicy: "allowlist_only" | "allowlist_or_approval" };
    mode: "autonomous" | "approval";
    tokenPolicy: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string } | null;
    solPolicy: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string } | null;
  };
  private: { trading: { mode: "off" | "proposal" | "autonomous"; maxSolPerTrade: string; dailySol: string; mints: string[] } } | null;
};

const num = (s: string) => Number(s) || 0;
const maxStr = (a: string, b: string) => (num(a) >= num(b) ? a : b);

/** Signs a proposed trade with the creator's wallet (build → sign → submit). */
export function useSignTrade() {
  const wallet = useWallet();
  return useCallback(
    async (tradeId: string) => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      if (!wallet.signTransaction) throw new Error("This wallet can't sign here. Try Phantom or Solflare.");
      const { transaction } = await api<{ transaction: string }>(`/api/trades/${tradeId}/build`, { method: "POST" });
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0)));
      let signed: VersionedTransaction;
      try {
        signed = await wallet.signTransaction(tx);
      } catch (e) {
        throw new Error(friendlyError(e));
      }
      const r = await api<{ trade: { status: string; signature: string | null; error: string | null } }>(`/api/trades/${tradeId}/submit`, {
        json: { signedTransaction: btoa(String.fromCharCode(...signed.serialize())) },
      });
      if (r.trade.status !== "confirmed") throw new Error(`Trade ${r.trade.status}${r.trade.error ? `: ${r.trade.error}` : ""}`);
      return r.trade.signature;
    },
    [wallet],
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-white/[0.1] bg-panel bg-gradient-to-b from-accent/[0.06] to-transparent p-5 shadow-2xl shadow-black/60">{children}</div>
    </div>
  );
}

function Limits({ v, set, unit }: { v: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string }; set: (v: { maxPerTx: string; autoApproveLimit: string; dailyLimit: string }) => void; unit: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Field label={`Max / payment (${unit})`}>
        <Input inputMode="decimal" value={v.maxPerTx} onChange={(e) => set({ ...v, maxPerTx: e.target.value })} />
      </Field>
      <Field label="Auto-pay up to">
        <Input inputMode="decimal" value={v.autoApproveLimit} onChange={(e) => set({ ...v, autoApproveLimit: e.target.value })} />
      </Field>
      <Field label="Daily limit">
        <Input inputMode="decimal" value={v.dailyLimit} onChange={(e) => set({ ...v, dailyLimit: e.target.value })} />
      </Field>
    </div>
  );
}

/** The body of one action: its form and its buttons. Calls onDone(text) on success. */
function ActionBody({ action: a, agent, onDone }: { action: ConsoleAction; agent: AgentRef; onDone: (text: string, sig?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AgentResp | null>(null);
  // sensible defaults so the form is never blank, replaced by the agent's current settings once loaded
  const [form, setForm] = useState<Record<string, string>>((): Record<string, string> => (a.kind === "enable_trading" ? { mode: "proposal", max: "0.05", daily: "0.2" } : {}));
  const [ack, setAck] = useState(false);
  const [spec, setSpec] = useState<TreasurySpec | null>(null);
  const signTrade = useSignTrade();
  const wallet = useWallet();
  const mainnet = useNetworkConnection("mainnet");

  const needsCfg = ["enable_trading", "allow_coins", "raise_trade_limits", "enable_asset", "raise_payment_limits"].includes(a.kind);
  useEffect(() => {
    if (!needsCfg) return;
    api<AgentResp>(`/api/agents/${agent.id}`)
      .then((d) => {
        setCfg(d);
        const t = d.private?.trading;
        if (a.kind === "enable_trading") setForm({ mode: "proposal", max: t && num(t.maxSolPerTrade) > 0 ? t.maxSolPerTrade : "0.05", daily: t && num(t.dailySol) > 0 ? t.dailySol : "0.2" });
        if (a.kind === "raise_trade_limits" && t) setForm({ max: maxStr(t.maxSolPerTrade, a.neededSol), daily: maxStr(t.dailySol, a.neededSol) });
        const assetPolicy = (asset: "usdc" | "sol" | "token") =>
          asset === "usdc" ? d.agent.policy : asset === "sol" ? d.agent.solPolicy : d.agent.tokenPolicy;
        if (a.kind === "enable_asset") {
          const cur = assetPolicy(a.asset);
          setForm(cur ?? (a.asset === "sol" ? { maxPerTx: "0.05", autoApproveLimit: "0.01", dailyLimit: "0.2" } : { maxPerTx: "1000", autoApproveLimit: "100", dailyLimit: "10000" }));
        }
        if (a.kind === "raise_payment_limits") {
          const cur = assetPolicy(a.asset);
          if (cur) setForm({ maxPerTx: cur.maxPerTx, autoApproveLimit: cur.autoApproveLimit, dailyLimit: cur.dailyLimit });
        }
      })
      .catch((e) => setErr((e as Error).message));
  }, [a, agent.id, needsCfg]);

  useEffect(() => {
    if (a.kind !== "fund_treasury") return;
    api<{ address: string; mint: string; tokenProgram: string; decimals: number; unit: string }>(`/api/agents/${agent.id}/treasury?asset=${a.asset}`)
      .then((t) => setSpec({ asset: a.asset, address: t.address, mint: t.mint, tokenProgram: t.tokenProgram, decimals: t.decimals, unit: t.unit }))
      .catch((e) => setErr((e as Error).message));
  }, [a, agent.id]);

  async function run(fn: () => Promise<void | { text: string; sig?: string }>, doneText: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      onDone(r?.text ?? doneText, r?.sig);
    } catch (e) {
      const m = (e as Error & { body?: { issues?: { message: string }[] } }).body?.issues?.map((i) => i.message).join("; ") || (e as Error).message;
      setErr(m);
    } finally {
      setBusy(false);
    }
  }
  const patch = (json: unknown) => api(`/api/agents/${agent.id}`, { method: "PATCH", json });
  const trading = cfg?.private?.trading;

  let body: React.ReactNode = null;
  let buttons: React.ReactNode = null;

  switch (a.kind) {
    case "approve_payment":
      buttons = (
        <>
          <Button variant="ghost" loading={busy} onClick={() => run(() => api(`/api/payments/${a.paymentId}/reject`, { method: "POST" }).then(() => undefined), "Payment rejected.")}>
            Reject
          </Button>
          <Button loading={busy} onClick={() => run(() => api(`/api/payments/${a.paymentId}/approve`, { method: "POST" }).then(() => undefined), "Payment approved and sent.")}>
            Approve
          </Button>
        </>
      );
      break;
    case "sign_trade":
      body = <p className="text-xs text-muted">Your wallet will show the exact transaction. Ryyven checked it and simulated it on Solana first.</p>;
      buttons = (
        <>
          <Button variant="ghost" loading={busy} onClick={() => run(() => api(`/api/trades/${a.tradeId}/cancel`, { method: "POST" }).then(() => undefined), "Trade dismissed.")}>
            Dismiss
          </Button>
          <Button loading={busy} onClick={() => run(async () => ({ text: "Trade confirmed on Solana.", sig: (await signTrade(a.tradeId)) ?? undefined }), "")}>
            Sign &amp; send
          </Button>
        </>
      );
      break;
    case "enable_trading":
      body = (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["proposal", "autonomous"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setForm({ ...form, mode: m })} className={cn("rounded-xl border p-2.5 text-left text-xs", form.mode === m ? (m === "autonomous" ? "border-danger/60 bg-danger/5" : "border-agent/60 bg-agent/10") : "border-line-2")}>
                <div className="font-semibold">{m === "proposal" ? "Proposals" : "Autonomous"}</div>
                <div className="text-muted">{m === "proposal" ? "You sign each trade" : "Agent trades from its own wallet"}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Max SOL per trade">
              <Input inputMode="decimal" value={form.max ?? ""} onChange={(e) => setForm({ ...form, max: e.target.value })} />
            </Field>
            <Field label="Daily SOL limit">
              <Input inputMode="decimal" value={form.daily ?? ""} onChange={(e) => setForm({ ...form, daily: e.target.value })} />
            </Field>
          </div>
          {form.mode === "autonomous" && (
            <label className="flex items-start gap-2 text-xs text-danger">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" /> I understand the agent trades real SOL without asking me.
            </label>
          )}
        </div>
      );
      buttons = (
        <Button
          loading={busy}
          disabled={!cfg || (form.mode === "autonomous" && !ack)}
          onClick={() => run(() => patch({ trading: { mode: form.mode, maxSolPerTrade: form.max, dailySol: form.daily, mints: trading?.mints ?? [] } }).then(() => undefined), "Trading is on.")}
        >
          Turn on trading
        </Button>
      );
      break;
    case "allow_coins":
      body = (
        <ul className="space-y-1 font-mono text-xs text-muted">
          {a.mints.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      );
      buttons = (
        <Button
          loading={busy}
          disabled={!trading}
          onClick={() =>
            run(
              () =>
                patch({ trading: { mode: trading!.mode, maxSolPerTrade: trading!.maxSolPerTrade, dailySol: trading!.dailySol, mints: [...new Set([...trading!.mints, ...a.mints])] } }).then(() => undefined),
              "Coin added to your trading allowlist.",
            )
          }
        >
          Allow
        </Button>
      );
      break;
    case "raise_trade_limits":
      body = (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Max SOL per trade">
            <Input inputMode="decimal" value={form.max ?? ""} onChange={(e) => setForm({ ...form, max: e.target.value })} />
          </Field>
          <Field label="Daily SOL limit">
            <Input inputMode="decimal" value={form.daily ?? ""} onChange={(e) => setForm({ ...form, daily: e.target.value })} />
          </Field>
        </div>
      );
      buttons = (
        <Button
          loading={busy}
          disabled={!trading}
          onClick={() => run(() => patch({ trading: { mode: trading!.mode, maxSolPerTrade: form.max, dailySol: form.daily, mints: trading!.mints } }).then(() => undefined), "Trading limits updated.")}
        >
          Save limits
        </Button>
      );
      break;
    case "fund_trading_wallet":
      body = (
        <Field label="SOL to send to the agent's trading wallet" hint={<span className="font-mono">{a.address}</span>}>
          <Input inputMode="decimal" value={form.amount ?? a.neededSol} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
      );
      buttons = (
        <Button
          loading={busy}
          onClick={() =>
            run(async () => {
              if (!wallet.publicKey) throw new Error("Connect your wallet first.");
              const lamports = toRaw(form.amount ?? a.neededSol, 9);
              if (!lamports || lamports <= 0n) throw new Error("Enter an amount.");
              const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(a.address), lamports }));
              const sig = await sendWalletTransaction(wallet, mainnet, tx);
              return { text: "Trading wallet funded.", sig };
            }, "")
          }
        >
          Send SOL
        </Button>
      );
      break;
    case "enable_asset":
    case "raise_payment_limits": {
      const asset = a.kind === "enable_asset" ? a.asset : a.asset;
      const unit = asset === "usdc" ? "USDC" : asset === "sol" ? "SOL" : "tokens";
      body = <Limits v={{ maxPerTx: form.maxPerTx ?? "", autoApproveLimit: form.autoApproveLimit ?? "", dailyLimit: form.dailyLimit ?? "" }} set={(v) => setForm({ ...form, ...v })} unit={unit} />;
      buttons = (
        <Button
          loading={busy}
          disabled={!cfg}
          onClick={() =>
            run(async () => {
              const v = { maxPerTx: form.maxPerTx, autoApproveLimit: form.autoApproveLimit, dailyLimit: form.dailyLimit };
              if (asset === "sol") await patch({ solPolicy: v });
              else if (asset === "token") await patch({ tokenPolicy: v });
              else
                await patch({
                  policy: { ...cfg!.agent.policy, mode: cfg!.agent.mode, ...v, autoApproveLimit: cfg!.agent.mode === "approval" ? "0" : v.autoApproveLimit },
                });
            }, a.kind === "enable_asset" ? "Turned on." : "Limits updated.")
          }
        >
          {a.kind === "enable_asset" ? "Turn on" : "Save limits"}
        </Button>
      );
      break;
    }
    case "fund_treasury":
      body = spec ? <FundTreasury agent={agent} spec={spec} compact onDone={() => onDone("Treasury updated.")} /> : <p className="text-xs text-muted">Loading treasury…</p>;
      break;
    case "add_contributor":
      body = (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name / handle">
            <Input value={form.handle ?? ""} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="alice" />
          </Field>
          <Field label="Role">
            <Input value={form.role ?? "community"} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </Field>
          <div className="col-span-2 font-mono text-[11px] text-muted">{a.wallet}</div>
        </div>
      );
      buttons = (
        <Button
          loading={busy}
          disabled={!form.handle?.trim()}
          onClick={() =>
            run(
              () =>
                api(`/api/agents/${agent.id}/contributors`, { json: { wallet: a.wallet, handle: form.handle.trim(), role: form.role ?? "community", activityScore: 0, note: "" } }).then(() => undefined),
              "Contributor added.",
            )
          }
        >
          Add contributor
        </Button>
      );
      break;
    case "resume_agent":
      buttons = (
        <Button loading={busy} onClick={() => run(() => api(`/api/agents/${agent.id}/status`, { json: { action: "resume" } }).then(() => undefined), "Agent resumed.")}>
          Resume agent
        </Button>
      );
      break;
  }

  return (
    <div className="space-y-4">
      {body}
      {err && <Alert tone="danger">{err}</Alert>}
      {buttons && <div className="flex justify-end gap-2">{buttons}</div>}
    </div>
  );
}

/** Pops up the first open action; done/closed ones stay as cards in the terminal. */
export function ActionDialog({
  action,
  agent,
  onClose,
  onResolved,
  onRetry,
}: {
  action: ConsoleAction;
  agent: AgentRef;
  onClose: () => void;
  onResolved: (key: string, text: string) => void;
  onRetry?: () => void;
}) {
  const [done, setDone] = useState<{ text: string; sig?: string } | null>(null);
  const retryable = !["approve_payment", "sign_trade"].includes(action.kind);
  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <BellRing className="mt-0.5 size-4 shrink-0 text-agent" />
          <div>
            <h2 className="text-base font-semibold">{action.title}</h2>
            <p className="mt-0.5 text-xs text-muted">{action.reason}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-4">
        {done ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-accent">
              <CheckCircle2 className="size-4" /> {done.text}
              {done.sig && (
                <a href={explorerTx(done.sig, "mainnet")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-info underline">
                  View <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              {retryable && onRetry && (
                <Button
                  onClick={() => {
                    onClose();
                    onRetry();
                  }}
                >
                  <RotateCcw className="size-3.5" /> Retry my request
                </Button>
              )}
            </div>
          </div>
        ) : (
          <ActionBody
            action={action}
            agent={agent}
            onDone={(text, sig) => {
              setDone({ text, sig });
              onResolved(action.key, text);
            }}
          />
        )}
      </div>
    </Modal>
  );
}

/** Inline reminder in the terminal; clicking reopens the dialog. */
export function ActionCard({ action, resolved, onOpen }: { action: ConsoleAction; resolved?: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!!resolved}
      className={cn("flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left font-sans", resolved ? "border-accent/30 bg-accent/5" : "border-agent/40 bg-agent/10 hover:bg-agent/15")}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{action.title}</span>
        <span className="block truncate text-[11px] text-muted">{resolved ?? action.reason}</span>
      </span>
      {resolved ? <CheckCircle2 className="size-4 shrink-0 text-accent" /> : <span className="shrink-0 rounded-lg bg-agent px-2.5 py-1 text-[11px] font-semibold text-black">Open</span>}
    </button>
  );
}
