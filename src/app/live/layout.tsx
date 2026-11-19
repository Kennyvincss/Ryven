import type { Metadata } from "next";

export const metadata: Metadata = { title: "Live", description: "Live Solana memecoins: new pairs, about to graduate and graduated." };

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
