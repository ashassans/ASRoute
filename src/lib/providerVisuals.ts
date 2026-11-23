export interface ProviderVisualStyle {
  short: string;
  color: string;
  softBg: string;
  border: string;
}

const PROVIDER_VISUAL_MAP: Record<string, ProviderVisualStyle> = {
  gemini: {
    short: "G",
    color: "#60A5FA",
    softBg: "rgba(96, 165, 250, 0.14)",
    border: "rgba(96, 165, 250, 0.34)",
  },
  openai: {
    short: "O",
    color: "#34D399",
    softBg: "rgba(52, 211, 153, 0.14)",
    border: "rgba(52, 211, 153, 0.34)",
  },
  anthropic: {
    short: "A",
    color: "#A78BFA",
    softBg: "rgba(167, 139, 250, 0.15)",
    border: "rgba(167, 139, 250, 0.36)",
  },
  deepseek: {
    short: "D",
    color: "#38BDF8",
    softBg: "rgba(56, 189, 248, 0.14)",
    border: "rgba(56, 189, 248, 0.34)",
  },
  groq: {
    short: "Q",
    color: "#FB923C",
    softBg: "rgba(251, 146, 60, 0.15)",
    border: "rgba(251, 146, 60, 0.36)",
  },
  mistral: {
    short: "M",
    color: "#FBBF24",
    softBg: "rgba(251, 191, 36, 0.14)",
    border: "rgba(251, 191, 36, 0.34)",
  },
  openrouter: {
    short: "R",
    color: "#F472B6",
    softBg: "rgba(244, 114, 182, 0.15)",
    border: "rgba(244, 114, 182, 0.36)",
  },
  xai: {
    short: "X",
    color: "#818CF8",
    softBg: "rgba(129, 140, 248, 0.15)",
    border: "rgba(129, 140, 248, 0.35)",
  },
  cerebras: {
    short: "Cb",
    color: "#22D3EE",
    softBg: "rgba(34, 211, 238, 0.14)",
    border: "rgba(34, 211, 238, 0.34)",
  },
  together: {
    short: "T",
    color: "#C084FC",
    softBg: "rgba(192, 132, 252, 0.15)",
    border: "rgba(192, 132, 252, 0.36)",
  },
  fireworks: {
    short: "Fw",
    color: "#F97316",
    softBg: "rgba(249, 115, 22, 0.15)",
    border: "rgba(249, 115, 22, 0.36)",
  },
  perplexity: {
    short: "Px",
    color: "#2DD4BF",
    softBg: "rgba(45, 212, 191, 0.14)",
    border: "rgba(45, 212, 191, 0.34)",
  },
  nvidia: {
    short: "Nv",
    color: "#84CC16",
    softBg: "rgba(132, 204, 22, 0.15)",
    border: "rgba(132, 204, 22, 0.35)",
  },
  sambanova: {
    short: "Sn",
    color: "#FB7185",
    softBg: "rgba(251, 113, 133, 0.15)",
    border: "rgba(251, 113, 133, 0.35)",
  },
  cohere: {
    short: "Co",
    color: "#2DD4BF",
    softBg: "rgba(45, 212, 191, 0.14)",
    border: "rgba(45, 212, 191, 0.34)",
  },
  huggingface: {
    short: "Hf",
    color: "#FACC15",
    softBg: "rgba(250, 204, 21, 0.14)",
    border: "rgba(250, 204, 21, 0.34)",
  },
  tavily: {
    short: "Tv",
    color: "#38BDF8",
    softBg: "rgba(56, 189, 248, 0.15)",
    border: "rgba(56, 189, 248, 0.36)",
  },
  "brave-search": {
    short: "Br",
    color: "#FB923C",
    softBg: "rgba(251, 146, 60, 0.15)",
    border: "rgba(251, 146, 60, 0.36)",
  },
  exa: {
    short: "Ex",
    color: "#C084FC",
    softBg: "rgba(192, 132, 252, 0.15)",
    border: "rgba(192, 132, 252, 0.36)",
  },
  builtin: {
    short: "Web",
    color: "#2DD4BF",
    softBg: "rgba(45, 212, 191, 0.15)",
    border: "rgba(45, 212, 191, 0.36)",
  },
  ollama: {
    short: "Ol",
    color: "#E2E8F0",
    softBg: "rgba(226, 232, 240, 0.12)",
    border: "rgba(226, 232, 240, 0.28)",
  },
  custom: {
    short: "C",
    color: "#10B981",
    softBg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.34)",
  },
};

const FALLBACK_PALETTE: ProviderVisualStyle[] = [
  {
    short: "AI",
    color: "#818CF8",
    softBg: "rgba(129, 140, 248, 0.15)",
    border: "rgba(129, 140, 248, 0.35)",
  },
  {
    short: "AI",
    color: "#38BDF8",
    softBg: "rgba(56, 189, 248, 0.15)",
    border: "rgba(56, 189, 248, 0.35)",
  },
  {
    short: "AI",
    color: "#34D399",
    softBg: "rgba(52, 211, 153, 0.15)",
    border: "rgba(52, 211, 153, 0.35)",
  },
  {
    short: "AI",
    color: "#F472B6",
    softBg: "rgba(244, 114, 182, 0.15)",
    border: "rgba(244, 114, 182, 0.35)",
  },
  {
    short: "AI",
    color: "#FB923C",
    softBg: "rgba(251, 146, 60, 0.15)",
    border: "rgba(251, 146, 60, 0.35)",
  },
  {
    short: "AI",
    color: "#2DD4BF",
    softBg: "rgba(45, 212, 191, 0.15)",
    border: "rgba(45, 212, 191, 0.35)",
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
      color: "#34D399",
      softBg: "rgba(52, 211, 153, 0.14)",
      border: "rgba(52, 211, 153, 0.34)",
    };
  }
  if (lower.includes("cod")) {
    return {
      color: "#C084FC",
      softBg: "rgba(192, 132, 252, 0.14)",
      border: "rgba(192, 132, 252, 0.34)",
    };
  }
  if (lower.includes("vis")) {
    return {
      color: "#38BDF8",
      softBg: "rgba(56, 189, 248, 0.14)",
      border: "rgba(56, 189, 248, 0.34)",
    };
  }
  if (lower.includes("fast") || lower.includes("speed")) {
    return {
      color: "#FB923C",
      softBg: "rgba(251, 146, 60, 0.14)",
      border: "rgba(251, 146, 60, 0.34)",
    };
  }
  if (lower.includes("reason") || lower.includes("think")) {
    return {
      color: "#F472B6",
      softBg: "rgba(244, 114, 182, 0.14)",
      border: "rgba(244, 114, 182, 0.34)",
    };
  }
  return {
    color: "#818CF8",
    softBg: "rgba(129, 140, 248, 0.14)",
    border: "rgba(129, 140, 248, 0.34)",
  };
}
