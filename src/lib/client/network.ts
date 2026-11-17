"use client";
import { useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { APP_NETWORK, publicConfig, type Network } from "../shared/config";

let mainnet: Connection | null = null;

/**
 * Returns a connection for the given network. Passing a mainnet connection to
 * wallet.sendTransaction makes the wallet send on mainnet.
 */
export function useNetworkConnection(network: Network = APP_NETWORK): Connection {
  const { connection } = useConnection();
  return useMemo(() => {
    // The app-wide provider already points at the app network.
    if (network === APP_NETWORK || network !== "mainnet") return connection;
    return (mainnet ??= new Connection(publicConfig.mainnetRpcUrl, { commitment: "confirmed" }));
  }, [network, connection]);
}
