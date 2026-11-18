import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Base-unit amounts (USDC has 6 decimals). Stored as bigint, used as JS bigint. */
const amount = (name: string) => bigint(name, { mode: "bigint" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ───────────────────────────── enums ─────────────────────────────
export const launchModeEnum = pgEnum("launch_mode", ["fixed_supply", "bonding_curve", "pumpfun"]);
export const networkEnum = pgEnum("network", ["devnet", "mainnet"]);
/** What a treasury / payment is denominated in: USDC, or the agent's own launched token. */
export const assetEnum = pgEnum("asset", ["usdc", "token", "sol"]);
export const tradingModeEnum = pgEnum("trading_mode", ["off", "proposal", "autonomous"]);
export const tradeSideEnum2 = pgEnum("trade_action", ["buy", "sell", "swap"]);
export const tradeStatusEnum = pgEnum("trade_status", [
  "rejected", // failed a policy check
  "awaiting_signature", // proposal mode: waiting for the creator to sign in their wallet
  "executing", // sent to Solana
  "confirmed", // landed + verified
  "failed", // did not land / failed on-chain
  "cancelled", // creator dismissed the proposal
]);
export const launchStatusEnum = pgEnum("launch_status", ["pending", "live", "graduated", "failed"]);
export const agentStatusEnum = pgEnum("agent_status", ["active", "paused"]);
export const agentModeEnum = pgEnum("agent_mode", ["autonomous", "approval"]);
export const recipientPolicyEnum = pgEnum("recipient_policy", ["allowlist_only", "allowlist_or_approval"]);
export const contributorStatusEnum = pgEnum("contributor_status", ["approved", "suspended"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "rejected", // failed a hard policy check — never executed
  "awaiting_approval", // valid but needs creator approval
  "approved", // reserved against budget, ready to execute
  "executing", // claimed by executor, signature persisted
  "confirmed", // landed + verified on-chain
  "failed", // execution failed (did not land)
  "cancelled", // creator rejected the approval
]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);

// ───────────────────────────── identity ─────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  wallet: text("wallet").notNull().unique(),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  wallet: text("wallet").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ───────────────────────────── tokens ─────────────────────────────
export const metadataBlobs = pgTable("metadata_blobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  contentType: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  uploaderWallet: text("uploader_wallet").notNull(),
  createdAt: createdAt(),
});

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mint: text("mint").notNull().unique(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    description: text("description").notNull().default(""),
    imageUri: text("image_uri"),
    metadataUri: text("metadata_uri").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    tokenProgram: text("token_program").notNull(),
    decimals: integer("decimals").notNull(),
    totalSupply: amount("total_supply").notNull(),
    launchMode: launchModeEnum("launch_mode").notNull(),
    /** Cluster the mint lives on. Ryven launches + agents: devnet. pump.fun launches: mainnet. */
    network: networkEnum("network").notNull().default("devnet"),
    launchStatus: launchStatusEnum("launch_status").notNull().default("pending"),
    launchSignature: text("launch_signature").notNull(),
    curveAddress: text("curve_address"),
    website: text("website"),
    twitter: text("twitter"),
    telegram: text("telegram"),
    createdAt: createdAt(),
  },
  (t) => [index("tokens_creator_idx").on(t.creatorWallet), index("tokens_created_idx").on(t.createdAt)],
);

export const tokenTrades = pgTable(
  "token_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    signature: text("signature").notNull().unique(),
    side: tradeSideEnum("side").notNull(),
    trader: text("trader").notNull(),
    solAmount: amount("sol_amount").notNull(), // lamports
    tokenAmount: amount("token_amount").notNull(), // base units
    priceLamportsPerToken: text("price").notNull(), // decimal string, display only
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("trades_token_time_idx").on(t.tokenId, t.blockTime)],
);

