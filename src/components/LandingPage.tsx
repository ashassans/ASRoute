import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Layers,
  ShieldCheck,
  Terminal,
} from "lucide-react";

interface LandingPageProps {
  onOpenAuth: (mode: "signin" | "signup") => void;
  isAuthenticated?: boolean;
  onOpenDashboard?: () => void;
}

const ORBIT_PROVIDERS = [
  {
    id: "gemini",
    name: "Google Gemini",
    short: "G",
    color: "#60A5FA",
    angle: 35,
    ring: 1,
    models: ["gemini-4-hydrogen", "gemini-4-neon", "gemini-3.1-flash-lite"],
  },
  {
    id: "openai",
    name: "OpenAI",
    short: "O",
    color: "#FAFAFA",
    angle: 115,
    ring: 2,
    models: ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6-luna"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    short: "A",
    color: "#FBBF24",
    angle: 205,
    ring: 1,
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    short: "D",
    color: "#38BDF8",
    angle: 295,
    ring: 2,
    models: ["deepseek-v3.2", "deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "groq",
    name: "Groq",
    short: "Q",
    color: "#F97316",
    angle: 162,
    ring: 3,
    models: ["llama-4-scout-17b", "llama-4-maverick-17b"],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    short: "M",
    color: "#F59E0B",
    angle: 342,
    ring: 3,
    models: ["mistral-large-latest", "mistral-medium-latest"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    short: "R",
    color: "#EC4899",
    angle: 78,
    ring: 3,
    models: ["google/gemini-4-hydrogen", "openai/gpt-6.2-sol"],
  },
];

const INTENT_ROUTING_PRESETS: Record<
  "coding" | "vision" | "tools" | "fast",
  {
    label: string;
    winner: string;
    savings: string;
    branches: Array<{ model: string; provider: string; tag: string; pct: number }>;
  }
> = {
  coding: {
    label: "Coding & Debug",
    winner: "Claude Opus 5.5",
    savings: "Zero manual switching",
    branches: [
      { model: "Claude Opus 5.5", provider: "Anthropic", tag: "A", pct: 55 },
      { model: "Gemini 4 Carbon", provider: "Gemini", tag: "G", pct: 25 },
      { model: "GPT-6.2 Astra", provider: "OpenAI", tag: "O", pct: 15 },
      { model: "DeepSeek V3.2", provider: "DeepSeek", tag: "D", pct: 5 },
    ],
  },
  vision: {
    label: "Multimodal Vision",
    winner: "Gemini 4 Neon",
    savings: "Native image_url translation",
    branches: [
      { model: "Gemini 4 Neon", provider: "Gemini", tag: "G", pct: 50 },
      { model: "GPT-6.1 Terra", provider: "OpenAI", tag: "O", pct: 25 },
      { model: "Claude Sonnet 5.5", provider: "Anthropic", tag: "A", pct: 20 },
      { model: "Llama 4 Maverick", provider: "Groq", tag: "Q", pct: 5 },
    ],
  },
  tools: {
    label: "Function Calling",
    winner: "GPT-6.2 Sol",
    savings: "Unified tools[] schema",
    branches: [
      { model: "GPT-6.2 Sol", provider: "OpenAI", tag: "O", pct: 45 },
      { model: "Gemini 4 Hydrogen", provider: "Gemini", tag: "G", pct: 35 },
      { model: "Claude Sonnet 5.5", provider: "Anthropic", tag: "A", pct: 15 },
      { model: "Llama 4 Scout", provider: "Groq", tag: "Q", pct: 5 },
    ],
  },
  fast: {
    label: "Fast Chat",
    winner: "Gemini 4 Hydrogen",
    savings: "Up to 80% lower token spend",
    branches: [
      { model: "Gemini 4 Hydrogen", provider: "Gemini", tag: "G", pct: 60 },
      { model: "Claude Haiku 5.5", provider: "Anthropic", tag: "A", pct: 20 },
      { model: "GPT-6 Luna", provider: "OpenAI", tag: "O", pct: 12 },
      { model: "Gemini 3.1 Flash Lite", provider: "Gemini", tag: "G", pct: 8 },
    ],
  },
};

export function LandingPage({
  onOpenAuth,
  isAuthenticated = false,
  onOpenDashboard,
}: LandingPageProps) {
  const [hoveredProvider, setHoveredProvider] = useState(ORBIT_PROVIDERS[0]);
  const [activeIntent, setActiveIntent] = useState<
    "coding" | "vision" | "tools" | "fast"
  >("fast");
  const [failoverTick, setFailoverTick] = useState(0);
  const [compressPolicy, setCompressPolicy] = useState(true);
  const [intentPolicy, setIntentPolicy] = useState(true);
  const [policyMode, setPolicyMode] = useState<"priority" | "intent" | "cost">(
    "intent"
  );
  const [sdkTab, setSdkTab] = useState<"ts" | "python" | "anthropic" | "curl">(
    "ts"
  );
  const [copiedSdk, setCopiedSdk] = useState(false);

  // Live animated failover pulse every 1.4s
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFailoverTick((t) => (t + 1) % 28);
    }, 1400);
    return () => window.clearInterval(timer);
  }, []);

  // Auto-cycle intent preset subtly until user interacts? Let's keep user control immediate without jarring jumps
  const currentPreset = INTENT_ROUTING_PRESETS[activeIntent];

  const failoverMatrix = useMemo(() => {
    const SLOTS = 28;
    const providers = [
      { name: "Anthropic", tag: "A", faultAt: (failoverTick + 5) % SLOTS },
      { name: "Google Gemini", tag: "G", faultAt: (failoverTick + 14) % SLOTS },
      { name: "OpenAI", tag: "O", faultAt: (failoverTick + 21) % SLOTS },
    ];

    const rows = providers.map((p) => {
      const slots = Array.from({ length: SLOTS }, (_, i) => {
        const dist = (i - p.faultAt + SLOTS) % SLOTS;
        if (dist <= 3) return "fail";
        if (dist === 4) return "amber";
        return "ok";
      });
      return { ...p, slots };
    });

    const unified = Array.from({ length: SLOTS }, (_, i) => {
      const anyAmber = rows.some((r) => r.slots[i] === "fail");
      return anyAmber ? "recovered" : "ok";
    });

    return { rows, unified };
  }, [failoverTick]);

  const originUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-asrouter-gateway";

  const sdkSnippets: Record<"ts" | "python" | "anthropic" | "curl", string> = {
    ts: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${originUrl}/v1",
  apiKey: "sk-asr-YOUR_GATEWAY_KEY",
});

