import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth Core Tables
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// AS ROUTER Unified AI Gateway Tables
// ---------------------------------------------------------------------------

export const gatewayApiKeys = pgTable("gateway_api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  allowedCombo: text("allowed_combo"),
  freeOnly: boolean("free_only").notNull().default(false),
  dailyTokenLimit: integer("daily_token_limit"),
  monthlyUsdLimit: doublePrecision("monthly_usd_limit"),
  usedTokensToday: integer("used_tokens_today").notNull().default(0),
  usedCostMonth: doublePrecision("used_cost_month").notNull().default(0),
  quotaResetAt: timestamp("quota_reset_at").notNull().defaultNow(),
  totalRequests: integer("total_requests").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const providerConnections = pgTable("provider_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  defaultModel: text("default_model"),
  availableModels: text("available_models"),
  encryptedApiKey: text("encrypted_api_key"),
  encryptedKeyPool: text("encrypted_key_pool"),
  keyPoolCursor: integer("key_pool_cursor").notNull().default(0),
  useServerKey: boolean("use_server_key").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  rpmLimit: integer("rpm_limit"),
  rpdLimit: integer("rpd_limit"),
  dailyTokenQuota: integer("daily_token_quota"),
  monthlyUsdQuota: doublePrecision("monthly_usd_quota"),
  usedRequestsToday: integer("used_requests_today").notNull().default(0),
  usedTokensToday: integer("used_tokens_today").notNull().default(0),
  usedCostMonth: doublePrecision("used_cost_month").notNull().default(0),
  quotaResetAt: timestamp("quota_reset_at").notNull().defaultNow(),
  circuitStatus: text("circuit_status").notNull().default("healthy"),
  failureCount: integer("failure_count").notNull().default(0),
  cooldownUntil: timestamp("cooldown_until"),
  lastLatencyMs: integer("last_latency_ms"),
  lastError: text("last_error"),
  modelHealth: text("model_health"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const combos = pgTable("combos", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  strategy: text("strategy").notNull().default("priority"),
  compressPrompt: boolean("compress_prompt").notNull().default(false),
  freeOnly: boolean("free_only").notNull().default(false),
  enableCache: boolean("enable_cache").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  roundRobinCursor: integer("round_robin_cursor").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const comboTiers = pgTable("combo_tiers", {
  id: text("id").primaryKey(),
  comboId: text("combo_id")
    .notNull()
    .references(() => combos.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => providerConnections.id, { onDelete: "cascade" }),
  upstreamModel: text("upstream_model").notNull(),
  priority: integer("priority").notNull().default(0),
  weight: integer("weight").notNull().default(100),
  maxRetries: integer("max_retries").notNull().default(1),
  requestCount: integer("request_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const wildcardRoutes = pgTable("wildcard_routes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),
  comboId: text("combo_id")
    .notNull()
    .references(() => combos.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const requestLogs = pgTable("request_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  apiKeyId: text("api_key_id"),
  apiKeyPrefix: text("api_key_prefix"),
  comboName: text("combo_name"),
  requestedModel: text("requested_model").notNull(),
  resolvedProvider: text("resolved_provider").notNull(),
  resolvedModel: text("resolved_model").notNull(),
  connectionName: text("connection_name"),
  statusCode: integer("status_code").notNull(),
  outcome: text("outcome").notNull(),
  fallbackAttempts: text("fallback_attempts").notNull().default("[]"),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  compressed: boolean("compressed").notNull().default(false),
  detectedIntent: text("detected_intent"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
