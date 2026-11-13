"use client";
import bs58 from "bs58";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "./api";

type Session = { wallet: string; isAdmin: boolean } | null;
type Ctx = {
  session: Session;
  loading: boolean;
  signingIn: boolean;
  /** True when a wallet is connected AND the server session belongs to it. */
  authed: boolean;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  error: string | null;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, connected } = useWallet();
  const [session, setSession] = useState<Session>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ session: Session }>("/api/auth/me")
      .then((r) => setSession(r.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  // If the user switches wallets, drop the old server session.
  useEffect(() => {
    if (!loading && session && connected && publicKey && publicKey.toBase58() !== session.wallet) {
      api("/api/auth/logout", { method: "POST" }).finally(() => setSession(null));
    }
  }, [publicKey, connected, session, loading]);

  const signIn = useCallback(async () => {
    setError(null);
    if (!publicKey) return false;
    if (!signMessage) {
      setError("This wallet does not support message signing.");
      return false;
    }
    setSigningIn(true);
    try {
      const wallet = publicKey.toBase58();
      const { nonce, message } = await api<{ nonce: string; message: string }>("/api/auth/nonce", { json: { wallet } });
      const sig = await signMessage(new TextEncoder().encode(message));
      const r = await api<{ wallet: string }>("/api/auth/verify", { json: { wallet, nonce, signature: bs58.encode(sig) } });
      const me = await api<{ session: Session }>("/api/auth/me");
      setSession(me.session ?? { wallet: r.wallet, isAdmin: false });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setSession(null);
  }, []);

  const authed = !!session && !!publicKey && session.wallet === publicKey.toBase58();
  return (
    <SessionContext.Provider value={{ session, loading, signingIn, authed, signIn, signOut, error }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
