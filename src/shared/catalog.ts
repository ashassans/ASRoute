export type ProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "groq"
  | "deepseek"
  | "mistral"
  | "openrouter"
  | "xai"
  | "cerebras"
  | "together"
  | "fireworks"
  | "perplexity"
  | "custom";

export type RoutingStrategy =
  | "priority"
  | "round_robin"
  | "weighted"
  | "least_used"
  | "cost_optimized"
  | "intent_auto";

export type ModelCapability =
  | "fast"
  | "coding"
  | "reasoning"
  | "vision"
  | "tools";

export type DetectedIntent =
  | "vision"
  | "tools"
  | "coding"
  | "reasoning"
  | "fast";

export interface ModelSpec {
  id: string;
  label: string;
  inputPer1MUsd: number;
  outputPer1MUsd: number;
  capabilities: ModelCapability[];
  tierRank: "lite" | "balanced" | "flagship";
}

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  supportsServerKey: boolean;
  models: ModelSpec[];
}

export const PROVIDER_CATALOG: ProviderSpec[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    supportsServerKey: true,
    models: [
      {
        id: "gemini-4-hydrogen",
        label: "Gemini 4 Hydrogen (Fast)",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "gemini-4-neon",
        label: "Gemini 4 Neon (Pro)",
        inputPer1MUsd: 1.25,
        outputPer1MUsd: 5.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gemini-4-argon",
        label: "Gemini 4 Argon (Reasoning)",
        inputPer1MUsd: 1.0,
        outputPer1MUsd: 4.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gemini-4-carbon",
        label: "Gemini 4 Carbon (Deep)",
        inputPer1MUsd: 2.5,
        outputPer1MUsd: 10.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro Preview",
        inputPer1MUsd: 1.25,
        outputPer1MUsd: 5.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        inputPer1MUsd: 0.075,
        outputPer1MUsd: 0.3,
        capabilities: ["fast", "vision", "tools"],
        tierRank: "lite",
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        inputPer1MUsd: 1.25,
        outputPer1MUsd: 10.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        inputPer1MUsd: 0.1,
        outputPer1MUsd: 0.4,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "lite",
      },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    supportsServerKey: false,
    models: [
      {
        id: "gpt-6.2-sol",
        label: "GPT-6.2 Sol (Balanced)",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 10.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "gpt-6.2-astra",
        label: "GPT-6.2 Astra (Flagship)",
        inputPer1MUsd: 8.0,
        outputPer1MUsd: 40.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gpt-6.1-terra",
        label: "GPT-6.1 Terra (Vision)",
        inputPer1MUsd: 1.0,
        outputPer1MUsd: 5.0,
        capabilities: ["fast", "vision", "tools", "coding"],
        tierRank: "balanced",
      },
      {
        id: "gpt-6-luna",
        label: "GPT-6 Luna (Fast)",
        inputPer1MUsd: 0.1,
        outputPer1MUsd: 0.5,
        capabilities: ["fast", "vision", "tools", "coding"],
        tierRank: "lite",
      },
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        inputPer1MUsd: 2.5,
        outputPer1MUsd: 10.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gpt-4.1",
        label: "GPT-4.1",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 8.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gpt-4.1-mini",
        label: "GPT-4.1 Mini",
        inputPer1MUsd: 0.4,
        outputPer1MUsd: 1.6,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "o4-mini",
        label: "o4-mini (Reasoning)",
        inputPer1MUsd: 1.1,
        outputPer1MUsd: 4.4,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "balanced",
      },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    supportsServerKey: false,
    models: [
      {
        id: "claude-sonnet-5-5",
        label: "Claude Sonnet 5.5",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 10.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "claude-opus-5-5",
        label: "Claude Opus 5.5",
        inputPer1MUsd: 4.0,
        outputPer1MUsd: 20.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "claude-haiku-5-5",
        label: "Claude Haiku 5.5",
        inputPer1MUsd: 0.8,
        outputPer1MUsd: 4.0,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "lite",
      },
      {
        id: "claude-fable-5-2",
        label: "Claude Fable 5.2",
        inputPer1MUsd: 8.0,
        outputPer1MUsd: 40.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "claude-sonnet-4-20250514",
        label: "Claude Sonnet 4",
        inputPer1MUsd: 3.0,
        outputPer1MUsd: 15.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "claude-3-5-haiku-20241022",
        label: "Claude 3.5 Haiku",
        inputPer1MUsd: 0.8,
        outputPer1MUsd: 4.0,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "lite",
      },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    supportsServerKey: false,
    models: [
      {
        id: "qwen/qwen3.8-27b",
        label: "Qwen 3.8 27B",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.45,
        capabilities: ["fast", "coding", "reasoning", "tools"],
        tierRank: "balanced",
      },
      {
        id: "openai/gpt-oss-20b",
        label: "GPT-OSS 20B",
        inputPer1MUsd: 0.08,
        outputPer1MUsd: 0.3,
        capabilities: ["fast", "coding", "tools"],
        tierRank: "lite",
      },
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        label: "Llama 4 Scout 17B",
        inputPer1MUsd: 0.11,
        outputPer1MUsd: 0.34,
        capabilities: ["fast", "vision", "coding", "tools"],
        tierRank: "balanced",
      },
      {
        id: "meta-llama/llama-4-maverick-17b-128e-instruct",
        label: "Llama 4 Maverick 17B",
        inputPer1MUsd: 0.2,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "vision", "coding", "tools"],
        tierRank: "flagship",
      },
      {
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B",
        inputPer1MUsd: 0.59,
        outputPer1MUsd: 0.79,
        capabilities: ["fast", "coding", "tools"],
        tierRank: "balanced",
      },
      {
        id: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B Instant",
        inputPer1MUsd: 0.05,
        outputPer1MUsd: 0.08,
        capabilities: ["fast", "tools"],
        tierRank: "lite",
      },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    supportsServerKey: false,
    models: [
      {
        id: "deepseek-flash",
        label: "DeepSeek Flash (V4.1)",
        inputPer1MUsd: 0.2,
        outputPer1MUsd: 0.8,
        capabilities: ["fast", "coding", "reasoning", "tools"],
        tierRank: "balanced",
      },
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        inputPer1MUsd: 0.55,
        outputPer1MUsd: 2.19,
        capabilities: ["coding", "reasoning", "tools"],
        tierRank: "flagship",
      },
      {
        id: "deepseek-v3.2",
        label: "DeepSeek V3.2",
        inputPer1MUsd: 0.27,
        outputPer1MUsd: 1.1,
        capabilities: ["fast", "coding", "tools"],
        tierRank: "balanced",
      },
    ],
  },
  {
    id: "mistral",
    label: "Mistral AI",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    supportsServerKey: false,
    models: [
      {
        id: "mistral-large-latest",
        label: "Mistral Large 4",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 6.0,
        capabilities: ["coding", "reasoning", "tools"],
        tierRank: "flagship",
      },
      {
        id: "mistral-small-latest",
        label: "Mistral Small 4",
        inputPer1MUsd: 0.1,
        outputPer1MUsd: 0.3,
        capabilities: ["fast", "tools"],
        tierRank: "lite",
      },
      {
        id: "mistral-medium-latest",
        label: "Mistral Medium",
        inputPer1MUsd: 0.4,
        outputPer1MUsd: 2.0,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "ministral-8b-latest",
        label: "Ministral 8B",
        inputPer1MUsd: 0.06,
        outputPer1MUsd: 0.18,
        capabilities: ["fast", "tools"],
        tierRank: "lite",
      },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    supportsServerKey: false,
    models: [
      {
        id: "google/gemini-4-hydrogen",
        label: "Gemini 4 Hydrogen (OR)",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "vision", "tools", "coding"],
        tierRank: "balanced",
      },
      {
        id: "openai/gpt-6.2-sol",
        label: "GPT-6.2 Sol (OR)",
        inputPer1MUsd: 1.75,
        outputPer1MUsd: 7.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "anthropic/claude-sonnet-5.5",
        label: "Claude Sonnet 5.5 (OR)",
        inputPer1MUsd: 3.0,
        outputPer1MUsd: 15.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "openrouter/free",
        label: "OpenRouter Free Auto",
        inputPer1MUsd: 0,
        outputPer1MUsd: 0,
        capabilities: ["fast", "coding", "tools"],
        tierRank: "lite",
      },
    ],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    defaultBaseUrl: "https://api.x.ai/v1",
    supportsServerKey: false,
    models: [
      {
        id: "grok-4.7",
        label: "Grok 4.7 (Flagship)",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 6.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "grok-4.6",
        label: "Grok 4.6",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 6.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "grok-4.20",
        label: "Grok 4.20 (1M Context)",
        inputPer1MUsd: 1.25,
        outputPer1MUsd: 2.5,
        capabilities: ["fast", "coding", "reasoning", "tools"],
        tierRank: "balanced",
      },
      {
        id: "grok-3-mini",
        label: "Grok 3 Mini (Fast)",
        inputPer1MUsd: 0.3,
        outputPer1MUsd: 0.5,
        capabilities: ["fast", "reasoning", "tools"],
        tierRank: "lite",
      },
    ],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    supportsServerKey: false,
    models: [
      {
        id: "qwen-3.8-27b",
        label: "Qwen 3.8 27B (WSE Fast)",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.45,
        capabilities: ["fast", "coding", "reasoning", "tools"],
        tierRank: "balanced",
      },
      {
        id: "gpt-oss-120b",
        label: "GPT-OSS 120B (WSE)",
        inputPer1MUsd: 0.25,
        outputPer1MUsd: 0.69,
        capabilities: ["fast", "coding", "reasoning", "tools"],
        tierRank: "flagship",
      },
      {
        id: "llama-3.3-70b",
        label: "Llama 3.3 70B (WSE)",
        inputPer1MUsd: 0.6,
        outputPer1MUsd: 0.9,
        capabilities: ["fast", "coding", "tools"],
        tierRank: "balanced",
      },
    ],
  },
  {
    id: "together",
    label: "Together AI",
    defaultBaseUrl: "https://api.together.xyz/v1",
    supportsServerKey: false,
    models: [
      {
        id: "deepseek-ai/DeepSeek-V4",
        label: "DeepSeek V4 (Together)",
        inputPer1MUsd: 0.55,
        outputPer1MUsd: 2.19,
        capabilities: ["coding", "reasoning", "tools"],
        tierRank: "flagship",
      },
      {
        id: "Qwen/Qwen3.8-27B-Instruct",
        label: "Qwen 3.8 27B Instruct",
        inputPer1MUsd: 0.2,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "coding", "reasoning", "tools"],
        tierRank: "balanced",
      },
      {
        id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        label: "Llama 4 Maverick 17B",
        inputPer1MUsd: 0.27,
        outputPer1MUsd: 0.85,
        capabilities: ["fast", "vision", "coding", "tools"],
        tierRank: "balanced",
      },
    ],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    supportsServerKey: false,
    models: [
      {
        id: "accounts/fireworks/models/deepseek-v4-pro",
        label: "DeepSeek V4 Pro (Fireworks)",
        inputPer1MUsd: 0.55,
        outputPer1MUsd: 2.19,
        capabilities: ["coding", "reasoning", "tools"],
        tierRank: "flagship",
      },
      {
        id: "accounts/fireworks/models/kimi-k3-instruct",
        label: "Kimi K3 Instruct",
        inputPer1MUsd: 0.6,
        outputPer1MUsd: 2.4,
        capabilities: ["coding", "reasoning", "tools"],
        tierRank: "flagship",
      },
      {
        id: "accounts/fireworks/models/llama4-maverick-instruct-basic",
        label: "Llama 4 Maverick",
        inputPer1MUsd: 0.22,
        outputPer1MUsd: 0.88,
        capabilities: ["fast", "vision", "coding", "tools"],
        tierRank: "balanced",
      },
    ],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
    supportsServerKey: false,
    models: [
      {
        id: "sonar",
        label: "Perplexity Sonar (Web Search)",
        inputPer1MUsd: 1.0,
        outputPer1MUsd: 1.0,
        capabilities: ["fast", "reasoning"],
        tierRank: "balanced",
      },
      {
        id: "sonar-pro",
        label: "Perplexity Sonar Pro",
        inputPer1MUsd: 3.0,
        outputPer1MUsd: 15.0,
        capabilities: ["reasoning", "coding"],
        tierRank: "flagship",
      },
      {
        id: "sonar-reasoning-pro",
        label: "Perplexity Sonar Reasoning Pro",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 8.0,
        capabilities: ["reasoning", "coding"],
        tierRank: "flagship",
      },
    ],
  },
  {
    id: "custom",
    label: "Custom OpenAI-Compatible",
    defaultBaseUrl: "https://api.example.com/v1",
    supportsServerKey: false,
    models: [
      {
        id: "custom-model",
        label: "Custom Upstream Model",
        inputPer1MUsd: 0.5,
        outputPer1MUsd: 1.5,
        capabilities: ["fast", "coding", "tools"],
        tierRank: "balanced",
      },
    ],
  },
];

