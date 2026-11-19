"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Circle, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useNetworkConnection } from "@/lib/client/network";
import { sendWalletTransaction } from "@/lib/client/wallet-tx";
import { buildCloseTreasuryInstructions } from "@/lib/solana/treasury";
import { Modal } from "./console-actions";
import { Alert, Button, Field, Input, Spinner } from "./ui";

type Closeout = {
  treasuries: { asset: "usdc" | "sol" | "token"; address: string; mint: string; tokenProgram: string; decimals: number; unit: string; exists: boolean; balance: string; rawBalance: string }[];
  tradingWallet: { address: string; sol: number; tokens: number };
  inFlight: number;
  blockers: string[];
};

type Props = {
  agent: { id: string; name: string; status: "active" | "paused"; creatorWallet: string; network: "devnet" | "mainnet" };
};

const DUST_SOL = 0.00001;

/** "Delete agent" button + popup: returns every fund to the creator, then deletes the agent. */
export function DeleteAgentButton({ agent }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-danger hover:text-danger">
        <Trash2 className="size-3.5" /> Delete
      </Button>
      {open && <DeleteAgentDialog agent={agent} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteAgentDialog({ agent, onClose }: Props & { onClose: () => void }) {
  const router = useRouter();
  const wallet = useWallet();
  const connection = useNetworkConnection(agent.network);
  const closeoutQ = useApi<Closeout>(`/api/agents/${agent.id}/closeout`);
  const c = closeoutQ.data ?? null;
  const loadError = c ? null : closeoutQ.error;
  const load = closeoutQ.reload;
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withFunds = (c?.treasuries ?? []).filter((t) => t.exists && t.rawBalance !== "0");
  const toClose = (c?.treasuries ?? []).filter((t) => t.exists);
  const tradingHasFunds = !!c && (c.tradingWallet.tokens > 0 || c.tradingWallet.sol > DUST_SOL);
  const isCreatorWallet = wallet.publicKey?.toBase58() === agent.creatorWallet;
  const confirmed = confirmText.trim().toLowerCase() === agent.name.trim().toLowerCase();

  async function run() {
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      if (agent.status === "active") {
        setStep("Pausing the agent…");
        await api(`/api/agents/${agent.id}/status`, { json: { action: "pause", reason: "Being deleted by creator" } });
      }
      if (tradingHasFunds) {
        setStep("Moving the trading wallet back to you…");
        await api(`/api/agents/${agent.id}/trading/withdraw`, { method: "POST" });
      }
      if (toClose.length) {
        if (!isCreatorWallet) throw new Error("Connect the wallet that created this agent to return the treasury funds.");
        setStep("Approve in your wallet: return treasury funds and close the accounts…");
        const owner = wallet.publicKey!;
        const tx = new Transaction();
        for (const t of toClose) {
          tx.add(
            ...buildCloseTreasuryInstructions(owner, agent.id, {
              asset: t.asset,
              mint: new PublicKey(t.mint),
              programId: new PublicKey(t.tokenProgram),
              decimals: t.decimals,
              balance: BigInt(t.rawBalance),
            }),
          );
        }
        await sendWalletTransaction(wallet, connection, tx);
      }
      setStep("Deleting the agent…");
      await api(`/api/agents/${agent.id}`, { method: "DELETE" });
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setStep(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? () => undefined : onClose}>
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
          <Trash2 className="size-4" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">Delete agent</div>
          <h2 className="text-lg font-semibold">Delete {agent.name}?</h2>
        </div>
      </div>

      {!c && !loadError && (
        <div className="py-6">
          <Spinner />
          <p className="mt-2 text-center text-xs text-muted">Checking the agent&apos;s balances…</p>
        </div>
      )}
      {loadError && (
        <div className="mt-4 space-y-3">
          <Alert tone="danger">{loadError}</Alert>
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {c && (
        <div className="mt-4 space-y-4">
          <ul className="space-y-2.5 text-sm">
            {agent.status === "active" && <StepItem>Pause the agent so it stops paying and trading.</StepItem>}
            {tradingHasFunds && (
              <StepItem>
                Move the trading wallet back to you: {c.tradingWallet.sol.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL
                {c.tradingWallet.tokens > 0 ? ` and ${c.tradingWallet.tokens} coin${c.tradingWallet.tokens > 1 ? "s" : ""}` : ""}.
              </StepItem>
            )}
            {toClose.length > 0 && (
              <StepItem>
                {withFunds.length ? (
                  <>Return {withFunds.map((t) => `${Number(t.balance).toLocaleString()} ${t.unit}`).join(" + ")} from the treasury to your wallet and close it.</>
                ) : (
                  <>Close the empty treasury account{toClose.length > 1 ? "s" : ""}.</>
                )}{" "}
                <span className="text-muted">One wallet approval. The account rent comes back to you too.</span>
              </StepItem>
            )}
            <StepItem>
              Delete the agent with its settings, history, contributors, alerts and briefs.{" "}
              <span className="text-muted">Your coin stays live, and you can deploy a new agent for it later.</span>
            </StepItem>
          </ul>

          {c.inFlight > 0 && <Alert tone="warn">{c.inFlight} payment(s) or trade(s) are still being sent. Wait a minute, then try again.</Alert>}
          {toClose.length > 0 && !isCreatorWallet && <Alert tone="warn">Connect the wallet that created this agent to return the treasury funds.</Alert>}

          <Field label={`Type "${agent.name}" to confirm`}>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={agent.name} autoFocus disabled={busy} />
          </Field>

          {step && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Spinner className="size-3.5" /> {step}
            </div>
          )}
          {error && <Alert tone="danger">{error}</Alert>}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={run} loading={busy} disabled={busy || !confirmed || c.inFlight > 0 || (toClose.length > 0 && !isCreatorWallet)}>
              <Trash2 className="size-4" /> Delete agent
            </Button>
          </div>
          <p className="text-center text-[11px] text-faint">This can&apos;t be undone.</p>
        </div>
      )}
    </Modal>
  );
}

function StepItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Circle className="mt-1 size-3 shrink-0 text-accent" />
      <span>{children}</span>
    </li>
  );
}
