export type ProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "groq"
  | "deepseek"
  | "mistral"
  | "openrouter"
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
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash (Fast)",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro (Flagship)",
        inputPer1MUsd: 1.25,
        outputPer1MUsd: 5.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        inputPer1MUsd: 0.1,
        outputPer1MUsd: 0.4,
        capabilities: ["fast", "coding", "vision", "tools"],
        tierRank: "balanced",
      },
      {
        id: "gemini-2.0-flash-lite",
        label: "Gemini 2.0 Flash Lite",
        inputPer1MUsd: 0.075,
        outputPer1MUsd: 0.3,
        capabilities: ["fast", "vision", "tools"],
        tierRank: "lite",
      },
      {
        id: "gemini-1.5-flash",
        label: "Gemini 1.5 Flash",
        inputPer1MUsd: 0.075,
        outputPer1MUsd: 0.3,
        capabilities: ["fast", "vision", "tools"],
        tierRank: "lite",
      },
      {
        id: "gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        inputPer1MUsd: 1.25,
        outputPer1MUsd: 5.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
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
        id: "gpt-4o-mini",
        label: "GPT-4o Mini",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "vision", "tools", "coding"],
        tierRank: "lite",
      },
      {
        id: "gpt-4o",
        label: "GPT-4o",
        inputPer1MUsd: 2.5,
        outputPer1MUsd: 10.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "gpt-4.5-preview",
        label: "GPT-4.5 Preview",
        inputPer1MUsd: 75.0,
        outputPer1MUsd: 150.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "o3-mini",
        label: "o3 Mini",
        inputPer1MUsd: 1.1,
        outputPer1MUsd: 4.4,
        capabilities: ["coding", "reasoning", "tools"],
        tierRank: "flagship",
      },
      {
        id: "o1",
        label: "o1",
        inputPer1MUsd: 15.0,
        outputPer1MUsd: 60.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
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
        id: "claude-3-7-sonnet-latest",
        label: "Claude 3.7 Sonnet",
        inputPer1MUsd: 3.0,
        outputPer1MUsd: 15.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "claude-3-5-sonnet-latest",
        label: "Claude 3.5 Sonnet",
        inputPer1MUsd: 3.0,
        outputPer1MUsd: 15.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
        tierRank: "flagship",
      },
      {
        id: "claude-3-5-haiku-latest",
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
        id: "deepseek-chat",
        label: "DeepSeek V3",
        inputPer1MUsd: 0.27,
        outputPer1MUsd: 1.1,
        capabilities: ["fast", "coding", "tools"],
        tierRank: "balanced",
      },
      {
        id: "deepseek-reasoner",
        label: "DeepSeek R1",
        inputPer1MUsd: 0.55,
        outputPer1MUsd: 2.19,
        capabilities: ["coding", "reasoning"],
        tierRank: "flagship",
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
        id: "mistral-small-latest",
        label: "Mistral Small",
        inputPer1MUsd: 0.1,
        outputPer1MUsd: 0.3,
        capabilities: ["fast", "tools"],
        tierRank: "lite",
      },
      {
        id: "mistral-large-latest",
        label: "Mistral Large",
        inputPer1MUsd: 2.0,
        outputPer1MUsd: 6.0,
        capabilities: ["coding", "reasoning", "tools"],
        tierRank: "flagship",
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
        id: "google/gemini-2.5-flash",
        label: "Gemini via OpenRouter",
        inputPer1MUsd: 0.15,
        outputPer1MUsd: 0.6,
        capabilities: ["fast", "vision", "tools", "coding"],
        tierRank: "balanced",
      },
      {
        id: "anthropic/claude-3.5-sonnet",
        label: "Claude 3.5 Sonnet (OR)",
        inputPer1MUsd: 3.0,
        outputPer1MUsd: 15.0,
        capabilities: ["coding", "reasoning", "vision", "tools"],
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

export function estimateModelCostUsd(
  providerId: string,
  modelId: string,
  promptTokens: number,
  completionTokens: number
): number {
  const model = getModelSpec(providerId, modelId);
  const inRate = model ? model.inputPer1MUsd : 0.5;
  const outRate = model ? model.outputPer1MUsd : 1.5;
  return (
    (promptTokens / 1_000_000) * inRate +
    (completionTokens / 1_000_000) * outRate
  );
}

export function getModelUnitCost(providerId: string, modelId: string): number {
  const model = getModelSpec(providerId, modelId);
  if (!model) return 2.0;
  return model.inputPer1MUsd + model.outputPer1MUsd;
}