export type ProviderPresetCategory =
  | "popular"
  | "inference"
  | "cloud"
  | "regional"
  | "aggregators";

export type ProviderFreeTier = "free-tier" | "free-credits";

export const PROVIDER_PRESET_CATEGORIES: Array<{
  id: "all" | "connected" | "free" | ProviderPresetCategory;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "connected", label: "Connected" },
  { id: "free", label: "Free Tier / Tokens" },
  { id: "popular", label: "Popular" },
  { id: "inference", label: "Fast Inference" },
  { id: "cloud", label: "Cloud & Enterprise" },
  { id: "regional", label: "Regional / CN" },
  { id: "aggregators", label: "Aggregators" },
];

export interface ReadyMadeProviderPreset {
  key: string;
  id: ProviderId;
  category: ProviderPresetCategory;
  label: string;
  tagline: string;
  defaultBaseUrl: string;
  defaultModel: string;
  badge: string;
  keyPlaceholder: string;
  freeTier?: ProviderFreeTier;
  freeTierNote?: string;
}

export const READY_MADE_PROVIDER_PRESETS: ReadyMadeProviderPreset[] = [
  // Core 5 (already added)
  {
    key: "openai",
    id: "openai",
    category: "popular",
    label: "OpenAI",
    tagline: "GPT-4.1, GPT-5.4 & o-series models",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    badge: "OA",
    keyPlaceholder: "sk-proj-...",
  },
  {
    key: "anthropic",
    id: "anthropic",
    category: "popular",
    label: "Anthropic",
    tagline: "Claude Sonnet, Opus & Haiku",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5-5",
    badge: "AN",
    keyPlaceholder: "sk-ant-...",
  },
  {
    key: "gemini",
    id: "gemini",
    category: "popular",
    label: "Google Gemini",
    tagline: "Gemini Flash, Pro & Hydrogen",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-4-hydrogen",
    badge: "GM",
    keyPlaceholder: "AIza...",
    freeTier: "free-tier",
    freeTierNote: "Free RPM/RPD on AI Studio",
  },
  {
    key: "groq",
    id: "groq",
    category: "popular",
    label: "Groq",
    tagline: "Ultra-fast LPU Llama & Qwen inference",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    badge: "GQ",
    keyPlaceholder: "gsk_...",
    freeTier: "free-tier",
    freeTierNote: "Free rate-limited tier",
  },
  {
    key: "openrouter",
    id: "openrouter",
    category: "popular",
    label: "OpenRouter",
    tagline: "Unified multi-model & free tier gateway",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
    badge: "OR",
    keyPlaceholder: "sk-or-v1-...",
    freeTier: "free-tier",
    freeTierNote: "Free :free models",
  },
  // Added from user's provider URLs (deduplicated)
  {
    key: "xai",
    id: "xai",
    category: "popular",
    label: "xAI (Grok)",
    tagline: "Grok reasoning & 1M context models",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.20",
    badge: "XA",
    keyPlaceholder: "xai-...",
  },
  {
    key: "deepseek",
    id: "deepseek",
    category: "popular",
    label: "DeepSeek",
    tagline: "DeepSeek Flash & V4 reasoning models",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    badge: "DS",
    keyPlaceholder: "sk-...",
    freeTier: "free-credits",
    freeTierNote: "Starter balance on sign-up",
  },
  {
    key: "cerebras",
    id: "cerebras",
    category: "inference",
    label: "Cerebras",
    tagline: "Wafer-scale high-speed inference",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    badge: "CB",
    keyPlaceholder: "csk-...",
    freeTier: "free-tier",
    freeTierNote: "Free daily token tier",
  },
  {
    key: "mistral",
    id: "mistral",
    category: "popular",
    label: "Mistral AI",
    tagline: "Mistral Large, Medium & Small models",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    badge: "MS",
    keyPlaceholder: "Paste Mistral API key...",
    freeTier: "free-tier",
    freeTierNote: "Experiment free tier",
  },
  {
    key: "together",
    id: "together",
    category: "inference",
    label: "Together AI",
    tagline: "Open-weights Llama, Qwen & DeepSeek",
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    badge: "TG",
    keyPlaceholder: "Paste Together API key...",
    freeTier: "free-credits",
    freeTierNote: "Starter credits on sign-up",
  },
  {
    key: "fireworks",
    id: "fireworks",
    category: "inference",
    label: "Fireworks AI",
    tagline: "Low-latency serverless open models",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    badge: "FW",
    keyPlaceholder: "fw_...",
    freeTier: "free-credits",
    freeTierNote: "$1 starter trial credits",
  },
  {
    key: "perplexity",
    id: "perplexity",
    category: "popular",
    label: "Perplexity",
    tagline: "Sonar web-grounded search models",
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar",
    badge: "PX",
    keyPlaceholder: "pplx-...",
  },
  {
    key: "sambanova",
    id: "custom",
    category: "inference",
    label: "SambaNova",
    tagline: "Fast RDU open-model inference",
    defaultBaseUrl: "https://api.sambanova.ai/v1",
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    badge: "SN",
    keyPlaceholder: "Paste SambaNova API key...",
    freeTier: "free-tier",
    freeTierNote: "Free developer tier",
  },
  {
    key: "cohere",
    id: "custom",
    category: "cloud",
    label: "Cohere",
    tagline: "Command R & Command A compatibility API",
    defaultBaseUrl: "https://api.cohere.ai/compatibility/v1",
    defaultModel: "command-a-03-2025",
    badge: "CH",
    keyPlaceholder: "Paste Cohere API key...",
    freeTier: "free-tier",
    freeTierNote: "Trial rate-limited key",
  },
  {
    key: "huggingface",
    id: "custom",
    category: "cloud",
    label: "Hugging Face",
    tagline: "Serverless Inference Providers API",
    defaultBaseUrl: "https://api-inference.huggingface.co/v1",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    badge: "HF",
    keyPlaceholder: "hf_...",
    freeTier: "free-tier",
    freeTierNote: "Free monthly serverless quota",
  },
  {
    key: "cloudflare",
    id: "custom",
    category: "cloud",
    label: "Cloudflare Workers AI",
    tagline: "Edge inference (replace {account_id})",
    defaultBaseUrl:
      "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    badge: "CF",
    keyPlaceholder: "Paste Cloudflare API token...",
    freeTier: "free-tier",
    freeTierNote: "10,000 Neurons/day free",
  },
  {
    key: "azure-github",
    id: "custom",
    category: "cloud",
    label: "Azure / GitHub Models",
    tagline: "Azure AI Model Inference endpoint",
    defaultBaseUrl: "https://models.inference.ai.azure.com",
    defaultModel: "gpt-4o-mini",
    badge: "AZ",
    keyPlaceholder: "ghp_... or Azure key",
    freeTier: "free-tier",
    freeTierNote: "Free GitHub Models dev tier",
  },
  {
    key: "nvidia",
    id: "custom",
    category: "cloud",
    label: "NVIDIA NIM",
    tagline: "NVIDIA Build & NIM hosted models",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.3-70b-instruct",
    badge: "NV",
    keyPlaceholder: "nvapi-...",
    freeTier: "free-tier",
    freeTierNote: "Free NIM developer credits",
  },
  {
    key: "deepinfra",
    id: "custom",
    category: "inference",
    label: "DeepInfra",
    tagline: "Cost-effective open model hosting",
    defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    badge: "DI",
    keyPlaceholder: "Paste DeepInfra API key...",
    freeTier: "free-credits",
    freeTierNote: "Free trial credits",
  },
  {
    key: "glhf",
    id: "custom",
    category: "aggregators",
    label: "GLHF.chat",
    tagline: "Open-source model proxy API",
    defaultBaseUrl: "https://glhf.chat/api/openai/v1",
    defaultModel: "hf:meta-llama/Llama-3.3-70B-Instruct",
    badge: "GL",
    keyPlaceholder: "glhf_...",
    freeTier: "free-tier",
    freeTierNote: "Free open-model quota",
  },
  {
    key: "hyperbolic",
    id: "custom",
    category: "inference",
    label: "Hyperbolic",
    tagline: "Decentralized GPU open-model inference",
    defaultBaseUrl: "https://api.hyperbolic.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    badge: "HB",
    keyPlaceholder: "Paste Hyperbolic API key...",
    freeTier: "free-credits",
    freeTierNote: "Free trial credits",
  },
  {
    key: "novita",
    id: "custom",
    category: "inference",
    label: "Novita AI",
    tagline: "Serverless LLM & multimodal endpoints",
    defaultBaseUrl: "https://api.novita.ai/v3/openai",
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    badge: "NV",
    keyPlaceholder: "Paste Novita API key...",
    freeTier: "free-credits",
    freeTierNote: "Free starter credits",
  },
  {
    key: "siliconflow",
    id: "custom",
    category: "inference",
    label: "SiliconFlow",
    tagline: "Qwen, DeepSeek & open-weights cloud",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    badge: "SF",
    keyPlaceholder: "sk-...",
    freeTier: "free-tier",
    freeTierNote: "Free models + trial tokens",
  },
  {
    key: "nebius",
    id: "custom",
    category: "cloud",
    label: "Nebius AI Studio",
    tagline: "High-throughput European AI cloud",
    defaultBaseUrl: "https://api.studio.nebius.ai/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    badge: "NB",
    keyPlaceholder: "Paste Nebius API key...",
    freeTier: "free-credits",
    freeTierNote: "Free sign-up credits",
  },
  {
    key: "scaleway",
    id: "custom",
    category: "cloud",
    label: "Scaleway",
    tagline: "European sovereign Generative APIs",
    defaultBaseUrl: "https://api.scaleway.ai/v1",
    defaultModel: "llama-3.3-70b-instruct",
    badge: "SW",
    keyPlaceholder: "Paste Scaleway API key...",
    freeTier: "free-credits",
    freeTierNote: "Free starter tokens",
  },
  {
    key: "ovhcloud",
    id: "custom",
    category: "cloud",
    label: "OVHcloud AI",
    tagline: "OVHcloud Kepler AI endpoints",
    defaultBaseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    defaultModel: "Meta-Llama-3_3-70B-Instruct",
    badge: "OV",
    keyPlaceholder: "Paste OVHcloud token...",
    freeTier: "free-tier",
    freeTierNote: "Free beta AI endpoints",
  },
  {
    key: "upstage",
    id: "custom",
    category: "cloud",
    label: "Upstage Solar",
    tagline: "Solar Pro & Mini enterprise models",
    defaultBaseUrl: "https://api.upstage.ai/v1/solar",
    defaultModel: "solar-pro",
    badge: "UP",
    keyPlaceholder: "up_...",
    freeTier: "free-credits",
    freeTierNote: "$10 starter credits",
  },
  {
    key: "ai21",
    id: "custom",
    category: "cloud",
    label: "AI21 Labs",
    tagline: "Jamba long-context SSM models",
    defaultBaseUrl: "https://api.ai21.com/studio/v1",
    defaultModel: "jamba-large-1.6",
    badge: "A2",
    keyPlaceholder: "Paste AI21 API key...",
    freeTier: "free-credits",
    freeTierNote: "Free trial credits",
  },
  {
    key: "replicate",
    id: "custom",
    category: "inference",
    label: "Replicate",
    tagline: "Replicate OpenAI-compatible proxy",
    defaultBaseUrl: "https://openai-proxy.replicate.com/v1",
    defaultModel: "meta/meta-llama-3.1-405b-instruct",
    badge: "RP",
    keyPlaceholder: "r8_...",
  },
  {
    key: "anyscale",
    id: "custom",
    category: "inference",
    label: "Anyscale",
    tagline: "Ray-powered LLM endpoints",
    defaultBaseUrl: "https://api.endpoints.anyscale.com/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    badge: "AS",
    keyPlaceholder: "esecret_...",
  },
  {
    key: "lepton",
    id: "custom",
    category: "inference",
    label: "Lepton AI",
    tagline: "Lepton Llama inference endpoint",
    defaultBaseUrl: "https://llama3-70b.lepton.run/api/v1",
    defaultModel: "llama3-70b",
    badge: "LP",
    keyPlaceholder: "Paste Lepton API token...",
  },
  {
    key: "friendli",
    id: "custom",
    category: "inference",
    label: "FriendliAI",
    tagline: "Low-latency serverless GPU inference",
    defaultBaseUrl: "https://inference.friendli.ai/v1",
    defaultModel: "meta-llama-3.3-70b-instruct",
    badge: "FR",
    keyPlaceholder: "flp_...",
  },
  {
    key: "octoai",
    id: "custom",
    category: "inference",
    label: "OctoAI",
    tagline: "OctoStack text generation endpoints",
    defaultBaseUrl: "https://text.octoai.run/v1",
    defaultModel: "meta-llama-3.1-70b-instruct",
    badge: "OC",
    keyPlaceholder: "Paste OctoAI token...",
  },
  {
    key: "monsterapi",
    id: "custom",
    category: "inference",
    label: "MonsterAPI",
    tagline: "Distributed LLM inference API",
    defaultBaseUrl: "https://llm.monsterapi.ai/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    badge: "MA",
    keyPlaceholder: "Paste MonsterAPI key...",
  },
  {
    key: "kluster",
    id: "custom",
    category: "inference",
    label: "Kluster.ai",
    tagline: "Adaptive batch & real-time inference",
    defaultBaseUrl: "https://api.kluster.ai/v1",
    defaultModel: "klusterai/Meta-Llama-3.3-70B-Instruct-Turbo",
    badge: "KL",
    keyPlaceholder: "Paste Kluster.ai key...",
    freeTier: "free-credits",
    freeTierNote: "Starter trial credits",
  },
  {
    key: "parasail",
    id: "custom",
    category: "inference",
    label: "Parasail",
    tagline: "Batch & online open-model inference",
    defaultBaseUrl: "https://api.parasail.io/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    badge: "PS",
    keyPlaceholder: "Paste Parasail API key...",
    freeTier: "free-credits",
    freeTierNote: "Free starter credits",
  },
  {
    key: "featherless",
    id: "custom",
    category: "inference",
    label: "Featherless AI",
    tagline: "Thousands of Hugging Face models serverless",
    defaultBaseUrl: "https://api.featherless.ai/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    badge: "FL",
    keyPlaceholder: "rc_...",
    freeTier: "free-credits",
    freeTierNote: "Trial token quota",
  },
  {
    key: "dashscope",
    id: "custom",
    category: "regional",
    label: "Alibaba DashScope (Qwen)",
    tagline: "Qwen Max, Plus & Coder Intl API",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    badge: "QW",
    keyPlaceholder: "sk-...",
    freeTier: "free-credits",
    freeTierNote: "Free starter token quota",
  },
  {
    key: "zhipu",
    id: "custom",
    category: "regional",
    label: "Zhipu AI (BigModel)",
    tagline: "GLM-4 & GLM-Zero models",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    badge: "ZP",
    keyPlaceholder: "Paste Zhipu API key...",
    freeTier: "free-tier",
    freeTierNote: "GLM-4-Flash free tier",
  },
  {
    key: "moonshot",
    id: "custom",
    category: "regional",
    label: "Moonshot AI (Kimi)",
    tagline: "Kimi long-context models",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-auto",
    badge: "KM",
    keyPlaceholder: "sk-...",
    freeTier: "free-credits",
    freeTierNote: "Free starter credits",
  },
  {
    key: "lingyi",
    id: "custom",
    category: "regional",
    label: "01.AI (Yi)",
    tagline: "Yi Lightning & Large models",
    defaultBaseUrl: "https://api.lingyiwanwu.com/v1",
    defaultModel: "yi-lightning",
    badge: "YI",
    keyPlaceholder: "Paste 01.AI API key...",
    freeTier: "free-credits",
    freeTierNote: "Starter trial credits",
  },
  {
    key: "volcengine",
    id: "custom",
    category: "regional",
    label: "Volcengine Ark (Doubao)",
    tagline: "ByteDance Ark / Doubao models",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
    badge: "VA",
    keyPlaceholder: "Paste Ark API key...",
    freeTier: "free-credits",
    freeTierNote: "500K free tokens/model",
  },
  {
    key: "qianfan",
    id: "custom",
    category: "regional",
    label: "Baidu Qianfan",
    tagline: "ERNIE v2 OpenAI-compatible API",
    defaultBaseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-turbo-8k",
    badge: "QF",
    keyPlaceholder: "bce-v3/...",
    freeTier: "free-tier",
    freeTierNote: "Free ERNIE Lite/Speed",
  },
  {
    key: "stepfun",
    id: "custom",
    category: "regional",
    label: "StepFun",
    tagline: "Step multimodal & reasoning models",
    defaultBaseUrl: "https://api.stepfun.com/v1",
    defaultModel: "step-2-16k",
    badge: "ST",
    keyPlaceholder: "Paste StepFun API key...",
    freeTier: "free-credits",
    freeTierNote: "Free trial quota",
  },
  {
    key: "minimax",
    id: "custom",
    category: "regional",
    label: "MiniMax",
    tagline: "MiniMax abab & text-01 models",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    badge: "MM",
    keyPlaceholder: "Paste MiniMax API key...",
    freeTier: "free-credits",
    freeTierNote: "Free trial credits",
  },
  {
    key: "baichuan",
    id: "custom",
    category: "regional",
    label: "Baichuan AI",
    tagline: "Baichuan4 & Turbo models",
    defaultBaseUrl: "https://api.baichuan-ai.com/v1",
    defaultModel: "Baichuan4",
    badge: "BC",
    keyPlaceholder: "sk-...",
    freeTier: "free-credits",
    freeTierNote: "Free trial tokens",
  },
  {
    key: "requesty",
    id: "custom",
    category: "aggregators",
    label: "Requesty",
    tagline: "Unified multi-provider LLM router",
    defaultBaseUrl: "https://router.requesty.ai/v1",
    defaultModel: "openai/gpt-4o-mini",
    badge: "RQ",
    keyPlaceholder: "rqsty-...",
    freeTier: "free-credits",
    freeTierNote: "Starter trial credits",
  },
  {
    key: "aimlapi",
    id: "custom",
    category: "aggregators",
    label: "AI/ML API",
    tagline: "200+ AI models via single endpoint",
    defaultBaseUrl: "https://api.aimlapi.com/v1",
    defaultModel: "gpt-4o-mini",
    badge: "AM",
    keyPlaceholder: "Paste AI/ML API key...",
    freeTier: "free-credits",
    freeTierNote: "Free trial tokens",
  },
  {
    key: "edenai",
    id: "custom",
    category: "aggregators",
    label: "Eden AI",
    tagline: "Unified multi-vendor LLM gateway",
    defaultBaseUrl: "https://api.edenai.run/v2/llm",
    defaultModel: "openai/gpt-4o-mini",
    badge: "ED",
    keyPlaceholder: "Paste Eden AI key...",
    freeTier: "free-credits",
    freeTierNote: "Free starter credits",
  },
  {
    key: "totalgpt",
    id: "custom",
    category: "aggregators",
    label: "TotalGPT",
    tagline: "Infermatic / TotalGPT hosted models",
    defaultBaseUrl: "https://api.totalgpt.ai/v1",
    defaultModel: "deepseek-r1",
    badge: "TG",
    keyPlaceholder: "Paste TotalGPT API key...",
    freeTier: "free-credits",
    freeTierNote: "Trial credits",
  },
  {
    key: "shuttleai",
    id: "custom",
    category: "aggregators",
    label: "ShuttleAI",
    tagline: "Unified chat completions proxy",
    defaultBaseUrl: "https://api.shuttleai.app/v1",
    defaultModel: "shuttle-2.5",
    badge: "SH",
    keyPlaceholder: "shuttle-...",
    freeTier: "free-tier",
    freeTierNote: "Free tier models",
  },
  {
    key: "arliai",
    id: "custom",
    category: "aggregators",
    label: "ArliAI",
    tagline: "Uncensored & roleplay LLM hosting",
    defaultBaseUrl: "https://api.arliai.com/v1",
    defaultModel: "Mistral-Nemo-12B-Instruct-2407",
    badge: "AR",
    keyPlaceholder: "Paste ArliAI API key...",
    freeTier: "free-tier",
    freeTierNote: "Free rate-limited tier",
  },
  // Additional remote OmniRoute-style & community presets
  {
    key: "dahl",
    id: "custom",
    category: "inference",
    label: "Dahl Inference",
    tagline: "Decentralized Gonka-backed frontier API",
    defaultBaseUrl: "https://inference.dahl.global/v1",
    defaultModel: "zai-org/GLM-5.3-Flash",
    badge: "DH",
    keyPlaceholder: "Paste Dahl Inference API key...",
    freeTier: "free-credits",
    freeTierNote: "100M free welcome tokens",
  },
  {
    key: "chutes",
    id: "custom",
    category: "inference",
    label: "Chutes.ai",
    tagline: "Decentralized DeepSeek, Qwen & Llama API",
    defaultBaseUrl: "https://llm.chutes.ai/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3-0324",
    badge: "CT",
    keyPlaceholder: "cpk_...",
    freeTier: "free-tier",
    freeTierNote: "Free open-model quota",
  },
  {
    key: "codestral",
    id: "custom",
    category: "inference",
    label: "Mistral Codestral",
    tagline: "Dedicated Mistral coding & FIM endpoint",
    defaultBaseUrl: "https://codestral.mistral.ai/v1",
    defaultModel: "codestral-latest",
    badge: "CD",
    keyPlaceholder: "Paste Codestral API key...",
    freeTier: "free-tier",
    freeTierNote: "Free Codestral coding tier",
  },
  {
    key: "baseten",
    id: "custom",
    category: "inference",
    label: "Baseten",
    tagline: "High-throughput serverless model APIs",
    defaultBaseUrl: "https://inference.baseten.co/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3-0324",
    badge: "BT",
    keyPlaceholder: "Paste Baseten API key...",
    freeTier: "free-credits",
    freeTierNote: "Free starter credits",
  },
  {
    key: "targon",
    id: "custom",
    category: "inference",
    label: "Targon (Manifold)",
    tagline: "Fast serverless open-weight inference",
    defaultBaseUrl: "https://api.targon.com/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    badge: "TR",
    keyPlaceholder: "Paste Targon API key...",
    freeTier: "free-credits",
    freeTierNote: "Free starter credits",
  },
  {
    key: "venice",
    id: "custom",
    category: "inference",
    label: "Venice AI",
    tagline: "Privacy-first uncensored OpenAI API",
    defaultBaseUrl: "https://api.venice.ai/api/v1",
    defaultModel: "llama-3.3-70b",
    badge: "VN",
    keyPlaceholder: "Paste Venice API key...",
    freeTier: "free-credits",
    freeTierNote: "Free API trial credits",
  },
  {
    key: "ollama-cloud",
    id: "custom",
    category: "cloud",
    label: "Ollama Cloud",
    tagline: "Hosted cloud open-weight models",
    defaultBaseUrl: "https://ollama.com/v1",
    defaultModel: "llama3.3",
    badge: "OL",
    keyPlaceholder: "Paste Ollama Cloud key...",
    freeTier: "free-tier",
    freeTierNote: "Free cloud open-model tier",
  },
  {
    key: "lambda",
    id: "custom",
    category: "cloud",
    label: "Lambda AI Inference",
    tagline: "Lambda GPU serverless OpenAI endpoint",
    defaultBaseUrl: "https://api.lambda.ai/v1",
    defaultModel: "llama-4-maverick-17b-128e-instruct-fp8",
    badge: "LM",
    keyPlaceholder: "secret_...",
    freeTier: "free-credits",
    freeTierNote: "Starter API credits",
  },
  {
    key: "zai",
    id: "custom",
    category: "regional",
    label: "Z.AI (GLM Global)",
    tagline: "International GLM-4.5 & Flash endpoint",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-4.5-flash",
    badge: "ZA",
    keyPlaceholder: "Paste Z.AI API key...",
    freeTier: "free-tier",
    freeTierNote: "GLM-4.5-Flash free tier",
  },
  {
    key: "longcat",
    id: "custom",
    category: "regional",
    label: "LongCat AI",
    tagline: "LongCat Flash & Thinking fast API",
    defaultBaseUrl: "https://api.longcat.chat/openai/v1",
    defaultModel: "LongCat-Flash-Chat",
    badge: "LC",
    keyPlaceholder: "Paste LongCat API key...",
    freeTier: "free-tier",
    freeTierNote: "Free daily token quota",
  },
  {
    key: "sarvam",
    id: "custom",
    category: "regional",
    label: "Sarvam AI",
    tagline: "Multilingual & South Asian LLM endpoints",
    defaultBaseUrl: "https://api.sarvam.ai/v1",
    defaultModel: "sarvam-m",
    badge: "SV",
    keyPlaceholder: "Paste Sarvam API key...",
    freeTier: "free-credits",
    freeTierNote: "Free starter credits",
  },
  {
    key: "vercel",
    id: "custom",
    category: "aggregators",
    label: "Vercel AI Gateway",
    tagline: "Multi-provider gateway with unified billing",
    defaultBaseUrl: "https://ai-gateway.vercel.sh/v1",
    defaultModel: "openai/gpt-4o-mini",
    badge: "VC",
    keyPlaceholder: "vck_...",
    freeTier: "free-credits",
    freeTierNote: "Free starter gateway credits",
  },
  {
    key: "kilo",
    id: "custom",
    category: "aggregators",
    label: "Kilo Gateway",
    tagline: "Coding-first multi-provider router",
    defaultBaseUrl: "https://api.kilo.ai/api/gateway/v1",
    defaultModel: "kilo/auto",
    badge: "KG",
    keyPlaceholder: "Paste Kilo Gateway key...",
    freeTier: "free-tier",
    freeTierNote: "Free coding models included",
  },
  {
    key: "pollinations",
    id: "custom",
    category: "aggregators",
    label: "Pollinations AI",
    tagline: "Community OpenAI-compatible inference",
    defaultBaseUrl: "https://text.pollinations.ai/openai",
    defaultModel: "openai",
    badge: "PL",
    keyPlaceholder: "Paste Pollinations token...",
    freeTier: "free-tier",
    freeTierNote: "Free community API tier",
  },
  {
    key: "nanogpt",
    id: "custom",
    category: "aggregators",
    label: "NanoGPT",
    tagline: "Pay-per-prompt & free model aggregator",
    defaultBaseUrl: "https://nano-gpt.com/api/v1",
    defaultModel: "deepseek-chat",
    badge: "NG",
    keyPlaceholder: "Paste NanoGPT API key...",
    freeTier: "free-tier",
    freeTierNote: "Free & pay-per-prompt models",
  },
  {
    key: "poe",
    id: "custom",
    category: "aggregators",
    label: "Poe API",
    tagline: "Single key for Claude, GPT, Gemini & Grok",
    defaultBaseUrl: "https://api.poe.com/v1",
    defaultModel: "Claude-Sonnet-4",
    badge: "PO",
    keyPlaceholder: "Paste Poe API key...",
  },
  {
    key: "synthetic",
    id: "custom",
    category: "aggregators",
    label: "Synthetic",
    tagline: "Privacy-first open-weight model router",
    defaultBaseUrl: "https://api.synthetic.new/openai/v1",
    defaultModel: "hf:deepseek-ai/DeepSeek-V3-0324",
    badge: "SY",
    keyPlaceholder: "syn_...",
  },
];

