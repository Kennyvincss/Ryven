"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { WalletButton } from "./wallet-button";
import { cn } from "./ui";
import { publicConfig } from "@/lib/shared/config";

const NAV = [
  { href: "/tokens", label: "Tokens" },
  { href: "/agents", label: "Agents" },
  { href: "/launch", label: "Launch" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a6f46a" />
            <stop offset="1" stopColor="#9585ff" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#rg)" />
        <path d="M10 23V9h7.2c3 0 5 1.8 5 4.4 0 2-1.2 3.4-3 4l3.6 5.6h-3.7l-3.2-5.1H13.2V23H10Zm3.2-7.8h3.8c1.3 0 2.1-.7 2.1-1.8s-.8-1.8-2.1-1.8h-3.8v3.6Z" fill="#06070a" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">RYVEN</span>
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
                  path.startsWith(n.href) ? "bg-panel-2 text-text" : "text-muted hover:text-text",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-warn sm:inline">
            {publicConfig.cluster}
          </span>
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
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">Launch Tokens. Deploy Agents. Automate Economies. Built on Solana.</p>
          <p className="mt-4 text-xs text-faint">Running on Solana {publicConfig.cluster}. Test funds only. Custom programs are unaudited.</p>
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
