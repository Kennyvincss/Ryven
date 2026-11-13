/**
 * Public (browser-safe) configuration. Everything here comes from NEXT_PUBLIC_* env
 * vars and must never contain secrets.
 */
export const CIRCLE_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export const publicConfig = {
  cluster: (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta" | "testnet",
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT ?? CIRCLE_DEVNET_USDC,
  curveProgramId: process.env.NEXT_PUBLIC_CURVE_PROGRAM_ID || null,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export const USDC_DECIMALS = 6;
export const LAUNCH_TOKEN_DECIMALS = 6;

/** True when the configured payment mint is Circle's official devnet USDC. */
export const isCircleUsdc = publicConfig.usdcMint === CIRCLE_DEVNET_USDC;
export const usdcLabel = isCircleUsdc ? "USDC" : "Test USDC";

export function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=${publicConfig.cluster}`;
}
export function explorerAddress(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=${publicConfig.cluster}`;
}

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
