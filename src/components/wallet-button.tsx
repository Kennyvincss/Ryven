"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ChevronDown, LayoutDashboard, LogOut, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInPanel } from "./sign-in-panel";
import { useSession } from "@/lib/client/session";
import { shortAddress } from "@/lib/shared/amounts";
import { Button, CopyButton, cn } from "./ui";

export function WalletButton({ className }: { className?: string }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const path = usePathname();
  const { authed, signIn, signingIn, signOut, session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (!connected || !publicKey) {
    // Not connected: the sign-in screen (connect + sign in one place), then back here.
    return (
      <Button size="md" className={className} href={`/signin?next=${encodeURIComponent(!path || path === "/signin" ? "/dashboard" : path)}`} loading={connecting}>
        <Wallet className="size-4" /> Connect wallet
      </Button>
    );
  }
  const addr = publicKey.toBase58();
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-xl border border-line-2 bg-panel-2 pl-2 pr-3 text-sm hover:bg-panel-3"
      >
        {wallet?.adapter.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.adapter.icon} alt="" className="size-6 rounded-md" />
        )}
        <span className="font-mono text-[13px]">{shortAddress(addr)}</span>
        <span className={cn("size-1.5 rounded-full", authed ? "bg-accent" : "bg-warn")} title={authed ? "Signed in" : "Not signed in"} />
        <ChevronDown className="size-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-line bg-panel-2 p-2 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between rounded-xl bg-panel px-3 py-2.5">
            <span className="font-mono text-xs text-muted">{shortAddress(addr, 6)}</span>
            <CopyButton value={addr} />
          </div>
          {!authed ? (
            <button
              onClick={async () => {
                await signIn();
                setOpen(false);
              }}
              disabled={signingIn}
              className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-accent hover:bg-panel-3"
            >
              <ShieldCheck className="size-4" /> {signingIn ? "Check your wallet…" : "Sign in (free, no transaction)"}
            </button>
          ) : (
            <div className="mt-1 flex items-center gap-2 px-3 py-2 text-xs text-muted">
              <ShieldCheck className="size-3.5 text-accent" /> Signed in{session?.isAdmin ? " · admin" : ""}
            </div>
          )}
          <Link href="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-panel-3">
            <LayoutDashboard className="size-4 text-muted" /> Dashboard
          </Link>
          {session?.isAdmin && authed && (
            <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-panel-3">
              <ShieldCheck className="size-4 text-muted" /> Admin
            </Link>
          )}
          <button
            onClick={async () => {
              if (authed) await signOut();
              await disconnect();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-danger hover:bg-panel-3"
          >
            <LogOut className="size-4" /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Inline gate: renders children only when the wallet is connected and signed in; otherwise the sign-in screen. */
export function AuthGate({ children, title, reason }: { children: React.ReactNode; title?: string; reason?: string }) {
  const { authed, loading } = useSession();
  if (loading) return null;
  if (authed) return <>{children}</>;
  return <SignInPanel title={title} subtitle={reason} />;
}