// ───────────────────────────── agents ─────────────────────────────
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .unique()
      .references(() => tokens.id, { onDelete: "restrict" }),
    creatorWallet: text("creator_wallet").notNull(),
    /** Cluster the agent's treasury and payments live on (same as its token). */
    network: networkEnum("network").notNull().default("devnet"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    personality: text("personality").notNull().default(""),
    objectives: text("objectives").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    avatarSeed: text("avatar_seed").notNull(),
    status: agentStatusEnum("status").notNull().default("active"),
    pausedReason: text("paused_reason"),
    mode: agentModeEnum("mode").notNull().default("autonomous"),
    // ── spending policy (base units). Only the creator can change these. ──
    maxPerTx: amount("max_per_tx").notNull(),
    autoApproveLimit: amount("auto_approve_limit").notNull(),
    dailyLimit: amount("daily_limit").notNull(),
    categories: text("categories").array().notNull().default(sql`ARRAY[]::text[]`),
    recipientPolicy: recipientPolicyEnum("recipient_policy").notNull().default("allowlist_only"),
    // ── rewards paid in the agent's own token (base units of that token). null = disabled ──
    tokenMaxPerTx: bigint("token_max_per_tx", { mode: "bigint" }),
    tokenAutoApproveLimit: bigint("token_auto_approve_limit", { mode: "bigint" }),
    tokenDailyLimit: bigint("token_daily_limit", { mode: "bigint" }),
    // ── SOL payments (lamports). null = disabled ──
    solMaxPerTx: bigint("sol_max_per_tx", { mode: "bigint" }),
    solAutoApproveLimit: bigint("sol_auto_approve_limit", { mode: "bigint" }),
    solDailyLimit: bigint("sol_daily_limit", { mode: "bigint" }),
    // ── pump.fun trading on mainnet (lamports). Only the creator can change these. ──
    tradingMode: tradingModeEnum("trading_mode").notNull().default("off"),
    tradeMaxSol: bigint("trade_max_sol", { mode: "bigint" }).notNull().default(sql`0`),
    tradeDailySol: bigint("trade_daily_sol", { mode: "bigint" }).notNull().default(sql`0`),
    tradeMints: text("trade_mints").array().notNull().default(sql`ARRAY[]::text[]`),
    // Daily wallet brief (portfolio analysis + ideas), generated on a schedule.
    briefEnabled: boolean("brief_enabled").notNull().default(false),
    briefHourUtc: integer("brief_hour_utc").notNull().default(8),
    briefLastAt: timestamp("brief_last_at", { withTimezone: true }),
    // Public key of the agent's delegate signer (private key lives in agent_signers).
    signerPubkey: text("signer_pubkey").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agents_creator_idx").on(t.creatorWallet)],
);

/** Encrypted agent signing keys. Never selected by any API route. */
export const agentSigners = pgTable("agent_signers", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: createdAt(),
});

export const treasuries = pgTable(
  "treasuries",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  asset: assetEnum("asset").notNull().default("usdc"),
  address: text("address").notNull().unique(),
  seed: text("seed").notNull(),
  ownerWallet: text("owner_wallet").notNull(),
  mint: text("mint").notNull(),
  tokenProgram: text("token_program").notNull().default("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  decimals: integer("decimals").notNull().default(6),
  symbol: text("symbol").notNull().default("USDC"),
  // Display cache only — authoritative values are always read from chain.
  lastBalance: amount("last_balance").notNull().default(sql`0`),
  lastAllowance: amount("last_allowance").notNull().default(sql`0`),
  lastDelegate: text("last_delegate"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  totalDeposits: amount("total_deposits").notNull().default(sql`0`),
  totalSpent: amount("total_spent").notNull().default(sql`0`),
  createdAt: createdAt(),
  },
  (t) => [uniqueIndex("treasuries_agent_asset_uq").on(t.agentId, t.asset)],
);

export const treasuryDeposits = pgTable(
  "treasury_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    treasuryId: uuid("treasury_id")
      .notNull()
      .references(() => treasuries.id, { onDelete: "cascade" }),
    signature: text("signature").notNull().unique(),
    fromWallet: text("from_wallet").notNull(),
    amount: amount("amount").notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("deposits_treasury_idx").on(t.treasuryId)],
);

export const contributors = pgTable(
  "contributors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    handle: text("handle").notNull(),
    role: text("role").notNull().default("community"),
    status: contributorStatusEnum("status").notNull().default("approved"),
    activityScore: integer("activity_score").notNull().default(0),
    note: text("note").notNull().default(""),
    addedBy: text("added_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contributors_agent_wallet_uq").on(t.agentId, t.wallet)],
);

