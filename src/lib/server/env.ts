import "server-only";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(`Missing required environment variable ${name}. See .env.example and docs/SETUP.md.`);
  return v;
}

export class ConfigError extends Error {}

export const serverEnv = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get rpcUrl() {
    return process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
  },
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new ConfigError("SESSION_SECRET must be at least 32 characters");
    return new TextEncoder().encode(s);
  },
  get agentKeyEncryptionKey() {
    const raw = Buffer.from(required("AGENT_KEY_ENCRYPTION_KEY"), "base64");
    if (raw.length !== 32) throw new ConfigError("AGENT_KEY_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return raw;
  },
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY || null;
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
  },
  get adminWallets() {
    return (process.env.ADMIN_WALLETS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get pinataJwt() {
    return process.env.PINATA_JWT || null;
  },
  get mainnetRpcUrl() {
    return process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
  },
  /** pump.fun launches need the feature flag AND Pinata (pump.fun no longer hosts metadata). */
  get pumpfunEnabled() {
    return process.env.PUMPFUN_ENABLED === "true" && !!process.env.PINATA_JWT;
  },
  get testUsdcFaucetEnabled() {
    return process.env.TEST_USDC_FAUCET_ENABLED === "true";
  },
};

export function parseSecretKey(value: string, name: string): Keypair {
  const v = value.trim();
  try {
    if (v.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(v)));
    return Keypair.fromSecretKey(bs58.decode(v));
  } catch {
    throw new ConfigError(`${name} is not a valid Solana secret key (JSON byte array or base58)`);
  }
}

let feePayer: Keypair | null = null;
/** Platform key that pays SOL network fees for agent payments. Holds no user funds. */
export function getFeePayer(): Keypair {
  if (!feePayer) feePayer = parseSecretKey(required("FEE_PAYER_SECRET_KEY"), "FEE_PAYER_SECRET_KEY");
  return feePayer;
}

let mainnetFeePayer: Keypair | null = null;
/**
 * Fee payer for MAINNET agent payments (real SOL). Uses MAINNET_FEE_PAYER_SECRET_KEY if set,
 * otherwise the same key as devnet. It must hold real SOL on mainnet.
 */
export function getFeePayerFor(network: "devnet" | "mainnet"): Keypair {
  if (network === "devnet") return getFeePayer();
  const v = process.env.MAINNET_FEE_PAYER_SECRET_KEY;
  if (!v) return getFeePayer();
  if (!mainnetFeePayer) mainnetFeePayer = parseSecretKey(v, "MAINNET_FEE_PAYER_SECRET_KEY");
  return mainnetFeePayer;
}

/** Mint authority for the optional Test-USDC faucet (only if you created your own test mint). */
export function getTestUsdcAuthority(): Keypair | null {
  const v = process.env.TEST_USDC_MINT_AUTHORITY_SECRET_KEY;
  return v ? parseSecretKey(v, "TEST_USDC_MINT_AUTHORITY_SECRET_KEY") : null;
}