const response = await client.chat.completions.create({
  model: "smart-auto",
  messages: [{ role: "user", content: "Refactor this React hook." }],
});`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${originUrl}/v1",
    api_key="sk-asr-YOUR_GATEWAY_KEY",
)

res = client.chat.completions.create(
    model="smart-auto",
    messages=[{"role": "user", "content": "Summarize system metrics."}],
)
print(res.choices[0].message.content)`,
    anthropic: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${originUrl}",
  apiKey: "sk-asr-YOUR_GATEWAY_KEY",
});

const msg = await client.messages.create({
  model: "smart-auto",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello Claude Code!" }],
});`,
    curl: `curl ${originUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-asr-YOUR_GATEWAY_KEY" \\
  -d '{
    "model": "smart-auto",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Inspect this UI screenshot"},
          {"type": "image_url", "image_url": {"url": "https://example.com/ui.png"}}
        ]
      }
    ]
  }'`,
  };

  const copySdk = async () => {
    await navigator.clipboard.writeText(sdkSnippets[sdkTab]);
    setCopiedSdk(true);
    setTimeout(() => setCopiedSdk(false), 1800);
  };

  const primaryAction = () => {
    if (isAuthenticated && onOpenDashboard) {
      onOpenDashboard();
    } else {
      onOpenAuth("signup");
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA] selection:bg-amber-400 selection:text-[#09090B]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 h-16 border-b border-[#222227] bg-[#09090B]/90 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto h-full px-5 sm:px-8 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-base font-bold tracking-tight text-[#FAFAFA] whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <span className="w-6 h-6 rounded-md bg-amber-400 text-[#09090B] font-mono text-xs font-bold flex items-center justify-center">
              AS
            </span>
            <span>AS ROUTER</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#A1A1AA]">
            <a
              href="#routing"
              className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
            >
              Routing
            </a>
            <a
              href="#failover"
              className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
            >
              Failover
            </a>
            <a
              href="#policies"
              className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
            >
              Policies
            </a>
            <a
              href="#quickstart"
              className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
            >
              Quickstart
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            {isAuthenticated && onOpenDashboard ? (
              <button
                type="button"
                onClick={onOpenDashboard}
                className="px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Open Dashboard
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signin")}
                  className="px-3.5 py-2 text-xs font-medium text-[#FAFAFA] bg-[#111114] hover:bg-[#18181B] border border-[#27272A] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signup")}
                  className="px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Sign up
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* HERO SECTION: OpenRouter Orbital Constellation */}
      <section
        id="top"
        className="relative overflow-hidden border-b border-[#1C1C21]"
      >
        {/* Subtle radial spotlight */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 68% 45%, rgba(251,191,36,0.07), transparent 55%)",
          }}
        />

        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative">
          {/* Hero Copy Left */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5 space-y-6"
          >
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight text-[#FAFAFA] leading-[1.06]">
              The future is multi-model.
            </h1>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={primaryAction}
                className="px-5 py-2.5 text-sm font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {isAuthenticated ? "Go to Dashboard" : "Get API key"}
              </button>

              <a
                href="#quickstart"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#FAFAFA] bg-[#111114] hover:bg-[#18181B] border border-[#27272A] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Terminal className="w-4 h-4 text-amber-400" />
                <span>SDK Quickstart</span>
              </a>
            </div>
          </motion.div>

          {/* Hero Animated Orbital Constellation Right */}
          <div className="lg:col-span-7 flex flex-col items-center">
            <div className="relative w-full max-w-[620px] h-[380px] sm:h-[430px] flex items-center justify-center">
              {/* Elliptical Orbital Rings + Animated Pulses */}
              <svg
                viewBox="0 0 600 420"
                className="w-full h-full overflow-visible"
                aria-hidden="true"
              >
                <defs>
                  <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(251,191,36,0.22)" />
                    <stop offset="100%" stopColor="rgba(251,191,36,0)" />
                  </radialGradient>
                </defs>

                <circle cx="300" cy="210" r="95" fill="url(#coreGlow)" />

                {/* 3 Concentric Orbital Ellipses */}
                <ellipse
                  cx="300"
                  cy="210"
                  rx="130"
                  ry="82"
                  fill="none"
                  stroke="#27272A"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="-40"
                    dur="6s"
                    repeatCount="indefinite"
                  />
                </ellipse>
                <ellipse
                  cx="300"
                  cy="210"
                  rx="205"
                  ry="132"
                  fill="none"
                  stroke="#1C1C21"
                  strokeWidth="1"
                  strokeDasharray="2 8"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="40"
                    dur="10s"
                    repeatCount="indefinite"
                  />
                </ellipse>
                <ellipse
                  cx="300"
                  cy="210"
                  rx="275"
                  ry="178"
                  fill="none"
                  stroke="#18181B"
                  strokeWidth="1"
                />

                {/* Animated Routing Signal Lines + Particles to each Orbit Node */}
                {ORBIT_PROVIDERS.map((p, idx) => {
                  const rx = p.ring === 1 ? 130 : p.ring === 2 ? 205 : 275;
                  const ry = p.ring === 1 ? 82 : p.ring === 2 ? 132 : 178;
                  const rad = (p.angle * Math.PI) / 180;
                  const nx = 300 + rx * Math.cos(rad);
                  const ny = 210 + ry * Math.sin(rad);
                  const isFocused = hoveredProvider.id === p.id;
                  const pathId = `orbit-ray-${p.id}`;

                  return (
                    <g key={p.id}>
                      <path
                        id={pathId}
                        d={`M 300 210 Q ${(300 + nx) / 2} ${
                          (210 + ny) / 2 - (idx % 2 === 0 ? 18 : -18)
                        }, ${nx.toFixed(1)} ${ny.toFixed(1)}`}
                        fill="none"
                        stroke={isFocused ? "rgba(251,191,36,0.45)" : "#1F1F24"}
                        strokeWidth={isFocused ? "1.5" : "1"}
                      />

                      {/* Surrounding Star-Cluster Dots */}
                      {[
                        [-18, -14],
                        [18, -10],
                        [-14, 16],
                        [16, 15],
                        [0, -22],
                      ].map(([dx, dy], dIdx) => (
                        <circle
                          key={dIdx}
                          cx={nx + dx}
                          cy={ny + dy}
                          r={dIdx === 0 ? 2 : 1.3}
                          fill={isFocused ? "#FBBF24" : "#3F3F46"}
                          opacity={isFocused ? 0.95 : 0.65}
                        />
                      ))}

                      {/* Traveling Amber Photon */}
                      <circle r={isFocused ? 3.2 : 2.2} fill="#FBBF24">
                        <animateMotion
                          dur={`${2.8 + (idx % 3) * 0.7}s`}
                          repeatCount="indefinite"
                          begin={`${idx * 0.35}s`}
                        >
                          <mpath href={`#${pathId}`} />
                        </animateMotion>
                      </circle>
                    </g>
                  );
                })}
              </svg>

              {/* Central Floating Metallic AS ROUTER Emblem */}
              <motion.div
                animate={{ scale: [1, 1.04, 1] }}
                transition={{
                  duration: 4.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-2xl bg-gradient-to-br from-[#27272A] via-[#111114] to-[#09090B] border border-[#3F3F46] flex flex-col items-center justify-center shadow-2xl"
              >
                <span className="font-display text-2xl font-bold tracking-tight text-[#FAFAFA]">
                  AS
                </span>
                <span className="font-mono text-[9px] text-amber-400 tracking-wider">
                  ROUTER
                </span>
              </motion.div>

              {/* Interactive Provider Constellation Nodes */}
              {ORBIT_PROVIDERS.map((p, idx) => {
                const rx = p.ring === 1 ? 130 : p.ring === 2 ? 205 : 275;
                const ry = p.ring === 1 ? 82 : p.ring === 2 ? 132 : 178;
                const rad = (p.angle * Math.PI) / 180;
                const leftPct = ((300 + rx * Math.cos(rad)) / 600) * 100;
                const topPct = ((210 + ry * Math.sin(rad)) / 420) * 100;
                const isFocused = hoveredProvider.id === p.id;

                return (
                  <div
                    key={p.id}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                  >
                    <motion.button
                      type="button"
                      onMouseEnter={() => setHoveredProvider(p)}
                      onClick={() => setHoveredProvider(p)}
                      animate={{ y: [0, -5, 0] }}
                      transition={{
                        duration: 3.2 + (idx % 3) * 0.65,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: idx * 0.22,
                      }}
                      whileHover={{ scale: 1.15 }}
                      className={`w-9 h-9 rounded-full border flex items-center justify-center font-mono text-xs font-bold transition-colors ${
                        isFocused
                          ? "bg-[#18181B] border-amber-400 text-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.22)]"
                          : "bg-[#111114] border-[#27272A] text-[#D4D4D8] hover:border-[#52525B]"
                      }`}
                      title={p.name}
                    >
                      {p.short}
                    </motion.button>
                  </div>
                );
              })}
            </div>

            {/* Active Constellation Inspector Line */}
            <div className="mt-2 px-4 py-2 bg-[#111114] border border-[#222227] rounded-lg flex flex-wrap items-center justify-center gap-3 text-xs">
              <span className="font-medium text-amber-400">
                {hoveredProvider.name}
              </span>
              <span className="text-[#52525B]">·</span>
              <span className="font-mono text-[#A1A1AA]">
                {hoveredProvider.models.join("  ·  ")}
              </span>
            </div>
          </div>
        </div>

        {/* Supported Provider Strip */}
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 pb-10">
          <div className="pt-6 border-t border-[#1C1C21] flex flex-wrap items-center justify-between gap-4 sm:gap-6 text-xs font-display font-semibold tracking-wide">
            {ORBIT_PROVIDERS.map((p) => {
              const isSelected = hoveredProvider.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setHoveredProvider(p)}
                  className={`transition-colors ${
                    isSelected
                      ? "text-amber-400"
                      : "text-[#8B8B95] hover:text-[#FAFAFA]"
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* SECTION 1: Animated Better, faster, cheaper. Route all three. */}
      <section id="routing" className="max-w-[1280px] mx-auto px-5 sm:px-8 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45 }}
            className="lg:col-span-5 space-y-5"
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#FAFAFA] leading-[1.12]">
              Better, faster, cheaper. Get all three.
            </h2>
            <button
              type="button"
              onClick={primaryAction}
              className="inline-flex items-center gap-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap"
            >
              <span>Build a smart combo</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="lg:col-span-7 bg-[#111114] border border-[#222227] rounded-xl overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-[#222227] flex flex-wrap items-center justify-between gap-2">
              <code className="font-mono text-xs text-[#D4D4D8]">
                model: "asrouter/intent_auto"
              </code>
              <div className="inline-flex items-center gap-1 bg-[#09090B] border border-[#27272A] rounded-md p-0.5">
                {(
                  [
                    ["fast", "Fast"],
                    ["coding", "Coding"],
                    ["vision", "Vision"],
                    ["tools", "Tools"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveIntent(key)}
                    className={`relative px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      activeIntent === key
                        ? "text-amber-400"
                        : "text-[#8B8B95] hover:text-[#D4D4D8]"
                    }`}
                  >
                    {activeIntent === key && (
                      <motion.span
                        layoutId="landing-intent-pill"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        className="absolute inset-0 bg-[#18181B] rounded"
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 sm:px-5 py-6 grid grid-cols-12 items-center gap-2">
              {/* Animated SVG Curves + <animateMotion> Packets */}
              <div className="col-span-4 sm:col-span-6 relative h-[210px]">
                <svg
                  viewBox="0 0 260 210"
                  className="w-full h-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  <path
                    id="landing-in"
                    d="M 0 105 L 62 105"
                    fill="none"
                    stroke="#27272A"
                    strokeWidth="1.5"
                  />
                  <circle r="3" fill="#FBBF24">
                    <animateMotion dur="1.4s" repeatCount="indefinite">
                      <mpath href="#landing-in" />
                    </animateMotion>
                  </circle>

                  {[28, 79, 131, 182].map((ty, idx) => {
                    const pid = `landing-branch-${idx}`;
                    const isPrimary = idx === 0;
                    return (
                      <g key={pid}>
                        <path
                          id={pid}
                          d={`M 82 105 C 145 105, 175 ${ty}, 256 ${ty}`}
                          fill="none"
                          stroke={
                            isPrimary ? "rgba(251,191,36,0.55)" : "#27272A"
                          }
                          strokeWidth={isPrimary ? "1.6" : "1.15"}
                        />
                        <circle
                          r={isPrimary ? 3.2 : 2.3}
                          fill={isPrimary ? "#FBBF24" : "#A1A1AA"}
                        >
                          <animateMotion
                            dur={`${1.6 + idx * 0.35}s`}
                            repeatCount="indefinite"
                            begin={`${idx * 0.25}s`}
                          >
                            <mpath href={`#${pid}`} />
                          </animateMotion>
                        </circle>
                      </g>
                    );
                  })}
                </svg>

                <div className="absolute top-1/2 -translate-y-1/2 left-[48px] w-10 h-10 rounded-full bg-[#09090B] border border-amber-400/50 flex items-center justify-center">
                  <span className="font-display text-xs font-bold text-amber-400">
                    AS
                  </span>
                </div>
              </div>

              {/* Right Target Models */}
              <div className="col-span-8 sm:col-span-6 h-[210px] flex flex-col justify-between py-1">
                {currentPreset.branches.map((b, idx) => (
                  <motion.div
                    key={`${activeIntent}-${b.model}`}
                    initial={{ opacity: 0.5, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.04 }}
                    className="flex items-center justify-between gap-2.5"
                  >
                    <div
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full min-w-0 flex-1 border ${
                        idx === 0
                          ? "bg-[#18181B] border-amber-400/40"
                          : "bg-[#18181B] border-[#27272A]"
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-[#09090B] text-amber-400 font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                        {b.tag}
                      </span>
                      <span className="font-mono text-xs text-[#FAFAFA] truncate">
                        {b.model}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-[#A1A1AA] tabular-nums w-9 text-right shrink-0">
                      {b.pct}%
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[#222227] flex items-center justify-between text-xs">
              <span className="text-[#A1A1AA]">
                {currentPreset.label} →{" "}
                <span className="text-[#FAFAFA]">{currentPreset.winner}</span>
              </span>
              <span className="font-mono font-semibold text-amber-400">
                {currentPreset.savings}
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* SECTION 2: Animated Stay up through outages and rate limits */}
      <section
        id="failover"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 py-20 border-t border-[#1C1C21]"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-7 bg-[#111114] border border-[#222227] rounded-xl overflow-hidden order-2 lg:order-1"
          >
            <div className="px-5 py-3 border-b border-[#222227] flex items-center justify-between">
              <span className="text-xs font-medium text-[#A1A1AA]">
                Providers
              </span>
              <span className="font-mono text-[11px] text-[#71717A] tabular-nums">
                Live 429 failover stream
              </span>
            </div>

            <div className="p-5 space-y-4">
              {failoverMatrix.rows.map((row) => (
                <div key={row.name} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-[#18181B] border border-[#27272A] font-mono text-[10px] font-bold text-amber-400 flex items-center justify-center">
                        {row.tag}
                      </span>
                      <span className="font-medium text-[#D4D4D8]">
                        {row.name}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-[#71717A]">
                      {row.slots.includes("fail") ? "429 spike handled" : "ok"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {row.slots.map((state, idx) => (
                      <div
                        key={idx}
                        className={`h-3.5 flex-1 rounded-[2px] transition-colors duration-300 ${
                          state === "ok"
                            ? "bg-[#10B981]"
                            : state === "fail"
                              ? "bg-rose-500"
                              : "bg-amber-400"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div className="pt-3.5 border-t border-[#222227] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#FAFAFA]">
                    Through AS ROUTER
                  </span>
                  <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                    100.0% request continuity
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {failoverMatrix.unified.map((state, idx) => (
                    <div
                      key={idx}
                      className={`h-3.5 flex-1 rounded-[2px] transition-colors duration-300 ${
                        state === "recovered" ? "bg-[#10B981]" : "bg-[#10B981]"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: 0.08 }}
            className="lg:col-span-5 space-y-5 order-1 lg:order-2"
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#FAFAFA] leading-[1.12]">
              Stay up through outages and rate limits
            </h2>
            <button
              type="button"
              onClick={primaryAction}
              className="inline-flex items-center gap-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap"
            >
              <span>Inspect failover traces</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* SECTION 3: Animated Your gateway, your policies */}
      <section
        id="policies"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 py-20 border-t border-[#1C1C21]"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45 }}
            className="lg:col-span-6 bg-[#111114] border border-[#222227] rounded-xl overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-[#222227] flex items-center justify-between text-xs">
              <span className="font-medium text-[#FAFAFA]">Production</span>
              <span className="text-[#71717A]">Workspace policy</span>
            </div>

            <div className="divide-y divide-[#1C1C21]">
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <span className="text-sm text-[#D4D4D8]">
                  Prompt compression
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={compressPolicy}
                  onClick={() => setCompressPolicy((v) => !v)}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                    compressPolicy ? "bg-amber-400" : "bg-[#27272A]"
                  }`}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    className={`w-5 h-5 rounded-full bg-[#09090B] ${
                      compressPolicy ? "ml-auto" : "mr-auto"
                    }`}
                  />
                </button>
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <span className="text-sm text-[#D4D4D8]">
                  Intent-based smart auto-routing
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={intentPolicy}
                  onClick={() => setIntentPolicy((v) => !v)}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                    intentPolicy ? "bg-amber-400" : "bg-[#27272A]"
                  }`}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    className={`w-5 h-5 rounded-full bg-[#09090B] ${
                      intentPolicy ? "ml-auto" : "mr-auto"
                    }`}
                  />
                </button>
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <span className="text-sm text-[#D4D4D8]">Routing mode</span>
                <div className="inline-flex items-center p-0.5 bg-[#09090B] border border-[#27272A] rounded-md">
                  {(
                    [
                      ["priority", "Priority"],
                      ["intent", "Intent"],
                      ["cost", "Cost"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPolicyMode(id)}
                      className={`relative px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        policyMode === id
                          ? "text-amber-400"
                          : "text-[#71717A] hover:text-[#D4D4D8]"
                      }`}
                    >
                      {policyMode === id && (
                        <motion.span
                          layoutId="landing-policy-mode"
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 32,
                          }}
                          className="absolute inset-0 bg-[#18181B] rounded"
                        />
                      )}
                      <span className="relative z-10">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <span className="text-sm text-[#D4D4D8]">
                  Allowed providers
                </span>
                <div className="flex items-center gap-1.5">
                  {ORBIT_PROVIDERS.map((p) => (
                    <span
                      key={p.id}
                      style={{ color: p.color }}
                      className="w-6 h-6 rounded-full bg-[#18181B] border border-[#27272A] font-mono text-[10px] font-bold flex items-center justify-center"
                      title={p.name}
                    >
                      {p.short}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: 0.08 }}
            className="lg:col-span-6 space-y-6"
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#FAFAFA] leading-[1.12]">
              Your data, your policies
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm text-[#D4D4D8]">
              {[
                "Encrypted key vault",
                "Bring your own provider keys",
                "Scoped gateway API keys",
                "Daily token & USD budgets",
                "Tool & multimodal translation",
                "Real-time telemetry logs",
                "Automatic health probes",
                "Persistent multi-tenant workspace",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={primaryAction}
              className="inline-flex items-center gap-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap"
            >
              <span>Manage API keys & guardrails</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* SECTION 4: Drop-In SDK Quickstart */}
      <section
        id="quickstart"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 py-20 border-t border-[#1C1C21]"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 space-y-5">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]">
              Drop-in OpenAI & Anthropic SDKs
            </h2>
            <div className="space-y-2.5 text-xs text-[#D4D4D8]">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-amber-400 shrink-0" />
                <span>/v1/chat/completions & /v1/messages</span>
              </div>
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Per-key token & monthly USD caps</span>
              </div>
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Drag-and-drop fallback & dry-run simulator</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-[#111114] border border-[#222227] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#222227] flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 flex-wrap">
                {(
                  [
                    ["ts", "OpenAI TS"],
                    ["python", "Python"],
                    ["anthropic", "Claude SDK"],
                    ["curl", "cURL"],
                  ] as const
                ).map(([tabId, label]) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setSdkTab(tabId)}
                    className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      sdkTab === tabId
                        ? "text-amber-400"
                        : "text-[#A1A1AA] hover:text-[#FAFAFA]"
                    }`}
                  >
                    {sdkTab === tabId && (
                      <motion.span
                        layoutId="landing-sdk-pill"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 32,
                        }}
                        className="absolute inset-0 bg-[#18181B] rounded-md"
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={copySdk}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#27272A] rounded-md whitespace-nowrap"
              >
                {copiedSdk ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <pre className="p-5 font-mono text-xs text-[#E4E4E7] overflow-x-auto leading-relaxed bg-[#09090B]">
              {sdkSnippets[sdkTab]}
            </pre>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-[#1C1C21] bg-[#09090B]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#71717A]">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[#FAFAFA]">
              AS ROUTER
            </span>
            <span>·</span>
            <span>Unified AI Gateway</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="#routing" className="hover:text-[#D4D4D8]">
              Routing
            </a>
            <a href="#failover" className="hover:text-[#D4D4D8]">
              Failover
            </a>
            <a href="#policies" className="hover:text-[#D4D4D8]">
              Policies
            </a>
            <button
              type="button"
              onClick={() => onOpenAuth("signin")}
              className="text-amber-400 hover:text-amber-300 font-medium"
            >
              {isAuthenticated ? "Open Dashboard" : "Sign in"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
