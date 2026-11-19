"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { Bot, Check, ExternalLink, ImagePlus, Rocket, TriangleAlert, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { sendWalletTransaction } from "@/lib/client/wallet-tx";
import { useAppConfig } from "@/lib/client/hooks";
import { buildLaunchTransaction, TOKEN_LIMITS } from "@/lib/solana/launch";
import { toBaseUnits } from "@/lib/shared/amounts";
import { APP_NETWORK, LAUNCH_TOKEN_DECIMALS, explorerTx } from "@/lib/shared/config";
import { AuthGate } from "@/components/wallet-button";
import { DEFAULT_POLICY, PolicyForm, policyPayload, type PolicyState } from "@/components/agent-policy-form";
import { FundTreasury } from "@/components/treasury-actions";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Spinner, Textarea, TokenImage, TxLink, cn } from "@/components/ui";

type Token = { mint: string; name: string; symbol: string; imageUri: string | null; launchSignature: string; network?: "devnet" | "mainnet"; launchMode?: string };
type Agent = { id: string; name: string; signerPubkey: string; creatorWallet: string; network?: "devnet" | "mainnet"; treasury: { address: string; mint: string } | null };

function Steps({ step }: { step: number }) {
  const items = [
    { icon: Rocket, label: "Launch token" },
    { icon: Bot, label: "Deploy agent" },
    { icon: Wallet, label: "Fund treasury" },
  ];
  return (
    <div className="mb-8 grid grid-cols-3 gap-2">
      {items.map(({ icon: Icon, label }, i) => (
        <div
          key={label}
          className={cn(
            "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-xs font-medium sm:text-sm",
            i < step ? "border-accent/30 bg-accent/5 text-accent" : i === step ? "border-line-2 bg-panel-2 text-text" : "border-line text-faint",
          )}
        >
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px]", i < step ? "bg-accent text-black" : "bg-panel-3")}>
            {i < step ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
          </span>
          <span className="truncate">{label}</span>
        </div>
      ))}
    </div>
  );
}

function readFileAsDataUrl(f: File) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

