/**
 * Public (browser-safe) configuration. Everything here comes from NEXT_PUBLIC_* env
 * vars and must never contain secrets.
 */
export const CIRCLE_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** Circle's official USDC on Solana mainnet. */
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const publicConfig = {
  cluster: (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta" | "testnet",
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT ?? CIRCLE_DEVNET_USDC,
  curveProgramId: process.env.NEXT_PUBLIC_CURVE_PROGRAM_ID || null,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  /** Browser RPC for mainnet (pump.fun coins and their agents). */
  mainnetRpcUrl: process.env.NEXT_PUBLIC_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com",
};

/** USDC mint used by agent treasuries on each network. */
export const usdcMintFor = (network: "devnet" | "mainnet") => (network === "mainnet" ? MAINNET_USDC : publicConfig.usdcMint);
/** Display name for an agent's USDC: real on mainnet, possibly "Test USDC" on devnet. */
export const usdcLabelFor = (network: "devnet" | "mainnet") => (network === "mainnet" ? "USDC" : usdcLabel);

export const USDC_DECIMALS = 6;
export const LAUNCH_TOKEN_DECIMALS = 6;

/** True when the configured payment mint is Circle's official devnet USDC. */
export const isCircleUsdc = publicConfig.usdcMint === CIRCLE_DEVNET_USDC;
export const usdcLabel = isCircleUsdc ? "USDC" : "Test USDC";

export type Network = "devnet" | "mainnet";
const clusterQuery = (network?: Network) =>
  network === "mainnet" || (!network && publicConfig.cluster === "mainnet-beta") ? "" : `?cluster=${network ?? publicConfig.cluster}`;
export function explorerTx(signature: string, network?: Network) {
  return `https://explorer.solana.com/tx/${signature}${clusterQuery(network)}`;
}
export function explorerAddress(address: string, network?: Network) {
  return `https://explorer.solana.com/address/${address}${clusterQuery(network)}`;
}

/** pump.fun bonding-curve program (mainnet). */
export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const pumpFunCoinUrl = (mint: string) => `https://pump.fun/coin/${mint}`;

export const PAYMENT_CATEGORIES = [
  { id: "community_rewards", label: "Community rewards" },
  { id: "content_bounty", label: "Content bounties" },
  { id: "design", label: "Design work" },
  { id: "development", label: "Development" },
  { id: "marketing", label: "Marketing" },
  { id: "operations", label: "Operations" },
] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number]["id"];
export const PAYMENT_CATEGORY_IDS = PAYMENT_CATEGORIES.map((c) => c.id) as [PaymentCategory, ...PaymentCategory[]];