export type ComboPresetId =
  | "smart-auto"
  | "free-pool"
  | "fast-chat"
  | "coding-pro"
  | "deep-reasoning"
  | "budget-saver";

export interface ReadyMadeComboPreset {
  id: ComboPresetId;
  name: string;
  title: string;
  description: string;
  strategy: RoutingStrategy;
  compressPrompt: boolean;
  freeOnly: boolean;
  enableCache: boolean;
  badge: string;
}

export const READY_MADE_COMBO_PRESETS: ReadyMadeComboPreset[] = [
  {
    id: "smart-auto",
    name: "smart-auto",
    title: "Smart Intent Auto",
    description:
      "Detects coding, reasoning, vision, tools, or fast chat and routes to your best matching model.",
    strategy: "intent_auto",
    compressPrompt: true,
    freeOnly: false,
    enableCache: true,
    badge: "AUTO",
  },
  {
    id: "free-pool",
    name: "free-pool",
    title: "Free-Only Failover",
    description:
      "Chains verified $0 / free-tier models across connected providers ordered by lowest latency.",
    strategy: "priority",
    compressPrompt: true,
    freeOnly: true,
    enableCache: true,
    badge: "FREE",
  },
  {
    id: "fast-chat",
    name: "fast-chat",
    title: "Ultra-Fast Chat",
    description:
      "Prioritizes high-speed LPU/lite models (Groq, Cerebras, SambaNova, Flash, Mini) with instant failover.",
    strategy: "priority",
    compressPrompt: false,
    freeOnly: false,
    enableCache: true,
    badge: "FAST",
  },
  {
    id: "coding-pro",
    name: "coding-pro",
    title: "Coding & Agentic Pro",
    description:
      "Optimized for code generation and tool calling (Claude, GPT, DeepSeek, Qwen, Gemini Pro, Grok).",
    strategy: "intent_auto",
    compressPrompt: true,
    freeOnly: false,
    enableCache: false,
    badge: "CODE",
  },
  {
    id: "deep-reasoning",
    name: "deep-reasoning",
    title: "Deep Reasoning",
    description:
      "Routes complex analysis and math prompts to reasoning models (o3/o4, R1, Argon, Opus, QwQ) first.",
    strategy: "priority",
    compressPrompt: true,
    freeOnly: false,
    enableCache: false,
    badge: "THINK",
  },
  {
    id: "budget-saver",
    name: "budget-saver",
    title: "Budget Saver",
    description:
      "Always selects the lowest-cost model first and falls back upward only when rate-limited.",
    strategy: "cost_optimized",
    compressPrompt: true,
    freeOnly: false,
    enableCache: true,
    badge: "SAVE",
  },
];