function TokenStep({ onLaunched }: { onLaunched: (t: Token) => void }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const config = useAppConfig();
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", supply: "1000000000" });
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"ryven" | "pumpfun">("ryven");
  const [devBuy, setDevBuy] = useState("0");
  const [ack, setAck] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  /** pump.fun on Solana MAINNET via PumpPortal: real SOL. */
  async function launchPumpFun() {
    setError(null);
    if (!f.name.trim() || !f.symbol.trim()) return setError("Name and symbol are required.");
    if (!image) return setError("Add a coin image.");
    if (!/^\d+(\.\d{1,9})?$/.test(devBuy) || Number(devBuy) > 10) return setError("Dev buy must be a SOL amount between 0 and 10.");
    if (!ack) return setError("Please confirm you understand this uses real SOL.");
    if (!wallet.signTransaction) return setError("This wallet can't sign transactions for this flow. Try Phantom or Solflare.");
    setBusy(true);
    try {
      const name = f.name.trim();
      const symbol = f.symbol.trim().toUpperCase();
      setStatus("Uploading image & metadata to IPFS…");
      const meta = await api<{ metadataUri: string; imageUri: string }>("/api/pumpfun/metadata", {
        json: { name, symbol, description: f.description, image, website: f.website, twitter: f.twitter, telegram: f.telegram },
      });
      setStatus("Building and checking the launch transaction (simulated on Solana first)…");
      const mint = Keypair.generate();
      const { transaction } = await api<{ transaction: string }>("/api/pumpfun/create-tx", {
        json: { mint: mint.publicKey.toBase58(), name, symbol, uri: meta.metadataUri, devBuySol: Number(devBuy) },
      });
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0)));
      tx.sign([mint]);
      setStatus("Approve the launch in your wallet…");
      const signed = await wallet.signTransaction(tx);
      setStatus("Sending to Solana and waiting for confirmation…");
      const signedB64 = btoa(String.fromCharCode(...signed.serialize()));
      const r = await api<{ token: Token; signature: string }>("/api/pumpfun/submit", {
        json: {
          signedTransaction: signedB64,
          mint: mint.publicKey.toBase58(),
          name,
          symbol,
          description: f.description,
          metadataUri: meta.metadataUri,
          imageUri: meta.imageUri,
          website: f.website,
          twitter: f.twitter,
          telegram: f.telegram,
        },
      });
      onLaunched(r.token);
    } catch (e) {
      const msg = (e as Error).message;
      setError(/User rejected|rejected the request/i.test(msg) ? "You rejected the transaction in your wallet. Nothing was spent." : msg);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    if (mode === "pumpfun") return launchPumpFun();
    setError(null);
    if (!f.name.trim() || !f.symbol.trim()) return setError("Name and symbol are required.");
    if (!image) return setError("Add a token image.");
    if (!/^\d+$/.test(f.supply) || BigInt(f.supply) <= 0n || BigInt(f.supply) > 1_000_000_000_000n) return setError("Supply must be a whole number up to 1 trillion.");
    setBusy(true);
    try {
      setStatus("Uploading metadata…");
      const meta = await api<{ metadataUri: string; imageUri: string }>("/api/metadata", {
        json: { name: f.name.trim(), symbol: f.symbol.trim().toUpperCase(), description: f.description, image, website: f.website, twitter: f.twitter, telegram: f.telegram },
      });
      setStatus("Approve the launch transaction in your wallet…");
      const { tx, mint } = await buildLaunchTransaction({
        connection,
        creator: wallet.publicKey!,
        name: f.name.trim(),
        symbol: f.symbol.trim().toUpperCase(),
        uri: meta.metadataUri,
        supply: toBaseUnits(f.supply, LAUNCH_TOKEN_DECIMALS),
      });
      const signature = await sendWalletTransaction(wallet, connection, tx, [mint]);
      setStatus("Confirmed on Solana. Verifying on-chain…");
      const r = await api<{ token: Token }>("/api/tokens", {
        json: { mint: mint.publicKey.toBase58(), signature, metadataUri: meta.metadataUri, imageUri: meta.imageUri, description: f.description, website: f.website, twitter: f.twitter, telegram: f.telegram },
      });
      onLaunched(r.token);
    } catch (e) {
      setError((e as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Token details" subtitle="Created as a Solana Token-2022 mint with on-chain metadata." icon={<Rocket className="size-4" />} />
      <div className="grid gap-6 p-5 md:grid-cols-[180px_1fr]">
        <label className="group flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line-2 bg-panel-2 text-center hover:border-accent/50">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="size-full object-cover" />
          ) : (
            <>
              <ImagePlus className="size-6 text-muted" />
              <span className="mt-2 text-xs text-muted">Upload image</span>
              <span className="text-[10px] text-faint">PNG/JPG/GIF/WebP · ≤512KB</span>
            </>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 512 * 1024) return setError("Image must be 512 KB or smaller.");
              setImage(await readFileAsDataUrl(file));
            }}
          />
        </label>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="Token name" hint={`${f.name.length}/${TOKEN_LIMITS.name}`}>
              <Input value={f.name} onChange={set("name")} maxLength={TOKEN_LIMITS.name} placeholder="Doge Two" />
            </Field>
            <Field label="Symbol" hint={`${f.symbol.length}/${TOKEN_LIMITS.symbol}`}>
              <Input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9$]/g, "") })} maxLength={TOKEN_LIMITS.symbol} placeholder="DOGE2" />
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={f.description} onChange={set("description")} maxLength={1000} placeholder="What is this token about?" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Website">
              <Input value={f.website} onChange={set("website")} placeholder="https://" />
            </Field>
            <Field label="X / Twitter">
              <Input value={f.twitter} onChange={set("twitter")} placeholder="https://x.com/…" />
            </Field>
            <Field label="Telegram">
              <Input value={f.telegram} onChange={set("telegram")} placeholder="https://t.me/…" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Launch on">
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setMode("ryven")}
                  className={cn("rounded-xl border px-3 py-2.5 text-left text-sm", mode === "ryven" ? "border-accent/50 bg-accent/5" : "border-line hover:bg-panel-2")}
                >
                  <div className="font-medium">Ryven · fixed supply</div>
                  <div className="text-xs text-muted">Full supply minted to you, mint authority revoked forever. Supports AI agents.</div>
                </button>
                {config?.pumpfunEnabled ? (
                  <button
                    type="button"
                    disabled={!config.pumpfunReady}
                    onClick={() => setMode("pumpfun")}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left text-sm disabled:opacity-50",
                      mode === "pumpfun" ? "border-warn/60 bg-warn/5" : "border-line hover:bg-panel-2",
                    )}
                  >
                    <div className="font-medium">Bonding-curve launch (real SOL)</div>
                    <div className="text-xs text-muted">
                      {config.pumpfunReady ? "Tradable right away on a bonding curve. Agents not supported yet." : "Bonding-curve launches are temporarily unavailable."}
                    </div>
                  </button>
                ) : (
                  <div className="rounded-xl border border-line px-3 py-2.5 text-sm opacity-60">
                    <div className="font-medium">Bonding curve</div>
                    <div className="text-xs text-muted">
                      {config?.curveProgramId ? "Program configured; curve launch UI not enabled in this build." : "Requires deploying the ryven_curve program (see docs). Not live on this deployment."}
                    </div>
                  </div>
                )}
              </div>
            </Field>
            {mode === "ryven" ? (
              <Field label="Total supply" hint={`${LAUNCH_TOKEN_DECIMALS} decimals`}>
                <Input inputMode="numeric" value={f.supply} onChange={set("supply")} />
              </Field>
            ) : (
              <Field label="Dev buy (optional)" hint="SOL you buy at launch">
                <Input inputMode="decimal" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} />
                <p className="mt-1.5 text-[11px] text-faint">Supply is 1B with a standard bonding curve. A 0.5% fee applies to the dev buy.</p>
              </Field>
            )}
          </div>
          {mode === "pumpfun" && (
            <div className="space-y-3 rounded-xl border border-warn/40 bg-warn/[0.06] p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-warn">
                <TriangleAlert className="size-4" /> This launch uses real SOL
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-text/80">
                <li>Make sure your wallet isn&apos;t in test mode (Phantom: Settings → Developer Settings → Testnet Mode off).</li>
                <li>Costs roughly 0.02–0.03 SOL in fees and rent, plus your dev buy. It can&apos;t be undone.</li>
                <li>The coin is created through a third-party launch service. Ryven checks the transaction before you sign it.</li>
              </ul>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                I understand this spends real SOL and creates a public coin.
              </label>
            </div>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {status && !error && <Alert tone="info">{status}</Alert>}
          <Button onClick={launch} loading={busy} size="lg" className="w-full" variant={mode === "pumpfun" ? "secondary" : "primary"}>
            <Rocket className="size-4" /> {mode === "pumpfun" ? "Launch on a bonding curve" : "Launch token"}
          </Button>
          <p className="text-center text-xs text-faint">
            {mode === "pumpfun"
              ? "Your wallet shows the exact transaction before you sign."
              : APP_NETWORK === "mainnet"
                ? "Uses real SOL: roughly 0.005 SOL in rent + fees. Your wallet shows the transaction before signing."
                : "Costs roughly 0.005 test SOL in rent + fees. Your wallet will show the transaction before signing."}
          </p>
        </div>
      </div>
    </Card>
  );
}

