"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { WalletButton } from "./wallet-button";
import { cn } from "./ui";
import { RyvenLogo } from "./brand";
import { APP_NETWORK, networkLabel } from "@/lib/shared/config";

const NAV = [
  { href: "/live", label: "Live" },
  { href: "/tokens", label: "Tokens" },
  { href: "/agents", label: "Agents" },
  { href: "/launch", label: "Launch" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center" aria-label="Ryven home">
      <RyvenLogo size={30} />
    </Link>
  );
}

export function Navbar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  path.startsWith(n.href) ? "bg-accent/10 text-accent" : "text-muted hover:text-text",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {APP_NETWORK !== "mainnet" && (
            <span className="hidden rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-warn sm:inline">
              {networkLabel}
            </span>
          )}
          <WalletButton />
          <button className="grid size-10 place-items-center rounded-xl border border-line-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-3 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-panel-2 hover:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  const cols = [
    { title: "Product", links: [["Explore Tokens", "/tokens"], ["Explore Agents", "/agents"], ["Launch a Token", "/launch"]] },
    { title: "Resources", links: [["About", "/about"], ["Documentation", "/docs"], ["GitHub", "https://github.com/kennyvincss/Ryven"]] },
    { title: "Legal", links: [["Terms", "/terms"], ["Privacy", "/privacy"], ["X / Twitter", "https://x.com"]] },
  ];
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" aria-label="Ryven home">
            <RyvenLogo size={30} tagline />
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted">The memecoin terminal with an AI agent. Trade live, launch coins, let your agent run the rest. Built on Solana.</p>
          <p className="mt-4 text-xs text-faint">
            Running on Solana{APP_NETWORK === "mainnet" ? ": transactions use real SOL and USDC." : " (test mode, test funds)."} Agent
            payments use Solana&apos;s standard token program.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="text-xs font-semibold uppercase tracking-wider text-faint">{c.title}</div>
            <ul className="mt-3 space-y-2">
              {c.links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="text-sm text-muted hover:text-text" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line py-5 text-center text-xs text-faint">© 2026 Ryven · UBC 2026 Hackathon · Agentic Payments &amp; AI</div>
    </footer>
  );
}
