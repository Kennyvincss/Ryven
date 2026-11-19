"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNetworkConnection } from "@/lib/client/network";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID, getAccountLenForMint, getMint } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { buildFundSolTreasuryInstructions, buildWithdrawSolInstructions } from "@/lib/solana/sol-payment";
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
import { APP_NETWORK, CIRCLE_DEVNET_USDC, USDC_DECIMALS, publicConfig, usdcLabelFor } from "@/lib/shared/config";
import { Alert, Button, Field, Input, TxLink } from "./ui";

export type AgentRef = {
  id: string;
  signerPubkey: string;
  creatorWallet: string;
  network?: "devnet" | "mainnet";
  treasury: { address: string; mint: string } | null;
};

/** Which treasury an action targets. Omitted = the agent's USDC treasury. */
export type TreasurySpec = { asset: "usdc" | "token" | "sol"; address: string; mint: string; tokenProgram: string; decimals: number; unit: string };

function resolveSpec(agent: AgentRef, spec?: TreasurySpec): TreasurySpec | null {
  if (spec) return spec;
  if (!agent.treasury) return null;
  return { asset: "usdc", address: agent.treasury.address, mint: agent.treasury.mint, tokenProgram: TOKEN_PROGRAM_ID.toBase58(), decimals: USDC_DECIMALS, unit: usdcLabelFor(agent.network ?? APP_NETWORK) };
}