function AgentStep({ token, onDeployed }: { token: Token; onDeployed: (a: Agent) => void }) {
  const [p, setP] = useState({
    name: `${token.symbol} Assistant`,
    description: `Autonomous treasury agent for $${token.symbol}.`,
    personality: "Friendly, transparent and precise about money.",
    objectives: "Manage community rewards, monitor contributor activity and distribute approved rewards.",
    instructions: "",
  });
  const [policy, setPolicy] = useState<PolicyState>(DEFAULT_POLICY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const isMainnet = token.network === "mainnet";
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });

  async function deploy() {
    if (isMainnet && !ack) return setError("Please confirm you understand this agent will move real USDC.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ agent: Agent }>("/api/agents", { json: { tokenMint: token.mint, ...p, ...policyPayload(policy), acknowledgeMainnet: isMainnet ? ack : undefined } });
      onDeployed(r.agent);
    } catch (e) {
      const issues = (e as { body?: { issues?: { message: string }[] } }).body?.issues;
      setError(issues?.map((i) => i.message).join("; ") || (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Deploy Your AI Agent" subtitle={`An autonomous agent for $${token.symbol} with its own treasury and spending limits.`} icon={<Bot className="size-4" />} />
      <div className="space-y-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Agent name">
            <Input value={p.name} onChange={set("name")} maxLength={48} />
          </Field>
          <Field label="Description">
            <Input value={p.description} onChange={set("description")} maxLength={500} />
          </Field>
        </div>
        <Field label="Personality">
          <Input value={p.personality} onChange={set("personality")} maxLength={500} />
        </Field>
        <Field label="Objectives">
          <Textarea value={p.objectives} onChange={set("objectives")} maxLength={1000} />
        </Field>
        <Field label="Standing instructions" hint="private, only you and the agent see these">
          <Textarea value={p.instructions} onChange={set("instructions")} maxLength={2000} placeholder="e.g. Prioritise contributors who created content this week." />
        </Field>
        <div className="border-t border-line pt-5">
          <div className="mb-4 text-sm font-semibold">Spending permissions</div>
          <PolicyForm value={policy} onChange={setPolicy} />
        </div>
        <Alert tone="info" title="How the agent's wallet works">
          Ryven generates a dedicated signing key for this agent and stores it encrypted on the server. It holds no funds. In the next step you
          give it a capped on-chain allowance over a treasury you own. The AI model never sees the key.
        </Alert>
        {isMainnet && (
          <div className="space-y-2 rounded-xl border border-warn/40 bg-warn/[0.06] p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-warn">
              <TriangleAlert className="size-4" /> This agent moves real USDC
            </div>
            <p className="text-xs text-text/80">
              Its treasury is a USDC account you own; it can only spend the allowance you give it, within the limits above. Start small. Ryven
              pays the network fees for its payments.
            </p>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" /> I understand this agent moves real
              money.
            </label>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button onClick={deploy} loading={busy} variant="agent" size="lg" className="w-full">
          <Bot className="size-4" /> Deploy agent
        </Button>
      </div>
    </Card>
  );
}

function PumpFunSuccess({ token }: { token: Token }) {
  return (
    <Card className="mb-4 p-6 text-center">
      <TokenImage src={token.imageUri} symbol={token.symbol} size={72} className="mx-auto rounded-2xl" />
      <h2 className="mt-4 text-xl font-semibold">
        {token.name} <span className="font-mono text-muted">${token.symbol}</span> is live
      </h2>
      <p className="mt-1 text-sm text-muted">Created on Solana. It can take a minute to show up everywhere.</p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        <Button href={`/trade/${token.mint}`}>
          Open trading page
        </Button>
        <Button variant="secondary" href={explorerTx(token.launchSignature, "mainnet")}>
          Launch transaction <ExternalLink className="size-3.5" />
        </Button>
        <Button variant="secondary" href={`/tokens/${token.mint}`}>
          Ryven page
        </Button>
      </div>
      <p className="mt-5 text-xs text-faint">Next: deploy an AI agent for this coin below (optional). It pays in real USDC.</p>
    </Card>
  );
}

function LaunchFlow() {
  const sp = useSearchParams();
  const router = useRouter();
  const { publicKey } = useWallet();
  const [token, setToken] = useState<Token | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(!!sp.get("token"));

  // Resume: /launch?token=<mint> continues with agent deployment / funding.
  useEffect(() => {
    const mint = sp.get("token");
    if (!mint) return;
    api<{ token: Token; agent: Agent | null }>(`/api/tokens/${mint}`)
      .then((r) => {
        setToken(r.token);
        if (r.agent) setAgent(r.agent);
      })
      .finally(() => setLoading(false));
  }, [sp]);

  if (loading) return <Spinner />;
  const step = !token ? 0 : !agent ? 1 : 2;
  return (
    <>
      <Steps step={step} />
      {token?.network === "mainnet" && !agent && <PumpFunSuccess token={token} />}
      {token && (
        <Card className="mb-4 flex items-center gap-3 p-4">
          <TokenImage src={token.imageUri} symbol={token.symbol} size={40} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {token.name} <span className="font-mono text-sm text-muted">${token.symbol}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <span className="font-mono">{token.mint.slice(0, 8)}…</span>
              <TxLink signature={token.launchSignature} label="launch tx" network={token.network} />
            </div>
          </div>
          <Button variant="secondary" size="sm" href={`/tokens/${token.mint}`}>
            View
          </Button>
        </Card>
      )}
      {step === 0 && (
        <TokenStep
          onLaunched={(t) => {
            setToken(t);
            router.replace(`/launch?token=${t.mint}`);
          }}
        />
      )}
      {step === 1 && token && (publicKey ? <AgentStep token={token} onDeployed={setAgent} /> : <Spinner />)}
      {step === 2 && agent && (
        <Card>
          <CardHeader title="Fund the treasury" subtitle={`Treasury ${agent.treasury?.address.slice(0, 8)}… is owned by your wallet. ${agent.name} is only a delegate.`} icon={<Wallet className="size-4" />} />
          <div className="p-5">
            <FundTreasury agent={{ ...agent, treasury: agent.treasury ? { address: agent.treasury.address, mint: agent.treasury.mint } : null }} onDone={() => router.push(`/console/${agent.id}?welcome=1`)} />
            <div className="mt-4 text-center">
              <Button variant="ghost" size="sm" href={`/console/${agent.id}`}>
                Skip for now → open agent console
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

export default function LaunchPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Launchpad" title="Launch a token & deploy its agent" subtitle={`Three wallet-approved steps, recorded on Solana.${APP_NETWORK === "mainnet" ? " Real SOL and USDC." : " Test mode."}`} />
      <AuthGate reason="Launching a token and deploying an agent require a signed-in wallet. Signing in is free and sends no transaction.">
        <Suspense fallback={<Spinner />}>
          <LaunchFlow />
        </Suspense>
      </AuthGate>
    </div>
  );
}
