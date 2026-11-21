export interface GatewayEnvironment {
  databaseMode: "neon" | "embedded-pg";
  neonConfigured: boolean;
  gatewayEndpoint: string;
  serverGeminiKeyAvailable?: boolean;
  emailVerificationEnabled?: boolean;
  allowLocalProviders?: boolean;
}

export interface KeyTestResult {
  index: number;
  maskedKey: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export interface GatewayApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  allowedCombo: string | null;
  freeOnly: boolean;
  dailyTokenLimit: number | null;
  monthlyUsdLimit: number | null;
  usedTokensToday: number;
  usedCostMonth: number;
  quotaResetAt: string;
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ModelHealthEntry {
  ok: boolean;
  latencyMs: number;
  supportsTools?: boolean;
  testedAt: string;
  error?: string;
}

export interface ProviderConnection {
  id: string;
  userId: string;
  provider: string;
  name: string;
  baseUrl: string | null;
  defaultModel: string | null;
  availableModels: string[];
  maskedKey: string;
  useServerKey?: boolean;
  poolKeyCount: number;
  maskedPoolKeys: string[];
  isActive: boolean;
  rpmLimit: number | null;
  rpdLimit: number | null;
  dailyTokenQuota: number | null;
  monthlyUsdQuota: number | null;
  usedRequestsToday: number;
  usedTokensToday: number;
  usedCostMonth: number;
  quotaResetAt: string;
  circuitStatus: "healthy" | "half_open" | "open" | string;
  failureCount: number;
  cooldownUntil: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  modelHealth: Record<string, ModelHealthEntry>;
  createdAt: string;
}

export interface ComboTier {
  id: string;
  comboId: string;
  connectionId: string;
  upstreamModel: string;
  priority: number;
  weight: number;
  maxRetries: number;
  requestCount: number;
}

export interface Combo {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  strategy: string;
  compressPrompt: boolean;
  freeOnly: boolean;
  enableCache: boolean;
  isActive: boolean;
  roundRobinCursor: number;
  createdAt: string;
  tiers: ComboTier[];
}

export interface WildcardRoute {
  id: string;
  userId: string;
  pattern: string;
  comboId: string;
  isActive: boolean;
  createdAt: string;
}

export interface FallbackHop {
  tierId: string;
  connectionId: string;
  connectionName: string;
  provider: string;
  model: string;
  status: "success" | "failed" | "skipped";
  statusCode?: number;
  reason: string;
  latencyMs: number;
}

export interface RequestLog {
  id: string;
  userId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string | null;
  comboName: string | null;
  requestedModel: string;
  resolvedProvider: string;
  resolvedModel: string;
  connectionName: string | null;
  statusCode: number;
  outcome: string;
  fallbackAttempts: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  compressed: boolean;
  detectedIntent?: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ModelBucketMetric {
  costUsd: number;
  tokens: number;
  requests: number;
}

export interface AnalyticsBucket {
  label: string;
  total: number;
  success: number;
  fallback: number;
  error: number;
  avgLatencyMs: number;
  tokens: number;
  costUsd: number;
  successRate: number;
  blendedPer1M: number;
  byModel: Record<string, ModelBucketMetric>;
}

export interface ProviderBreakdown {
  provider: string;
  requests: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface TopApiKeyStat {
  id: string;
  name: string;
  keyPrefix: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface TopRouteStat {
  name: string;
  subtitle: string;
  provider: string;
  requests: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface ModelUsageSummary {
  model: string;
  provider: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface AnalyticsSummary {
  range: "24h" | "7d" | "30d";
  totalRequests: number;
  successRate: number;
  fallbackRecovered: number;
  errorCount: number;
  totalTokens: number;
  totalCostUsd: number;
  blendedCostPer1M: number;
  p50: number;
  p95: number;
  p99: number;
  deltas: {
    spendPct: number | null;
    requestsPct: number | null;
    tokensPct: number | null;
    successRatePct: number | null;
    blendedPct: number | null;
  };
  buckets: AnalyticsBucket[];
  providers: ProviderBreakdown[];
  topApiKeys: TopApiKeyStat[];
  topRoutes: TopRouteStat[];
  models: ModelUsageSummary[];
}

export interface BootstrapPayload {
  user: {
    id: string;
    email: string;
    name: string;
    hasPassword?: boolean;
    authProviders?: string[];
  };
  environment: GatewayEnvironment;
  keys: GatewayApiKey[];
  connections: ProviderConnection[];
  combos: Combo[];
  wildcards: WildcardRoute[];
  logs: RequestLog[];
}

export interface LiveRouteActivity {
  requestId: string;
  phase: "start" | "end";
  provider: string;
  model: string;
  connectionId: string;
  connectionName: string;
  requestedModel: string;
  outcome?: "success" | "error";
  timestamp: string;
}

