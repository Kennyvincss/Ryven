"use client";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ACCOUNT_SIZE } from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import { ArrowDownToLine, ArrowUpFromLine, Ban, KeyRound } from "lucide-react";
import { api } from "@/lib/client/api";
import { sendWalletTransaction } from "@/lib/client/wallet-tx";
import {
  buildDepositInstructions,
  buildFundTreasuryInstructions,
  buildRevokeInstructions,
  buildWithdrawInstructions,
} from "@/lib/solana/treasury";
import { toBaseUnits } from "@/lib/shared/amounts";
import { USDC_DECIMALS, publicConfig, usdcLabel } from "@/lib/shared/config";
import { Alert, Button, Field, Input, TxLink } from "./ui";

type AgentRef = { id: string; signerPubkey: string; creatorWallet: string; treasury: { address: string; mint: string } | null };

function useTx() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  async function run(agentId: string, build: () => Promise<Transaction>) {
    setBusy(true);
    setError(null);
    setSig(null);
    try {
      const tx = await build();
      const s = await sendWalletTransaction(wallet, connection, tx);
      setSig(s);
      // The server re-reads the transaction from Solana; it never trusts our numbers.
      await api(`/api/agents/${agentId}/treasury`, { json: { signature: s } });
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, sig, wallet, connection };
}

/** Creator: create/fund the treasury and set the agent's on-chain spending allowance. */
export function FundTreasury({ agent, onDone, compact }: { agent: AgentRef; onDone?: () => void; compact?: boolean }) {
  const { run, busy, error, sig, wallet, connection } = useTx();
  const [deposit, setDeposit] = useState("100");
  const [allowance, setAllowance] = useState("100");
  const [exists, setExists] = useState<boolean | null>(null);
  const [usdcBal, setUsdcBal] = useState<string | null>(null);
  const isOwner = wallet.publicKey?.toBase58() === agent.creatorWallet;

  useEffect(() => {
    if (!agent.treasury) return;
    connection.getAccountInfo(new PublicKey(agent.treasury.address)).then((a) => setExists(!!a)).catch(() => setExists(null));
    if (wallet.publicKey) {
      connection
        .getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(agent.treasury.mint) })
        .then((r) => {
          // Exclude the treasury itself (the creator owns it too).
          const accs = r.value.filter((a) => a.pubkey.toBase58() !== agent.treasury!.address);
          setUsdcBal(accs.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmountString), 0).toString());
        })
        .catch(() => setUsdcBal(null));
    }
  }, [agent.treasury, connection, wallet.publicKey, sig]);

  if (!agent.treasury) return <Alert tone="danger">This agent has no treasury record.</Alert>;
  if (!isOwner) return <Alert tone="warn">Connect the creator wallet to fund this treasury.</Alert>;

  const submit = () =>
    run(agent.id, async () => {
      const owner = wallet.publicKey!;
      const rent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
      const ixs = buildFundTreasuryInstructions({
        owner,
        agentId: agent.id,
        agentSigner: new PublicKey(agent.signerPubkey),
        mint: new PublicKey(agent.treasury!.mint),
        createAccount: exists === false,
        rentLamports: rent,
        depositAmount: deposit ? toBaseUnits(deposit, USDC_DECIMALS) : 0n,
        allowance: allowance !== "" ? toBaseUnits(allowance, USDC_DECIMALS) : null,
      });
      if (!ixs.length) throw new Error("Nothing to do");
      return new Transaction().add(...ixs);
    }).then((s) => s && onDone?.());

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="rounded-xl border border-line bg-panel-2 p-4 text-[13px] leading-relaxed text-muted">
          Your wallet signs one transaction that {exists === false ? "creates a treasury account you own, " : ""}deposits {usdcLabel} into it and
          sets the agent&apos;s <span className="text-text">on-chain allowance</span>. The agent can never spend more than the allowance, and you can
          revoke it or withdraw at any time.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Deposit (${usdcLabel})`} hint={usdcBal !== null ? `wallet: ${usdcBal}` : undefined}>
          <Input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Agent spending allowance" hint="total, on-chain">
          <Input inputMode="decimal" value={allowance} onChange={(e) => setAllowance(e.target.value)} placeholder="leave empty to keep" />
        </Field>
      </div>
      {usdcBal === "0" && (
        <Alert tone="warn" title={`You have no ${usdcLabel}`}>
          {publicConfig.usdcMint === "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" ? (
            <>
              Get devnet USDC from{" "}
              <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                faucet.circle.com
              </a>{" "}
              (choose Solana Devnet).
            </>
          ) : (
            <>Use the Test USDC faucet on your dashboard.</>
          )}
        </Alert>
      )}
      <Button onClick={submit} loading={busy} className="w-full">
        <KeyRound className="size-4" /> {exists === false ? "Create treasury, deposit & delegate" : "Deposit & set allowance"}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      {sig && (
        <Alert tone="accent" title="Confirmed on Solana">
          <TxLink signature={sig} label="View on Explorer" />
        </Alert>
      )}
    </div>
  );
}

/** Creator-only advanced actions: revoke (on-chain kill switch) and withdraw. */
export function TreasuryOwnerActions({ agent, balance, onDone }: { agent: AgentRef; balance: string; onDone?: () => void }) {
  const { run, busy, error, sig, wallet } = useTx();
  const [amount, setAmount] = useState("");
  if (wallet.publicKey?.toBase58() !== agent.creatorWallet || !agent.treasury) return null;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input inputMode="decimal" placeholder={`Withdraw amount (max ${balance})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button
          variant="secondary"
          loading={busy}
          onClick={() =>
            run(agent.id, async () =>
              new Transaction().add(
                ...buildWithdrawInstructions(wallet.publicKey!, agent.id, new PublicKey(agent.treasury!.mint), toBaseUnits(amount || balance, USDC_DECIMALS)),
              ),
            ).then((s) => s && onDone?.())
          }
        >
          <ArrowUpFromLine className="size-4" /> Withdraw
        </Button>
      </div>
      <Button
        variant="danger"
        className="w-full"
        loading={busy}
        onClick={() => run(agent.id, async () => new Transaction().add(...buildRevokeInstructions(wallet.publicKey!, agent.id))).then((s) => s && onDone?.())}
      >
        <Ban className="size-4" /> Revoke agent allowance on-chain
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      {sig && (
        <Alert tone="accent" title="Confirmed">
          <TxLink signature={sig} />
        </Alert>
      )}
    </div>
  );
}

/** Anyone can deposit into an agent treasury (sponsors, community). */
export function DepositToTreasury({ agent, onDone }: { agent: AgentRef; onDone?: () => void }) {
  const { run, busy, error, sig, wallet } = useTx();
  const [amount, setAmount] = useState("10");
  if (!agent.treasury) return null;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button
          variant="secondary"
          loading={busy}
          disabled={!wallet.publicKey}
          onClick={() =>
            run(agent.id, async () =>
              new Transaction().add(
                ...buildDepositInstructions(wallet.publicKey!, new PublicKey(agent.treasury!.address), new PublicKey(agent.treasury!.mint), toBaseUnits(amount, USDC_DECIMALS)),
              ),
            ).then((s) => s && onDone?.())
          }
        >
          <ArrowDownToLine className="size-4" /> Deposit
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {sig && (
        <Alert tone="accent" title="Deposit confirmed">
          <TxLink signature={sig} />
        </Alert>
      )}
    </div>
  );
}
