"use client";
/**
 * Sign-in screen: wallet-based (Sign-In With Solana), no email or password. Left: brand card
 * with the three steps, which tick off live. Right: pick a wallet, then sign a free message.
 */
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Check, ExternalLink, Rocket, ShieldCheck, Wallet } from "lucide-react";
import { useSession } from "@/lib/client/session";
import { shortAddress } from "@/lib/shared/amounts";
import { RyvenLogo } from "./brand";
import { cn } from "./ui";

const SUGGESTED = [
  { name: "Phantom", url: "https://phantom.app/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
];

type StepState = "done" | "current" | "todo";

function Step({ state, icon, title, text, offset }: { state: StepState; icon: React.ReactNode; title: string; text: string; offset?: boolean }) {
  return (
    <li className={cn("relative pl-10", offset && "sm:pr-6")}>
      <span
        className={cn(
          "absolute left-0 top-1/2 grid size-[18px] -translate-y-1/2 place-items-center rounded-full border",
          state === "done" && "border-accent bg-accent text-black",
          state === "current" && "border-accent bg-bg shadow-[0_0_0_4px_rgba(198,255,61,0.15)]",
          state === "todo" && "border-white/25 bg-bg",
        )}
      >
        {state === "done" && <Check className="size-3" strokeWidth={3} />}
      </span>
      <div className={cn("rounded-2xl border bg-white/[0.04] px-4 py-3 backdrop-blur-md", state === "current" ? "border-accent/40" : "border-white/10")}>
        <div className="flex items-center gap-2 text-[15px] font-semibold text-text">
          {icon}
          {title}
        </div>
        <div className="mt-1 text-xs text-muted">{text}</div>
      </div>
    </li>
  );
}

export function SignInPanel({ title = "Sign in to Ryven", subtitle }: { title?: string; subtitle?: string }) {
  const { wallets, select, wallet, publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { authed, signIn, signingIn, error } = useSession();
  const [picking, setPicking] = useState<string | null>(null);

  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  // Two big buttons: installed wallets first, then install links for Phantom / Solflare.
  const featured: { name: string; icon?: string; installed: boolean; url?: string }[] = installed.slice(0, 2).map((w) => ({ name: w.adapter.name, icon: w.adapter.icon, installed: true }));
  for (const s of SUGGESTED) if (featured.length < 2 && !featured.some((f) => f.name === s.name)) featured.push({ name: s.name, installed: false, url: s.url });

  const step1: StepState = connected ? "done" : "current";
  const step2: StepState = authed ? "done" : connected ? "current" : "todo";
  const step3: StepState = authed ? "current" : "todo";

  function pick(f: (typeof featured)[number]) {
    if (!f.installed) {
      window.open(f.url, "_blank", "noopener,noreferrer");
      return;
    }
    setPicking(f.name);
    select(f.name as WalletName); // the provider auto-connects the selected wallet
    setTimeout(() => setPicking(null), 4000);
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 rounded-[28px] border border-line bg-[#050608] p-3 lg:grid-cols-2 lg:gap-0">
      {/* left: brand + steps */}
      <section
        className="relative overflow-hidden rounded-[22px] px-6 pb-8 pt-10 sm:px-10 lg:min-h-[600px] lg:pt-16"
        style={{
          background:
            "radial-gradient(130% 50% at 50% -8%, rgba(232,255,170,0.95) 0%, rgba(198,255,61,0.75) 22%, rgba(198,255,61,0.30) 45%, rgba(198,255,61,0.06) 66%, transparent 80%), linear-gradient(180deg, #121a08 0%, #07090b 72%)",
        }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="rounded-2xl bg-bg/70 px-4 py-3 backdrop-blur-sm">
            <RyvenLogo size={34} tagline />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-text">Get started with Ryven</h2>
          <p className="mt-2 max-w-xs text-sm text-text/75">Three quick steps. No email, no password: your wallet is your account.</p>
        </div>
        <ol className="relative mx-auto mt-10 max-w-sm space-y-5">
          <span className="absolute bottom-6 left-[8.5px] top-6 w-px bg-white/15" aria-hidden />
          <Step state={step1} icon={<Wallet className="size-4 text-accent" />} title="Connect your wallet" text="Phantom, Solflare or any Solana wallet." />
          <Step state={step2} icon={<ShieldCheck className="size-4 text-accent" />} title="Sign in, free" text="Sign a message to prove it's you. No transaction, no fees." offset />
          <Step state={step3} icon={<Rocket className="size-4 text-accent" />} title="Start trading with Ryven" text="Trade live coins, launch your own and deploy your AI agent." />
        </ol>
      </section>

      {/* right: sign in */}
      <section className="flex flex-col justify-center px-4 pb-8 pt-4 sm:px-12 lg:py-10">
        <div className="text-center">
          <h2 className="text-3xl font-bold">{title}</h2>
          <p className="mt-2 text-sm text-muted">{subtitle ?? "Use your Solana wallet to continue."}</p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3">
          {featured.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => pick(f)}
              disabled={connecting || picking === f.name}
              className={cn(
                "flex h-12 items-center justify-center gap-2 rounded-xl border border-line-2 bg-panel text-sm hover:border-accent/40 hover:bg-panel-2 disabled:opacity-60",
                wallet?.adapter.name === f.name && connected && "border-accent/50",
              )}
            >
              {f.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.icon} alt="" className="size-5 rounded" />
              ) : (
                <Wallet className="size-4 text-muted" />
              )}
              {f.installed ? (picking === f.name || (connecting && wallet?.adapter.name === f.name) ? "Connecting…" : f.name) : `Get ${f.name}`}
              {!f.installed && <ExternalLink className="size-3 text-faint" />}
            </button>
          ))}
        </div>

        <div className="my-6 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-line" /> Or <span className="h-px flex-1 bg-line" />
        </div>

        <button type="button" onClick={() => setVisible(true)} className="h-11 rounded-xl border border-line-2 bg-panel text-sm text-muted hover:text-text">
          Choose another wallet
        </button>

        <label className="mt-6 block text-sm font-medium">Wallet</label>
        <div className="mt-2 flex h-12 items-center justify-between rounded-xl border border-line bg-panel px-4">
          {connected && publicKey ? (
            <>
              <span className="flex items-center gap-2 font-mono text-sm">
                <span className="size-2 rounded-full bg-accent" /> {shortAddress(publicKey.toBase58(), 6)}
              </span>
              <button type="button" onClick={() => disconnect()} className="text-xs text-muted hover:text-text">
                Change
              </button>
            </>
          ) : (
            <span className="text-sm text-faint">{connecting ? "Connecting…" : "No wallet connected"}</span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="grid size-4 place-items-center rounded-full bg-accent text-black">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            Free: no transaction
          </span>
          <span>We never ask for your seed phrase</span>
        </div>

        <button
          type="button"
          disabled={signingIn || connecting || authed}
          onClick={() => (connected ? signIn() : setVisible(true))}
          className="mt-6 h-12 rounded-xl bg-gradient-to-b from-[#d4ff6b] to-accent text-sm font-semibold text-black shadow-[0_8px_30px_-8px_rgba(198,255,61,0.6)] hover:brightness-105 disabled:opacity-60"
        >
          {authed ? "Signed in" : signingIn ? "Check your wallet…" : connected ? "Sign in" : "Connect wallet"}
        </button>
        {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}

        <p className="mt-6 text-center text-xs text-muted">
          New to Solana?{" "}
          <a href="https://phantom.app/download" target="_blank" rel="noreferrer" className="font-medium text-text hover:underline">
            Get a wallet
          </a>
        </p>
      </section>
    </div>
  );
}