export const ROUTING_STRATEGIES: Array<{
  id: RoutingStrategy;
  label: string;
  description: string;
}> = [
  {
    id: "priority",
    label: "Priority (Fill-First)",
    description:
      "Routes sequentially by tier priority and automatically fails over on 429 or 5xx.",
  },
  {
    id: "intent_auto",
    label: "Intent-Based Smart Auto",
    description:
      "Detects prompt intent (vision, tools, coding, reasoning, fast chat) and selects the best-matched tier first.",
  },
  {
    id: "round_robin",
    label: "Round Robin",
    description:
      "Distributes requests evenly across healthy tiers with automatic fallback.",
  },
  {
    id: "weighted",
    label: "Weighted Split",
    description:
      "Probabilistically balances traffic proportional to each tier weight.",
  },
  {
    id: "least_used",
    label: "Least Used",
    description:
      "Prioritizes tiers and connections with the lowest current request and token load.",
  },
  {
    id: "cost_optimized",
    label: "Cost Optimized",
    description:
      "Selects the lowest-cost eligible model first before falling back to higher tiers.",
  },
];

export function getProviderSpec(providerId: string): ProviderSpec {
  return (
    PROVIDER_CATALOG.find((p) => p.id === providerId) ||
    PROVIDER_CATALOG[PROVIDER_CATALOG.length - 1]
  );
}