function useTx(network: "devnet" | "mainnet" = APP_NETWORK) {
  const wallet = useWallet();
  const connection = useNetworkConnection(network);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  async function run(agentId: string, build: () => Promise<Transaction | { tx: Transaction; signers: Keypair[] }>) {
    setBusy(true);
    setError(null);
    setSig(null);
    try {
      const built = await build();
      const { tx, signers } = built instanceof Transaction ? { tx: built, signers: [] as Keypair[] } : built;
      const s = await sendWalletTransaction(wallet, connection, tx, signers);
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
export function FundTreasury({ agent, onDone, compact, spec }: { agent: AgentRef; onDone?: () => void; compact?: boolean; spec?: TreasurySpec }) {
  const { run, busy, error, sig, wallet, connection } = useTx(agent.network);
  const t = resolveSpec(agent, spec);
  const isToken = t?.asset === "token";
  const isSol = t?.asset === "sol";
  const [deposit, setDeposit] = useState(isToken ? "10000" : isSol ? "0.1" : "100");
  const [allowance, setAllowance] = useState(isToken ? "10000" : isSol ? "0.1" : "100");
  const [exists, setExists] = useState<boolean | null>(null);
  const [usdcBal, setUsdcBal] = useState<string | null>(null);
  const isOwner = wallet.publicKey?.toBase58() === agent.creatorWallet;

  const tAddress = t?.address;
  const tMint = t?.mint;
  useEffect(() => {
    if (!tAddress || !tMint) return;
    connection.getAccountInfo(new PublicKey(tAddress)).then((a) => setExists(!!a)).catch(() => setExists(null));
    if (wallet.publicKey && t?.asset === "sol") {
      connection.getBalance(wallet.publicKey).then((l) => setUsdcBal((l / 1e9).toString())).catch(() => setUsdcBal(null));
    } else if (wallet.publicKey) {
      connection
        .getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(tMint) })
        .then((r) => {
          // Exclude the treasury itself (the creator owns it too).
          const accs = r.value.filter((a) => a.pubkey.toBase58() !== tAddress);
          setUsdcBal(accs.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmountString), 0).toString());
        })
        .catch(() => setUsdcBal(null));
    }
  }, [tAddress, tMint, connection, wallet.publicKey, sig, t?.asset]);

  if (!t) return <Alert tone="danger">This agent has no treasury record.</Alert>;
  if (!isOwner) return <Alert tone="warn">Connect the creator wallet to fund this treasury.</Alert>;

  const submit = () =>
    run(agent.id, async () => {
      const owner = wallet.publicKey!;
      if (t.asset === "sol") {
        const ixs = buildFundSolTreasuryInstructions({
          owner,
          agentId: agent.id,
          agentSigner: new PublicKey(agent.signerPubkey),
          createAccount: exists === false,
          rentLamports: await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
          depositLamports: deposit ? toBaseUnits(deposit, 9) : 0n,
          allowance: allowance !== "" ? toBaseUnits(allowance, 9) : null,
        });
        if (!ixs.length) throw new Error("Nothing to do");
        return new Transaction().add(...ixs);
      }
      const programId = new PublicKey(t.tokenProgram);
      const mint = new PublicKey(t.mint);
      // Token-2022 accounts may need extra space for the mint's account extensions.
      const size = programId.equals(TOKEN_PROGRAM_ID) ? ACCOUNT_SIZE : getAccountLenForMint(await getMint(connection, mint, "confirmed", programId));
      const rent = await connection.getMinimumBalanceForRentExemption(size);
      const ixs = buildFundTreasuryInstructions({
        owner,
        agentId: agent.id,
        agentSigner: new PublicKey(agent.signerPubkey),
        mint,
        createAccount: exists === false,
        rentLamports: rent,
        depositAmount: deposit ? toBaseUnits(deposit, t.decimals) : 0n,
        allowance: allowance !== "" ? toBaseUnits(allowance, t.decimals) : null,
        asset: t.asset,
        programId,
        decimals: t.decimals,
        accountSize: size,
      });
      if (!ixs.length) throw new Error("Nothing to do");
      return new Transaction().add(...ixs);
    }).then((s) => s && onDone?.());

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="rounded-xl border border-line bg-panel-2 p-4 text-[13px] leading-relaxed text-muted">
          Your wallet signs one transaction that {exists === false ? "creates a treasury account you own, " : ""}deposits {t.unit} into it and
          sets the agent&apos;s <span className="text-text">on-chain allowance</span>. The agent can never spend more than the allowance, and you can
          revoke it or withdraw at any time.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Deposit (${t.unit})`} hint={usdcBal !== null ? `wallet: ${usdcBal}` : undefined}>
          <Input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Agent spending allowance" hint="total, on-chain">
          <Input inputMode="decimal" value={allowance} onChange={(e) => setAllowance(e.target.value)} placeholder="leave empty to keep" />
        </Field>
      </div>
      {usdcBal === "0" && isToken && <Alert tone="warn" title={`You have no ${t.unit} in this wallet`}>Connect the wallet that holds the token supply.</Alert>}
      {(agent.network ?? APP_NETWORK) === "mainnet" && !compact && (
        <Alert tone="warn" title="Real money">
          This treasury holds real {t.unit}. Only delegate what you&apos;re comfortable letting the agent spend.
        </Alert>
      )}
      {usdcBal === "0" && !isToken && !isSol && (
        <Alert tone="warn" title={`You have no ${t.unit} in this wallet`}>
          {(agent.network ?? APP_NETWORK) === "mainnet" ? (
            <>Buy or swap for USDC (e.g. in Phantom&apos;s swap or on jup.ag) and send it to this wallet.</>
          ) : publicConfig.usdcMint === CIRCLE_DEVNET_USDC ? (
            <>
              Get test USDC from{" "}
              <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                faucet.circle.com
              </a>
              .
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
          <TxLink signature={sig} label="View on Explorer" network={agent.network} />
        </Alert>
      )}
    </div>
  );
}

/** Creator-only advanced actions: revoke (on-chain kill switch) and withdraw. */
export function TreasuryOwnerActions({ agent, balance, onDone, spec }: { agent: AgentRef; balance: string; onDone?: () => void; spec?: TreasurySpec }) {
  const { run, busy, error, sig, wallet, connection } = useTx(agent.network);
  const [amount, setAmount] = useState("");
  const t = resolveSpec(agent, spec);
  if (wallet.publicKey?.toBase58() !== agent.creatorWallet || !t) return null;
  const programId = new PublicKey(t.tokenProgram);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input inputMode="decimal" placeholder={`Withdraw amount (max ${balance})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button
          variant="secondary"
          loading={busy}
          onClick={() =>
            run(agent.id, async () => {
              if (t.asset === "sol") {
                const temp = Keypair.generate();
                const rent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
                return {
                  tx: new Transaction().add(...buildWithdrawSolInstructions(wallet.publicKey!, agent.id, toBaseUnits(amount || balance, 9), temp.publicKey, rent)),
                  signers: [temp],
                };
              }
              return new Transaction().add(
                ...buildWithdrawInstructions(wallet.publicKey!, agent.id, new PublicKey(t.mint), toBaseUnits(amount || balance, t.decimals), t.asset, programId, t.decimals),
              );
            }).then((s) => s && onDone?.())
          }
        >
          <ArrowUpFromLine className="size-4" /> Withdraw
        </Button>
      </div>
      <Button
        variant="danger"
        className="w-full"
        loading={busy}
        onClick={() => run(agent.id, async () => new Transaction().add(...buildRevokeInstructions(wallet.publicKey!, agent.id, t.asset, programId))).then((s) => s && onDone?.())}
      >
        <Ban className="size-4" /> Revoke agent allowance on-chain
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      {sig && (
        <Alert tone="accent" title="Confirmed">
          <TxLink signature={sig} network={agent.network} />
        </Alert>
      )}
    </div>
  );
}

/** Anyone can deposit into an agent treasury (sponsors, community). */
export function DepositToTreasury({ agent, onDone }: { agent: AgentRef; onDone?: () => void }) {
  const { run, busy, error, sig, wallet } = useTx(agent.network);
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
          <TxLink signature={sig} network={agent.network} />
        </Alert>
      )}
    </div>
  );
}
