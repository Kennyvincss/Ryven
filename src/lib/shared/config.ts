/**
 * Public (browser-safe) configuration. Everything here comes from NEXT_PUBLIC_* env
 * vars and must never contain secrets.
 */
export const CIRCLE_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** Circle's official USDC on Solana mainnet. */
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type Network = "devnet" | "mainnet";

/**
 * Ryven runs on Solana MAINNET (real SOL, real USDC). Setting
 * NEXT_PUBLIC_SOLANA_CLUSTER=devnet switches to a free test network; that mode exists only
 * for automated tests (scripts/e2e-devnet.ts).
 */
const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "devnet" : "mainnet-beta") as "devnet" | "mainnet-beta";
export const APP_NETWORK: Network = cluster === "devnet" ? "devnet" : "mainnet";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Browsers never see the real RPC URL (a Helius URL contains its API key): they talk to
 * Solana through Ryven's own /api/rpc relay, which holds the key server-side.
 * Server code uses serverEnv.rpcUrl / serverEnv.mainnetRpcUrl instead.
 */
function relayUrl(network: Network) {
  const origin = typeof window !== "undefined" ? window.location.origin : APP_URL;
  return `${origin}/api/rpc?network=${network}`;
}

export const publicConfig = {
  cluster,
  get rpcUrl() {
    return relayUrl(APP_NETWORK);
  },
  usdcMint: APP_NETWORK === "mainnet" ? MAINNET_USDC : process.env.NEXT_PUBLIC_USDC_MINT || CIRCLE_DEVNET_USDC,
  curveProgramId: process.env.NEXT_PUBLIC_CURVE_PROGRAM_ID || null,
  appUrl: APP_URL,
  /** Browser RPC for mainnet (pump.fun coins, trading, agents), via the relay. */
  get mainnetRpcUrl() {
    return relayUrl("mainnet");
  },
};

/** Shown to users: just "Solana" normally; the hidden test mode is labelled as such. */
export const networkLabel = APP_NETWORK === "mainnet" ? "Solana" : "Devnet (test mode)";

/** USDC mint used by agent treasuries on each network. */
export const usdcMintFor = (network: Network) =>
  network === "mainnet" ? MAINNET_USDC : process.env.NEXT_PUBLIC_DEVNET_USDC_MINT || (APP_NETWORK === "devnet" ? publicConfig.usdcMint : CIRCLE_DEVNET_USDC);
/** Display name for an agent's USDC. */
export const usdcLabelFor = (network: Network) => (network === "mainnet" ? "USDC" : usdcLabel);

export const USDC_DECIMALS = 6;
export const LAUNCH_TOKEN_DECIMALS = 6;

/** True when the payment mint is Circle's official USDC (mainnet or devnet). */
export const isCircleUsdc = publicConfig.usdcMint === MAINNET_USDC || publicConfig.usdcMint === CIRCLE_DEVNET_USDC;
export const usdcLabel = isCircleUsdc ? "USDC" : "Test USDC";
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