export function getModelSpec(providerId: string, modelId: string): ModelSpec | undefined {
  const spec = getProviderSpec(providerId);
  return spec.models.find((m) => m.id === modelId);
}

const KNOWN_FREE_GEMINI_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-4-hydrogen",
]);

export function isModelKnownFree(providerId: string, modelId: string): boolean {
  const id = (modelId || "").trim().toLowerCase();
  if (!id) return false;
  if (/(^|[:/._-])free([:/._-]|$)/i.test(id)) return true;
  const spec = getModelSpec(providerId, id);
  if (spec && spec.inputPer1MUsd === 0 && spec.outputPer1MUsd === 0) return true;
  if (providerId === "gemini") {
    if (KNOWN_FREE_GEMINI_MODELS.has(id)) return true;
    if (/^gemma-|^gemini-.*flash-lite/i.test(id)) return true;
  }
  return false;
}

export function estimateModelCostUsd(
  providerId: string,
  modelId: string,
  promptTokens: number,
  completionTokens: number
): number {
  if (isModelKnownFree(providerId, modelId)) return 0;
  const model = getModelSpec(providerId, modelId);
  const inRate = model ? model.inputPer1MUsd : 0.5;
  const outRate = model ? model.outputPer1MUsd : 1.5;
  return (
    (promptTokens / 1_000_000) * inRate +
    (completionTokens / 1_000_000) * outRate
  );
}

