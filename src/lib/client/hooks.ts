"use client";
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { api } from "./api";
import { publicConfig } from "../shared/config";

export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>({ path: null, data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<T>(path)
      .then((d) => !cancelled && setState({ path, data: d, error: null }))
      .catch((e: Error) => !cancelled && setState((s) => ({ path, data: s.path === path ? s.data : null, error: e.message })));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  useEffect(() => {
    if (!path || !opts.refreshMs) return;
    const t = setInterval(() => setTick((n) => n + 1), opts.refreshMs);
    return () => clearInterval(t);
  }, [path, opts.refreshMs]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const current = state.path === path;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !!path && !current,
    reload,
  };
}

export type OwnedToken = { mint: string; amount: string; decimals: number; program: "spl" | "token-2022" };

/** Reads wallet balances straight from Solana RPC (no backend involved). */
export function useWalletBalances(owner: PublicKey | null) {
  const { connection } = useConnection();
  const [state, setState] = useState<{
    sol: number | null;
    usdc: string | null;
    tokens: OwnedToken[];
    history: ConfirmedSignatureInfo[];
    loading: boolean;
  }>({ sol: null, usdc: null, tokens: [], history: [], loading: false });

  const load = useCallback(async () => {
    if (!owner) return;
    setState((s) => ({ ...s, loading: true }));
    const usdcMint = new PublicKey(publicConfig.usdcMint);
    const [sol, usdc, spl, t22, history] = await Promise.all([
      connection.getBalance(owner).catch(() => null),
      connection
        .getTokenAccountBalance(getAssociatedTokenAddressSync(usdcMint, owner, false, TOKEN_PROGRAM_ID))
        .then((r) => r.value.uiAmountString ?? "0")
        .catch(() => "0"),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }).catch(() => null),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }).catch(() => null),
      connection.getSignaturesForAddress(owner, { limit: 15 }).catch(() => []),
    ]);
    const toList = (r: typeof spl, program: OwnedToken["program"]) =>
      (r?.value ?? [])
        .map((a) => {
          const info = a.account.data.parsed.info;
          return { mint: info.mint as string, amount: info.tokenAmount.uiAmountString as string, decimals: info.tokenAmount.decimals as number, program };
        })
        .filter((t) => Number(t.amount) > 0);
    setState({
      sol: sol === null ? null : sol / 1e9,
      usdc,
      tokens: [...toList(spl, "spl"), ...toList(t22, "token-2022")],
      history,
      loading: false,
    });
  }, [owner, connection]);

  useEffect(() => {
    const t = setTimeout(load, 0); // defer so the effect itself doesn't set state synchronously
    return () => clearTimeout(t);
  }, [load]);
  return { ...state, reload: load };
}

export type PublicAppConfig = {
  aiEnabled: boolean;
  aiModel: string | null;
  ipfsEnabled: boolean;
  feePayer: string | null;
  testUsdcFaucet: boolean;
  curveProgramId: string | null;
  pumpfunEnabled: boolean;
  pumpfunReady: boolean;
  usdcMint: string;
  cluster: string;
};
export function useAppConfig() {
  return useApi<PublicAppConfig>("/api/config").data;
}
