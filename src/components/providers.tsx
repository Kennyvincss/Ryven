"use client";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { SessionProvider } from "@/lib/client/session";
import { publicConfig } from "@/lib/shared/config";

/**
 * Wallets: Phantom, Solflare, Backpack and every other Wallet-Standard wallet are
 * detected automatically, so no per-wallet adapters are needed.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={publicConfig.rpcUrl} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SessionProvider>{children}</SessionProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
