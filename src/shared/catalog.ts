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