// ───────────────────────────── payments ─────────────────────────────
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    instructionId: text("instruction_id"),
    source: text("source").notNull(), // "agent" | "creator"
    recipient: text("recipient").notNull(),
    contributorId: uuid("contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    amount: amount("amount").notNull(),
    mint: text("mint").notNull(),
    asset: assetEnum("asset").notNull().default("usdc"),
    decimals: integer("decimals").notNull().default(6),
    symbol: text("symbol").notNull().default("USDC"),
    network: networkEnum("network").notNull().default("devnet"),
    category: text("category").notNull(),
    campaign: text("campaign").notNull().default(""),
    reason: text("reason").notNull(),
    status: paymentStatusEnum("status").notNull(),
    policy: jsonb("policy").$type<PolicyRecord>().notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    signature: text("signature").unique(),
    lastValidBlockHeight: bigint("last_valid_block_height", { mode: "number" }),
    error: text("error"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_agent_created_idx").on(t.agentId, t.createdAt),
    index("payments_status_idx").on(t.status),
    index("payments_agent_recipient_idx").on(t.agentId, t.recipient),
  ],
);

export type PolicyCheck = { id: string; label: string; passed: boolean; detail: string; effect?: "reject" | "approval" };
export type PolicyRecord = { decision: "approve" | "needs_approval" | "reject"; summary: string; checks: PolicyCheck[] };

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id")
    .notNull()
    .unique()
    .references(() => payments.id, { onDelete: "cascade" }),
  status: approvalStatusEnum("status").notNull().default("pending"),
  approverWallet: text("approver_wallet"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const agentActivities = pgTable(
  "agent_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    instructionId: text("instruction_id"),
    type: text("type").notNull(),
    status: text("status").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("activities_agent_created_idx").on(t.agentId, t.createdAt)],
);

export const alertStatusEnum = pgEnum("alert_status", ["active", "triggered", "cancelled"]);

/** Price / market-cap alerts the agent sets for its creator (checked every minute). */
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    mint: text("mint").notNull(),
    symbol: text("symbol").notNull(),
    metric: text("metric").notNull(), // "price" | "market_cap" (USD)
    direction: text("direction").notNull(), // "above" | "below"
    target: doublePrecision("target").notNull(),
    /** Value when the alert was set (for "rises/falls X%" alerts and context). */
    baseValue: doublePrecision("base_value"),
    /** How the creator phrased it, e.g. "falls 20%". */
    condition: text("condition").notNull(),
    note: text("note"),
    status: alertStatusEnum("status").notNull().default("active"),
    triggeredValue: doublePrecision("triggered_value"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastValue: doublePrecision("last_value"),
    createdAt: createdAt(),
  },
  (t) => [index("alerts_agent_idx").on(t.agentId, t.createdAt), index("alerts_status_idx").on(t.status)],
);

export const walletBriefs = pgTable(
  "wallet_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // "scheduled" | "manual"
    content: text("content").notNull(),
    totalUsd: doublePrecision("total_usd"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("briefs_agent_created_idx").on(t.agentId, t.createdAt)],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    instructionId: text("instruction_id"),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_agent_created_idx").on(t.agentId, t.createdAt)],
);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Agent trades on pump.fun (mainnet). Proposal mode: creator signs. Autonomous: agent wallet signs. */
export const agentTrades = pgTable(
  "agent_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    instructionId: text("instruction_id"),
    mode: tradingModeEnum("mode").notNull(),
    action: tradeSideEnum2("action").notNull(),
    mint: text("mint").notNull(),
    /** buy: lamports of SOL to spend. sell: percent of holdings (1-100). swap: SOL-equivalent value in lamports (counts toward limits). */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    /** swap only: what is sold (mint + raw amount) and what was received. `mint` holds the output mint. */
    inputMint: text("input_mint"),
    inputAmount: bigint("input_amount", { mode: "bigint" }),
    inputDecimals: integer("input_decimals"),
    outputDecimals: integer("output_decimals"),
    quotedOut: bigint("quoted_out", { mode: "bigint" }),
    outputAmount: bigint("output_amount", { mode: "bigint" }),
    reason: text("reason").notNull(),
    /** Wallet that executes the trade: creator (proposal) or the agent's trading wallet (autonomous). */
    wallet: text("wallet").notNull(),
    status: tradeStatusEnum("status").notNull(),
    policy: jsonb("policy").$type<PolicyRecord>().notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    signature: text("signature").unique(),
    solDelta: bigint("sol_delta", { mode: "bigint" }),
    error: text("error"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("trades_agent_created_idx").on(t.agentId, t.createdAt)],
);
