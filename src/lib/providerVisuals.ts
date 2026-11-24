export interface ProviderVisualStyle {
  short: string;
  color: string;
  softBg: string;
  border: string;
}

const PROVIDER_VISUAL_MAP: Record<string, ProviderVisualStyle> = {
  gemini: {
    short: "G",
    color: "#3B82F6",
    softBg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(59, 130, 246, 0.34)",
  },
  openai: {
    short: "O",
    color: "#10B981",
    softBg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.34)",
  },
  anthropic: {
    short: "A",
    color: "#8B5CF6",
    softBg: "rgba(139, 92, 246, 0.15)",
    border: "rgba(139, 92, 246, 0.36)",
  },
  deepseek: {
    short: "D",
    color: "#0EA5E9",
    softBg: "rgba(14, 165, 233, 0.14)",
    border: "rgba(14, 165, 233, 0.34)",
  },
  groq: {
    short: "Q",
    color: "#F97316",
    softBg: "rgba(249, 115, 22, 0.15)",
    border: "rgba(249, 115, 22, 0.36)",
  },
  mistral: {
    short: "M",
    color: "#D97706",
    softBg: "rgba(217, 119, 6, 0.14)",
    border: "rgba(217, 119, 6, 0.34)",
  },
  openrouter: {
    short: "R",
    color: "#EC4899",
    softBg: "rgba(236, 72, 153, 0.15)",
    border: "rgba(236, 72, 153, 0.36)",
  },
  xai: {
    short: "X",
    color: "#6366F1",
    softBg: "rgba(99, 102, 241, 0.15)",
    border: "rgba(99, 102, 241, 0.35)",
  },
  cerebras: {
    short: "Cb",
    color: "#06B6D4",
    softBg: "rgba(6, 182, 212, 0.14)",
    border: "rgba(6, 182, 212, 0.34)",
  },
  together: {
    short: "T",
    color: "#A855F7",
    softBg: "rgba(168, 85, 247, 0.15)",
    border: "rgba(168, 85, 247, 0.36)",
  },
  fireworks: {
    short: "Fw",
    color: "#EA580C",
    softBg: "rgba(234, 88, 12, 0.15)",
    border: "rgba(234, 88, 12, 0.36)",
  },
  perplexity: {
    short: "Px",
    color: "#0D9488",
    softBg: "rgba(13, 148, 136, 0.14)",
    border: "rgba(13, 148, 136, 0.34)",
  },
  nvidia: {
    short: "Nv",
    color: "#65A30D",
    softBg: "rgba(101, 163, 13, 0.15)",
    border: "rgba(101, 163, 13, 0.35)",
  },
  sambanova: {
    short: "Sn",
    color: "#F43F5E",
    softBg: "rgba(244, 63, 94, 0.15)",
    border: "rgba(244, 63, 94, 0.35)",
  },
  cohere: {
    short: "Co",
    color: "#0D9488",
    softBg: "rgba(13, 148, 136, 0.14)",
    border: "rgba(13, 148, 136, 0.34)",
  },
  huggingface: {
    short: "Hf",
    color: "#CA8A04",
    softBg: "rgba(202, 138, 4, 0.14)",
    border: "rgba(202, 138, 4, 0.34)",
  },
  tavily: {
    short: "Tv",
    color: "#0284C7",
    softBg: "rgba(2, 132, 199, 0.15)",
    border: "rgba(2, 132, 199, 0.36)",
  },
  "brave-search": {
    short: "Br",
    color: "#EA580C",
    softBg: "rgba(234, 88, 12, 0.15)",
    border: "rgba(234, 88, 12, 0.36)",
  },
  exa: {
    short: "Ex",
    color: "#9333EA",
    softBg: "rgba(147, 51, 234, 0.15)",
    border: "rgba(147, 51, 234, 0.36)",
  },
  builtin: {
    short: "Web",
    color: "#0D9488",
    softBg: "rgba(13, 148, 136, 0.15)",
    border: "rgba(13, 148, 136, 0.36)",
  },
  ollama: {
    short: "Ol",
    color: "#64748B",
    softBg: "rgba(100, 116, 139, 0.14)",
    border: "rgba(100, 116, 139, 0.34)",
  },
  custom: {
    short: "C",
    color: "#059669",
    softBg: "rgba(5, 150, 105, 0.14)",
    border: "rgba(5, 150, 105, 0.34)",
  },
};

const FALLBACK_PALETTE: ProviderVisualStyle[] = [
  {
    short: "AI",
    color: "#4F46E5",
    softBg: "rgba(79, 70, 229, 0.14)",
    border: "rgba(79, 70, 229, 0.34)",
  },
  {
    short: "AI",
    color: "#0284C7",
    softBg: "rgba(2, 132, 199, 0.14)",
    border: "rgba(2, 132, 199, 0.34)",
  },
  {
    short: "AI",
    color: "#059669",
    softBg: "rgba(5, 150, 105, 0.14)",
    border: "rgba(5, 150, 105, 0.34)",
  },
  {
    short: "AI",
    color: "#DB2777",
    softBg: "rgba(219, 39, 119, 0.14)",
    border: "rgba(219, 39, 119, 0.34)",
  },
  {
    short: "AI",
    color: "#EA580C",
    softBg: "rgba(234, 88, 12, 0.14)",
    border: "rgba(234, 88, 12, 0.34)",
  },
  {
    short: "AI",
    color: "#0D9488",
    softBg: "rgba(13, 148, 136, 0.14)",
    border: "rgba(13, 148, 136, 0.34)",
  },
];

export function getProviderVisual(keyOrId: string): ProviderVisualStyle {
  const normalized = (keyOrId || "custom").toLowerCase().trim();
  const direct = PROVIDER_VISUAL_MAP[normalized];
  if (direct) return direct;

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  const picked = FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
  return {
    ...picked,
    short: normalized.slice(0, 2).toUpperCase() || "AI",
  };
}

export function getComboAccent(nameOrId: string): {
  color: string;
  softBg: string;
  border: string;
} {
  const lower = (nameOrId || "").toLowerCase();
  if (lower.includes("free")) {
    return {
      color: "#059669",
      softBg: "rgba(5, 150, 105, 0.14)",
      border: "rgba(5, 150, 105, 0.34)",
    };
  }
  if (lower.includes("cod")) {
    return {
      color: "#9333EA",
      softBg: "rgba(147, 51, 234, 0.14)",
      border: "rgba(147, 51, 234, 0.34)",
    };
  }
  if (lower.includes("vis")) {
    return {
      color: "#0284C7",
      softBg: "rgba(2, 132, 199, 0.14)",
      border: "rgba(2, 132, 199, 0.34)",
    };
  }
  if (lower.includes("fast") || lower.includes("speed")) {
    return {
      color: "#EA580C",
      softBg: "rgba(234, 88, 12, 0.14)",
      border: "rgba(234, 88, 12, 0.34)",
    };
  }
  if (lower.includes("reason") || lower.includes("think")) {
    return {
      color: "#DB2777",
      softBg: "rgba(219, 39, 119, 0.14)",
      border: "rgba(219, 39, 119, 0.34)",
    };
  }
  return {
    color: "#4F46E5",
    softBg: "rgba(79, 70, 229, 0.14)",
    border: "rgba(79, 70, 229, 0.34)",
  };
}