export function getModelUnitCost(providerId: string, modelId: string): number {
  if (isModelKnownFree(providerId, modelId)) return 0;
  const model = getModelSpec(providerId, modelId);
  if (!model) return 2.0;
  return model.inputPer1MUsd + model.outputPer1MUsd;
}

export function normalizeEndpointUrl(url: string | null | undefined): string {
  return (url || "").trim().replace(/\/+$/, "").toLowerCase();
}

function baseUrlMatchesTemplate(
  connBaseUrl: string | null | undefined,
  templateUrl: string
): boolean {
  const connNorm = normalizeEndpointUrl(connBaseUrl);
  const templateNorm = normalizeEndpointUrl(templateUrl);
  if (!connNorm || !templateNorm) return false;
  if (connNorm === templateNorm) return true;
  if (!templateNorm.includes("{")) return false;
  const escaped = templateNorm
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`, "i").test(connNorm);
}

export function matchPresetForConnection(conn: {
  provider: string;
  name?: string | null;
  baseUrl?: string | null;
}): ReadyMadeProviderPreset | undefined {
  if (conn.provider !== "custom") {
    return READY_MADE_PROVIDER_PRESETS.find((p) => p.id === conn.provider);
  }
  const byBase = READY_MADE_PROVIDER_PRESETS.find(
    (p) => p.id === "custom" && baseUrlMatchesTemplate(conn.baseUrl, p.defaultBaseUrl)
  );
  if (byBase) return byBase;

  const connName = (conn.name || "").trim().toLowerCase();
  if (!connName) return undefined;
  return READY_MADE_PROVIDER_PRESETS.find((p) => {
    if (p.id !== "custom") return false;
    const labelLower = p.label.toLowerCase();
    return (
      connName === labelLower ||
      connName.startsWith(`${labelLower} #`) ||
      connName === p.key.toLowerCase()
    );
  });
}

export function getConnectionPrefix(conn: {
  provider: string;
  name?: string | null;
  baseUrl?: string | null;
}): string {
  if (conn.provider && conn.provider !== "custom") {
    return conn.provider.toLowerCase();
  }
  const preset = matchPresetForConnection(conn);
  if (preset) return preset.key.toLowerCase();

  const slug = (conn.name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+#\d+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom";
}
