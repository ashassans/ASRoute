import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import pg from "pg";
import * as schema from "./schema.ts";

const { Pool } = pg;

export type AppDatabase = NodePgDatabase<typeof schema>;

const connectionString =
  process.env.DATABASE_URL?.trim() || process.env.NEON_DATABASE_URL?.trim() || "";

export const isNeonConfigured = Boolean(connectionString);
export const databaseMode: "neon" | "embedded-pg" = isNeonConfigured
  ? "neon"
  : "embedded-pg";

declare global {
  var _asRouterPool: pg.Pool | undefined;
  var _asRouterPglite: PGlite | undefined;
  var _asRouterDb: AppDatabase | undefined;
  var _asRouterSchemaPromise: Promise<void> | undefined;
}

function getOrCreateDb(): AppDatabase {
  if (global._asRouterDb) {
    return global._asRouterDb;
  }

  if (isNeonConfigured) {
    const isLocal =
      connectionString.includes("localhost") ||
      connectionString.includes("127.0.0.1");

    const pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    pool.on("error", (err) => {
      console.error("[AS ROUTER] PostgreSQL pool error:", err);
    });

    global._asRouterPool = pool;
    global._asRouterDb = drizzlePg(pool, { schema });
    return global._asRouterDb;
  }

  const pglite = new PGlite("./.asrouter-pgdata");
  global._asRouterPglite = pglite;
  global._asRouterDb = drizzlePglite(pglite, {
    schema,
  }) as unknown as AppDatabase;
  return global._asRouterDb;
}

export const db: AppDatabase = getOrCreateDb();

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "email_verified" boolean DEFAULT false NOT NULL,
    "image" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "session" (
    "id" text PRIMARY KEY NOT NULL,
    "expires_at" timestamp NOT NULL,
    "token" text NOT NULL UNIQUE,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "ip_address" text,
    "user_agent" text,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "account" (
    "id" text PRIMARY KEY NOT NULL,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" timestamp,
    "refresh_token_expires_at" timestamp,
    "scope" text,
    "password" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "verification" (
    "id" text PRIMARY KEY NOT NULL,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "gateway_api_keys" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "key_prefix" text NOT NULL,
    "key_hash" text NOT NULL UNIQUE,
    "is_active" boolean DEFAULT true NOT NULL,
    "allowed_combo" text,
    "free_only" boolean DEFAULT false NOT NULL,
    "daily_token_limit" integer,
    "monthly_usd_limit" double precision,
    "used_tokens_today" integer DEFAULT 0 NOT NULL,
    "used_cost_month" double precision DEFAULT 0 NOT NULL,
    "quota_reset_at" timestamp DEFAULT now() NOT NULL,
    "total_requests" integer DEFAULT 0 NOT NULL,
    "total_tokens" integer DEFAULT 0 NOT NULL,
    "total_cost_usd" double precision DEFAULT 0 NOT NULL,
    "last_used_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "provider_connections" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "provider" text NOT NULL,
    "name" text NOT NULL,
    "base_url" text,
    "default_model" text,
    "available_models" text,
    "encrypted_api_key" text,
    "encrypted_key_pool" text,
    "key_pool_cursor" integer DEFAULT 0 NOT NULL,
    "use_server_key" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "rpm_limit" integer,
    "rpd_limit" integer,
    "daily_token_quota" integer,
    "monthly_usd_quota" double precision,
    "used_requests_today" integer DEFAULT 0 NOT NULL,
    "used_tokens_today" integer DEFAULT 0 NOT NULL,
    "used_cost_month" double precision DEFAULT 0 NOT NULL,
    "quota_reset_at" timestamp DEFAULT now() NOT NULL,
    "circuit_status" text DEFAULT 'healthy' NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "cooldown_until" timestamp,
    "last_latency_ms" integer,
    "last_error" text,
    "model_health" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "combos" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "description" text,
    "strategy" text DEFAULT 'priority' NOT NULL,
    "compress_prompt" boolean DEFAULT false NOT NULL,
    "free_only" boolean DEFAULT false NOT NULL,
    "enable_cache" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "round_robin_cursor" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "combo_tiers" (
    "id" text PRIMARY KEY NOT NULL,
    "combo_id" text NOT NULL REFERENCES "combos"("id") ON DELETE CASCADE,
    "connection_id" text NOT NULL REFERENCES "provider_connections"("id") ON DELETE CASCADE,
    "upstream_model" text NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "weight" integer DEFAULT 100 NOT NULL,
    "max_retries" integer DEFAULT 1 NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "wildcard_routes" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "pattern" text NOT NULL,
    "combo_id" text NOT NULL REFERENCES "combos"("id") ON DELETE CASCADE,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "request_logs" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "api_key_id" text,
    "api_key_prefix" text,
    "combo_name" text,
    "requested_model" text NOT NULL,
    "resolved_provider" text NOT NULL,
    "resolved_model" text NOT NULL,
    "connection_name" text,
    "status_code" integer NOT NULL,
    "outcome" text NOT NULL,
    "fallback_attempts" text DEFAULT '[]' NOT NULL,
    "prompt_tokens" integer DEFAULT 0 NOT NULL,
    "completion_tokens" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
    "latency_ms" integer DEFAULT 0 NOT NULL,
    "compressed" boolean DEFAULT false NOT NULL,
    "detected_intent" text,
    "error_message" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `ALTER TABLE "request_logs" ADD COLUMN IF NOT EXISTS "detected_intent" text`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "default_model" text`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "available_models" text`,
  `ALTER TABLE "gateway_api_keys" ADD COLUMN IF NOT EXISTS "used_tokens_today" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "gateway_api_keys" ADD COLUMN IF NOT EXISTS "used_cost_month" double precision DEFAULT 0 NOT NULL`,
  `ALTER TABLE "gateway_api_keys" ADD COLUMN IF NOT EXISTS "quota_reset_at" timestamp DEFAULT now() NOT NULL`,
  `ALTER TABLE "gateway_api_keys" ADD COLUMN IF NOT EXISTS "free_only" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "encrypted_key_pool" text`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "key_pool_cursor" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "rpm_limit" integer`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "rpd_limit" integer`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "used_requests_today" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "model_health" text`,
  `ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "free_only" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "enable_cache" boolean DEFAULT false NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "idx_request_logs_user_created" ON "request_logs" ("user_id", "created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_gateway_keys_hash" ON "gateway_api_keys" ("key_hash")`,
  `CREATE INDEX IF NOT EXISTS "idx_gateway_keys_user" ON "gateway_api_keys" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_provider_connections_user" ON "provider_connections" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_combos_user" ON "combos" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_combo_tiers_combo" ON "combo_tiers" ("combo_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_wildcard_routes_user" ON "wildcard_routes" ("user_id")`,
  `DELETE FROM "provider_connections" WHERE "use_server_key" = true`,
];

async function executeSchemaInit(): Promise<void> {
  const batchedSql = `${DDL_STATEMENTS.join(";\n")};`;
  if (global._asRouterPool) {
    await global._asRouterPool.query(batchedSql);
    return;
  }
  if (global._asRouterPglite) {
    await global._asRouterPglite.waitReady;
    await global._asRouterPglite.exec(batchedSql);
  }
}

export async function ensureSchema(): Promise<void> {
  if (!global._asRouterSchemaPromise) {
    global._asRouterSchemaPromise = executeSchemaInit().catch((err) => {
      global._asRouterSchemaPromise = undefined;
      throw err;
    });
  }
  return global._asRouterSchemaPromise;
}
