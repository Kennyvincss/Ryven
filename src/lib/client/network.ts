"use client";
import { useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { publicConfig, type Network } from "../shared/config";

let mainnet: Connection | null = null;

/**
 * The app's default connection is devnet. Mainnet agents (pump.fun coins) use a mainnet
 * connection; passing it to wallet.sendTransaction makes the wallet send on mainnet.
 */
export function useNetworkConnection(network: Network = "devnet"): Connection {
  const { connection } = useConnection();
  return useMemo(() => {
    if (network !== "mainnet") return connection;
    return (mainnet ??= new Connection(publicConfig.mainnetRpcUrl, { commitment: "confirmed" }));
  }, [network, connection]);
}
