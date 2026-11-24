import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Layers,
  Lock,
  Menu,
  ShieldCheck,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { LLM_PROVIDER_PRESETS } from "../shared/catalog.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

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
    color: "#3B82F6",
    angle: 35,
    ring: 1,
    models: ["gemini-4-hydrogen", "gemini-4-neon", "gemini-4-carbon"],
  },
  {
    id: "openai",
    name: "OpenAI",
    short: "O",
    color: "#10B981",
    angle: 115,
    ring: 2,
    models: ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-terra", "gpt-6-luna"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    short: "A",
    color: "#6366F1",
    angle: 205,
    ring: 1,
    models: [
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-fable-5-2",
      "claude-haiku-5-5",
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    short: "D",
    color: "#0284C7",
    angle: 295,
    ring: 2,
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  {
    id: "groq",
    name: "Groq",
    short: "Q",
    color: "#EA580C",
    angle: 162,
    ring: 3,
    models: ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-4-scout-17b"],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    short: "M",
    color: "#D97706",
    angle: 342,
    ring: 3,
    models: ["mistral-large-latest", "mistral-small-latest", "ministral-8b-latest"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    short: "R",
    color: "#DB2777",
    angle: 78,
    ring: 3,
    models: [
      "google/gemini-4-hydrogen",
      "openai/gpt-6.2-sol",
      "anthropic/claude-sonnet-5.5",
    ],
  },
];

const EXTRA_POPULAR_PROVIDERS = [
  {
    id: "xai",
    name: "xAI (Grok)",
    short: "X",
    color: "#6366F1",
    models: ["grok-4.7", "grok-4.6", "grok-4.20", "grok-3-mini"],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    short: "Cb",
    color: "#0891B2",
    models: ["qwen-3.8-27b", "gpt-oss-120b", "llama-3.3-70b"],
  },
  {
    id: "together",
    name: "Together AI",
    short: "T",
    color: "#8B5CF6",
    models: [
      "deepseek-ai/DeepSeek-V4",
      "Qwen/Qwen3.8-27B-Instruct",
      "meta-llama/Llama-4-Maverick",
    ],
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    short: "Fw",
    color: "#EA580C",
    models: ["deepseek-v4-pro", "kimi-k3-instruct", "llama4-maverick"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    short: "Px",
    color: "#0D9488",
    models: ["sonar", "sonar-pro", "sonar-reasoning-pro"],
  },
];

const ALL_DISPLAY_PROVIDERS = [...ORBIT_PROVIDERS, ...EXTRA_POPULAR_PROVIDERS];

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
      { model: "claude-opus-5-5", provider: "Anthropic", tag: "A", pct: 55 },
      { model: "gemini-4-neon", provider: "Gemini", tag: "G", pct: 25 },
      { model: "gpt-6.2-astra", provider: "OpenAI", tag: "O", pct: 15 },
      { model: "deepseek-v4-pro", provider: "DeepSeek", tag: "D", pct: 5 },
    ],
  },
  vision: {
    label: "Multimodal Vision",
    winner: "GPT-6.1 Terra",
    savings: "Native image_url translation",
    branches: [
      { model: "gpt-6.1-terra", provider: "OpenAI", tag: "O", pct: 45 },
      { model: "gemini-4-carbon", provider: "Gemini", tag: "G", pct: 30 },
      { model: "claude-sonnet-5-5", provider: "Anthropic", tag: "A", pct: 20 },
      { model: "llama-4-maverick-17b", provider: "Groq", tag: "Q", pct: 5 },
    ],
  },
  tools: {
    label: "Function Calling",
    winner: "Gemini 4 Neon",
    savings: "Unified tools[] schema",
    branches: [
      { model: "gemini-4-neon", provider: "Gemini", tag: "G", pct: 45 },
      { model: "gpt-6.2-sol", provider: "OpenAI", tag: "O", pct: 35 },
      { model: "claude-sonnet-5-5", provider: "Anthropic", tag: "A", pct: 15 },
      { model: "qwen/qwen3.8-27b", provider: "Groq", tag: "Q", pct: 5 },
    ],
  },
  fast: {
    label: "Fast Chat",
    winner: "Gemini 4 Hydrogen",
    savings: "Up to 80% lower token spend",
    branches: [
      { model: "gemini-4-hydrogen", provider: "Gemini", tag: "G", pct: 55 },
      { model: "gpt-6-luna", provider: "OpenAI", tag: "O", pct: 20 },
      { model: "claude-haiku-5-5", provider: "Anthropic", tag: "A", pct: 15 },
      { model: "deepseek-flash", provider: "DeepSeek", tag: "D", pct: 10 },
    ],
  },
};

const NAV_LINKS = [
  { href: "#routing", label: "Routing" },
  { href: "#failover", label: "Failover" },
  { href: "#policies", label: "Policies" },
  { href: "#quickstart", label: "Quickstart" },
];

const LandingFailoverMatrix = React.memo(function LandingFailoverMatrix() {
  const [failoverTick, setFailoverTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFailoverTick((t) => (t + 1) % 28);
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

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

  return (
    <div className="lg:col-span-7 bg-surface border border-hairline rounded-xl overflow-hidden order-2 lg:order-1">
      <div className="px-5 py-3 border-b border-hairline flex items-center justify-between">
        <span className="text-xs font-medium text-ink-2">
          Provider health matrix
        </span>
        <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
          Live 429 failover stream
        </span>
      </div>

      <div className="p-5 space-y-4">
        {failoverMatrix.rows.map((row) => {
          const tagColor =
            row.tag === "A"
              ? "#8B5CF6"
              : row.tag === "G"
                ? "#3B82F6"
                : "#10B981";
          return (
            <div key={row.name} className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="w-5 h-5 rounded bg-elevated border border-hairline-strong font-mono text-[10px] font-bold flex items-center justify-center"
                    style={{ color: tagColor, borderColor: `${tagColor}44` }}
                  >
                    {row.tag}
                  </span>
                  <span className="font-medium text-ink">{row.name}</span>
                </div>
                <span className="font-mono text-[11px] text-ink-muted">
                  {row.slots.includes("fail") ? "429 spike handled" : "healthy"}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {row.slots.map((state, idx) => (
                  <div
                    key={idx}
                    className={`h-3.5 flex-1 rounded-[2px] transition-colors duration-200 ${
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
          );
        })}

        <div className="pt-3.5 border-t border-hairline space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink">Through AS ROUTER</span>
            <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
              100.0% request continuity
            </span>
          </div>
          <div className="flex items-center gap-1">
            {failoverMatrix.unified.map((_, idx) => (
              <div
                key={idx}
                className="h-3.5 flex-1 rounded-[2px] bg-[#10B981]"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export function LandingPage({
  onOpenAuth,
  isAuthenticated = false,
  onOpenDashboard,
}: LandingPageProps) {
  const [hoveredProvider, setHoveredProvider] = useState<{
    id: string;
    name: string;
    short: string;
    color: string;
    models: string[];
  }>(ORBIT_PROVIDERS[0]);
  const [activeIntent, setActiveIntent] = useState<
    "coding" | "vision" | "tools" | "fast"
  >("fast");
  const [compressPolicy, setCompressPolicy] = useState(true);
  const [intentPolicy, setIntentPolicy] = useState(true);
  const [policyMode, setPolicyMode] = useState<"priority" | "intent" | "cost">(
    "intent"
  );
  const [sdkTab, setSdkTab] = useState<"ts" | "python" | "anthropic" | "curl">(
    "ts"
  );
  const [copiedSdk, setCopiedSdk] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("");
  const scrollAnimRef = useRef<number | null>(null);

  const scrollToSection = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!href.startsWith("#")) return;
      e.preventDefault();
      const targetId = href.slice(1);
      setMobileMenuOpen(false);

      if (scrollAnimRef.current !== null) {
        window.cancelAnimationFrame(scrollAnimRef.current);
        scrollAnimRef.current = null;
      }

      const prefersReduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const headerOffset = 64;
      const targetEl =
        targetId === "top" ? null : document.getElementById(targetId);
      const startY = window.scrollY;
      const targetY =
        targetId === "top" || !targetEl
          ? 0
          : Math.max(
              0,
              targetEl.getBoundingClientRect().top + window.scrollY - headerOffset
            );

      setActiveSection(targetId === "top" ? "" : targetId);

      if (prefersReduced || Math.abs(targetY - startY) < 4) {
        window.scrollTo({ top: targetY });
        window.history.replaceState(null, "", href);
        return;
      }

      const duration = Math.min(
        900,
        Math.max(520, Math.abs(targetY - startY) * 0.42)
      );
      const startTime = performance.now();

      const easeInOutCubic = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const cancelOnInput = () => {
        if (scrollAnimRef.current !== null) {
          window.cancelAnimationFrame(scrollAnimRef.current);
          scrollAnimRef.current = null;
        }
        window.removeEventListener("wheel", cancelOnInput);
        window.removeEventListener("touchstart", cancelOnInput);
      };

      window.addEventListener("wheel", cancelOnInput, { passive: true });
      window.addEventListener("touchstart", cancelOnInput, { passive: true });

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeInOutCubic(progress);
        window.scrollTo(0, startY + (targetY - startY) * eased);

        if (progress < 1) {
          scrollAnimRef.current = window.requestAnimationFrame(step);
        } else {
          scrollAnimRef.current = null;
          window.removeEventListener("wheel", cancelOnInput);
          window.removeEventListener("touchstart", cancelOnInput);
          window.history.replaceState(null, "", href);
        }
      };

      scrollAnimRef.current = window.requestAnimationFrame(step);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (scrollAnimRef.current !== null) {
        window.cancelAnimationFrame(scrollAnimRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let ticking = false;
    const sectionIds = ["routing", "failover", "policies", "quickstart"];
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const scrollPos = window.scrollY + 140;
        if (window.scrollY < 160) {
          setActiveSection("");
          ticking = false;
          return;
        }
        let current = "";
        for (const id of sectionIds) {
          const el = document.getElementById(id);
          if (el && el.offsetTop <= scrollPos) {
            current = id;
          }
        }
        setActiveSection(current);
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  const currentPreset = INTENT_ROUTING_PRESETS[activeIntent];

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
    try {
      await navigator.clipboard.writeText(sdkSnippets[sdkTab]);
      setCopiedSdk(true);
      setTimeout(() => setCopiedSdk(false), 1800);
    } catch {
      // ignore clipboard permission denial
    }
  };

  const primaryAction = () => {
    if (isAuthenticated && onOpenDashboard) {
      onOpenDashboard();
    } else {
      onOpenAuth("signup");
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink selection:bg-indigo-500 selection:text-white overflow-x-hidden">
      {/* Strict 3-Zone Top Bar Contract + Responsive Mobile Drawer */}
      <header className="sticky top-0 z-40 h-16 border-b border-hairline bg-surface">
        <div className="max-w-[1280px] mx-auto h-full px-5 sm:px-8 flex items-center justify-between gap-4 sm:gap-8">
          <a
            href="#top"
            onClick={(e) => scrollToSection(e, "#top")}
            className="font-display text-base font-bold tracking-tight text-ink whitespace-nowrap shrink-0 flex items-center gap-2.5"
          >
            <img
              src="/assets/as-logo.svg"
              alt="AS ROUTER"
              className="h-5 w-auto object-contain shrink-0 drop-shadow-[0_0_10px_rgba(56,189,248,0.28)]"
            />
            <span>AS ROUTER</span>
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-ink-2"
          >
            {NAV_LINKS.map((link) => {
              const id = link.href.slice(1);
              const isActive = activeSection === id;
              return (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={(e) => scrollToSection(e, link.href)}
                  className={`relative py-1 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? "text-indigo-400"
                      : "text-ink-2 hover:text-ink"
                  }`}
                >
                  <span>{link.label}</span>
                  {isActive && (
                    <motion.span
                      layoutId="landing-nav-underline"
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 32,
                      }}
                      className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-indigo-500 rounded-full"
                    />
                  )}
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            {isAuthenticated && onOpenDashboard ? (
              <button
                type="button"
                onClick={onOpenDashboard}
                className="px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Open Dashboard
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signin")}
                  className="hidden sm:inline-flex px-3.5 py-2 text-xs font-medium text-ink bg-surface hover:bg-elevated border border-hairline-strong rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signup")}
                  className="px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Create workspace
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg bg-surface border border-hairline-strong text-ink hover:bg-elevated transition-colors"
            >
              <motion.span
                key={mobileMenuOpen ? "close" : "open"}
                initial={{ opacity: 0, rotate: -45, scale: 0.85 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                transition={{ duration: 0.18 }}
              >
                {mobileMenuOpen ? (
                  <X className="w-4 h-4" />
                ) : (
                  <Menu className="w-4 h-4" />
                )}
              </motion.span>
            </button>
          </div>
        </div>

        {/* Animated Mobile Navigation Drawer */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="md:hidden absolute top-16 inset-x-0 z-40 border-b border-hairline bg-canvas/95 backdrop-blur-md px-5 py-4 space-y-2 shadow-2xl"
            >
              <nav
                aria-label="Mobile navigation"
                className="flex flex-col space-y-1"
              >
                {NAV_LINKS.map((link, idx) => {
                  const isActive = activeSection === link.href.slice(1);
                  return (
                    <motion.a
                      key={link.href}
                      href={link.href}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.2,
                        delay: idx * 0.04,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      onClick={(e) => scrollToSection(e, link.href)}
                      className={`min-h-[44px] px-3 flex items-center justify-between text-sm font-medium rounded-lg transition-colors ${
                        isActive
                          ? "text-indigo-400 bg-surface"
                          : "text-ink-2 hover:text-indigo-400 hover:bg-surface"
                      }`}
                    >
                      <span>{link.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-ink-muted" />
                    </motion.a>
                  );
                })}
              </nav>
              {!isAuthenticated && (
                <div className="pt-2 border-t border-hairline grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenAuth("signin");
                    }}
                    className="min-h-[44px] px-3 text-xs font-medium text-ink bg-surface border border-hairline-strong rounded-lg"
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenAuth("signup");
                    }}
                    className="min-h-[44px] px-3 text-xs font-semibold bg-indigo-500 text-white rounded-lg"
                  >
                    Create workspace
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main>
        {/* HERO SECTION */}
        <section
          id="top"
          className="relative overflow-hidden border-b border-hairline"
        >
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
            style={{
              backgroundImage:
                "radial-gradient(520px 320px at 22% 10%, rgba(99,102,241,0.10), transparent 70%), radial-gradient(460px 320px at 82% 28%, rgba(56,189,248,0.08), transparent 70%)",
            }}
          />

          <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-14 sm:py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center relative">
            {/* Hero Copy Left */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="lg:col-span-5 space-y-6"
            >
              <p className="font-mono text-xs font-medium uppercase tracking-wider bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
                Unified AI Gateway
              </p>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight text-ink leading-[1.06] text-balance">
                The future is{" "}
                <span className="bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-300 bg-clip-text text-transparent animate-spectrum-text">
                  multi-model.
                </span>
              </h1>

              <p className="text-base sm:text-lg text-ink-2 leading-relaxed max-w-xl">
                Connect Gemini, OpenAI, Anthropic, xAI Grok, DeepSeek, Groq,
                Cerebras, Together, Fireworks, Perplexity, Mistral, OpenRouter,
                or custom endpoints behind one unified API—with automatic 429
                failover and strict per-key budgets.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={primaryAction}
                  className="min-h-[44px] px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 hover:brightness-110 text-white rounded-lg transition-all whitespace-nowrap shrink-0 inline-flex items-center gap-2 shadow-[0_6px_24px_-6px_rgba(99,102,241,0.6)]"
                >
                  <span>
                    {isAuthenticated ? "Open Dashboard" : "Get API key"}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </motion.button>

                <motion.a
                  href="#quickstart"
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={(e) => scrollToSection(e, "#quickstart")}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink bg-surface hover:bg-elevated border border-hairline-strong hover:border-sky-400/40 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span>SDK Quickstart</span>
                </motion.a>
              </div>

              {/* Grounded architectural highlights */}
              <div className="pt-4 border-t border-hairline grid grid-cols-3 gap-4">
                <div>
                  <div className="font-mono text-sm font-semibold text-sky-300 tabular-nums">
                    {LLM_PROVIDER_PRESETS.length}+ Providers
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    Popular &amp; custom APIs
                  </div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-emerald-300 tabular-nums">
                    AES-256
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    Encrypted BYOK vault
                  </div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-violet-300 tabular-nums">
                    &lt; 25ms
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    Gateway routing overhead
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Hero Animated Orbital Constellation Right */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="lg:col-span-7 flex flex-col items-center"
            >
              <div className="relative w-full max-w-[620px] h-[300px] sm:h-[400px] lg:h-[430px] flex items-center justify-center">
                {/* Elliptical Orbital Rings + Animated Pulses */}
                <svg
                  viewBox="0 0 600 420"
                  className="w-full h-full overflow-visible"
                  aria-hidden="true"
                >
                  <defs>
                    <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="rgba(99,102,241,0.28)" />
                      <stop offset="55%" stopColor="rgba(56,189,248,0.12)" />
                      <stop offset="100%" stopColor="rgba(99,102,241,0)" />
                    </radialGradient>
                  </defs>

                  <circle cx="300" cy="210" r="105" fill="url(#coreGlow)" />

                  <ellipse
                    cx="300"
                    cy="210"
                    rx="130"
                    ry="82"
                    fill="none"
                    stroke="var(--border-strong)"
                    strokeWidth="1.2"
                    strokeDasharray="4 6"
                  />
                  <ellipse
                    cx="300"
                    cy="210"
                    rx="205"
                    ry="132"
                    fill="none"
                    stroke="var(--border-strong)"
                    strokeOpacity="0.65"
                    strokeWidth="1"
                    strokeDasharray="2 8"
                  />
                  <ellipse
                    cx="300"
                    cy="210"
                    rx="275"
                    ry="178"
                    fill="none"
                    stroke="var(--border-hairline)"
                    strokeWidth="1"
                  />

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
                          stroke={isFocused ? p.color : "var(--border-hairline)"}
                          strokeOpacity={isFocused ? 0.72 : 0.85}
                          strokeWidth={isFocused ? "1.6" : "1"}
                        />

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
                            fill={p.color}
                            opacity={isFocused ? 0.95 : 0.45}
                          />
                        ))}

                        {isFocused && (
                          <circle r={3.5} fill={p.color}>
                            <animateMotion dur="2.2s" repeatCount="indefinite">
                              <mpath href={`#${pathId}`} />
                            </animateMotion>
                          </circle>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Central Metallic AS ROUTER Emblem */}
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none px-4 py-3 rounded-2xl bg-surface border border-hairline-strong shadow-[0_8px_24px_rgba(15,23,42,0.10)]"
                >
                  <img
                    src="/assets/as-logo.svg"
                    alt="AS ROUTER"
                    className="h-8 sm:h-10 w-auto object-contain"
                  />
                  <span className="mt-1 font-mono text-[9px] font-semibold text-sky-400 tracking-[0.22em]">
                    ROUTER
                  </span>
                </div>

                {/* Interactive Provider Constellation Nodes */}
                {ORBIT_PROVIDERS.map((p) => {
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
                      <button
                        type="button"
                        aria-label={`Inspect ${p.name} models`}
                        onMouseEnter={() => setHoveredProvider(p)}
                        onClick={() => setHoveredProvider(p)}
                        style={{
                          borderColor: isFocused ? p.color : "var(--border-strong)",
                          color: isFocused ? p.color : "var(--text-primary)",
                          boxShadow: isFocused
                            ? `0 0 18px ${p.color}38`
                            : "0 2px 8px rgba(15, 23, 42, 0.08)",
                        }}
                        className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg border flex items-center justify-center font-mono text-xs font-bold transition-transform duration-150 hover:scale-110 ${
                          isFocused ? "bg-elevated scale-105" : "bg-surface"
                        }`}
                        title={p.name}
                      >
                        {p.short}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Active Constellation Inspector Line */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={hoveredProvider.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="mt-3 px-4 py-2 bg-surface border rounded-lg flex flex-wrap items-center justify-center gap-2.5 text-xs"
                  style={{
                    borderColor: `color-mix(in srgb, ${hoveredProvider.color} 32%, var(--border-hairline))`,
                    boxShadow: `0 4px 14px -6px color-mix(in srgb, ${hoveredProvider.color} 28%, transparent)`,
                  }}
                >
                  <span
                    className="font-medium"
                    style={{ color: hoveredProvider.color }}
                  >
                    {hoveredProvider.name}
                  </span>
                  <span className="text-ink-dim">·</span>
                  <span className="font-mono text-ink-2">
                    {hoveredProvider.models.join("  ·  ")}
                  </span>
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Supported Provider Strip */}
          <div className="max-w-[1280px] mx-auto px-5 sm:px-8 pb-10">
            <div className="pt-6 border-t border-hairline flex flex-wrap items-center justify-center sm:justify-between gap-x-4 gap-y-2 text-xs font-display font-semibold tracking-wide">
              {ALL_DISPLAY_PROVIDERS.map((p) => {
                const isSelected = hoveredProvider.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setHoveredProvider(p)}
                    style={isSelected ? { color: p.color } : undefined}
                    className={`min-h-[36px] px-2 transition-colors whitespace-nowrap ${
                      isSelected
                        ? "font-bold"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 1: Smart Routing */}
        <section
          id="routing"
          className="max-w-[1280px] mx-auto px-5 sm:px-8 py-16 sm:py-20"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5 space-y-5">
              <p className="font-mono text-xs uppercase tracking-wider text-indigo-400">
                01. Smart Intent Routing
              </p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink leading-[1.12] text-balance">
                Better, faster, cheaper. Get all three.
              </h2>
              <p className="text-sm sm:text-base text-ink-2 leading-relaxed">
                Send every prompt to <code className="font-mono text-indigo-400">smart-auto</code>.
                AS ROUTER classifies intent—coding, vision, tool calls, or fast
                chat—and routes to the best connected model automatically.
              </p>
              <button
                type="button"
                onClick={primaryAction}
                className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-indigo-400 transition-colors whitespace-nowrap"
              >
                <span>Build a smart combo</span>
                <ArrowRight className="w-4 h-4 text-indigo-400" />
              </button>
            </div>

            <div className="lg:col-span-7 bg-surface border border-hairline rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-hairline flex flex-wrap items-center justify-between gap-2">
                <code className="font-mono text-xs text-ink-2">
                  model: &quot;smart-auto&quot;
                </code>
                <div className="inline-flex items-center gap-1 bg-canvas border border-hairline-strong rounded-md p-0.5">
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
                          ? "text-indigo-400"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {activeIntent === key && (
                        <motion.span
                          layoutId="landing-intent-pill"
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                          className="absolute inset-0 bg-elevated rounded"
                        />
                      )}
                      <span className="relative z-10">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 sm:px-5 py-6 grid grid-cols-12 items-center gap-2">
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
                      stroke="var(--border-strong)"
                      strokeWidth="1.5"
                    />
                    <circle r="3" fill="var(--accent-primary)">
                      <animateMotion dur="1.4s" repeatCount="indefinite">
                        <mpath href="#landing-in" />
                      </animateMotion>
                    </circle>

                    {[28, 79, 131, 182].map((ty, idx) => {
                      const pid = `landing-branch-${idx}`;
                      const isPrimary = idx === 0;
                      const branchColors = ["#4F46E5", "#0284C7", "#059669", "#EA580C"];
                      const branchColor = branchColors[idx % branchColors.length];
                      return (
                        <g key={pid}>
                          <path
                            id={pid}
                            d={`M 82 105 C 145 105, 175 ${ty}, 256 ${ty}`}
                            fill="none"
                            stroke={branchColor}
                            strokeOpacity={isPrimary ? 0.65 : 0.3}
                            strokeWidth={isPrimary ? "1.75" : "1.2"}
                          />
                          <circle
                            r={isPrimary ? 3.4 : 2.5}
                            fill={branchColor}
                          >
                            <animateMotion
                              dur={`${1.5 + idx * 0.32}s`}
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

                  <div className="absolute top-1/2 -translate-y-1/2 left-[48px] w-10 h-10 rounded-lg bg-gradient-to-br from-elevated to-canvas border border-indigo-500/50 flex items-center justify-center shadow-[0_0_16px_rgba(99,102,241,0.28)]">
                    <span className="font-display text-xs font-bold bg-gradient-to-r from-indigo-300 to-sky-300 bg-clip-text text-transparent">
                      AS
                    </span>
                  </div>
                </div>

                <div className="col-span-8 sm:col-span-6 h-[210px] flex flex-col justify-between py-1">
                  {currentPreset.branches.map((b, idx) => {
                    const branchColors = ["#4F46E5", "#0284C7", "#059669", "#EA580C"];
                    const bColor = branchColors[idx % branchColors.length];
                    return (
                      <motion.div
                        key={`${activeIntent}-${b.model}`}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.22, delay: idx * 0.045 }}
                        className="flex items-center justify-between gap-2.5"
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg min-w-0 flex-1 border bg-elevated"
                          style={{
                            borderColor:
                              idx === 0 ? `${bColor}75` : "var(--border-strong)",
                          }}
                        >
                          <span
                            className="w-4 h-4 rounded bg-canvas font-mono text-[10px] font-bold flex items-center justify-center shrink-0"
                            style={{ color: bColor }}
                          >
                            {b.tag}
                          </span>
                          <span className="font-mono text-xs text-ink truncate">
                            {b.model}
                          </span>
                        </div>
                        <span
                          className="font-mono text-xs tabular-nums w-9 text-right shrink-0"
                          style={{ color: idx === 0 ? bColor : "var(--text-secondary)" }}
                        >
                          {b.pct}%
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 py-3 border-t border-hairline flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-ink-2">
                  {currentPreset.label} →{" "}
                  <span className="text-ink font-medium">
                    {currentPreset.winner}
                  </span>
                </span>
                <span className="font-mono font-semibold text-emerald-400">
                  {currentPreset.savings}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: Automatic Failover */}
        <section
          id="failover"
          className="max-w-[1280px] mx-auto px-5 sm:px-8 py-16 sm:py-20 border-t border-hairline"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <LandingFailoverMatrix />

            <div className="lg:col-span-5 space-y-5 order-1 lg:order-2">
              <p className="font-mono text-xs uppercase tracking-wider text-indigo-400">
                02. Circuit Breakers & Retry
              </p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink leading-[1.12] text-balance">
                Stay up through outages and rate limits
              </h2>
              <p className="text-sm sm:text-base text-ink-2 leading-relaxed">
                When one upstream returns HTTP 429, 502, or times out, AS ROUTER
                trips a short circuit cooldown and retries your request against
                the next healthy model in your combo chain before your app sees
                an error.
              </p>
              <button
                type="button"
                onClick={primaryAction}
                className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-indigo-400 transition-colors whitespace-nowrap"
              >
                <span>Inspect failover traces</span>
                <ArrowRight className="w-4 h-4 text-indigo-400" />
              </button>
            </div>
          </div>
        </section>

        {/* SECTION 3: Data & Policies */}
        <section
          id="policies"
          className="max-w-[1280px] mx-auto px-5 sm:px-8 py-16 sm:py-20 border-t border-hairline"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 bg-surface border border-hairline rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-hairline flex items-center justify-between text-xs">
                <span className="font-medium text-ink">Production</span>
                <span className="text-ink-muted">Workspace policy</span>
              </div>

              <div className="divide-y divide-hairline">
                <div className="px-5 py-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-ink">
                    Prompt compression
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={compressPolicy}
                    aria-label="Toggle prompt compression"
                    onClick={() => setCompressPolicy((v) => !v)}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                      compressPolicy ? "bg-indigo-500" : "bg-subtle"
                    }`}
                  >
                    <motion.span
                      layout
                      transition={{ type: "spring", stiffness: 500, damping: 32 }}
                      className={`w-5 h-5 rounded-full bg-white ${
                        compressPolicy ? "ml-auto" : "mr-auto"
                      }`}
                    />
                  </button>
                </div>

                <div className="px-5 py-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-ink">
                    Intent-based smart auto-routing
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={intentPolicy}
                    aria-label="Toggle intent-based routing"
                    onClick={() => setIntentPolicy((v) => !v)}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                      intentPolicy ? "bg-indigo-500" : "bg-subtle"
                    }`}
                  >
                    <motion.span
                      layout
                      transition={{ type: "spring", stiffness: 500, damping: 32 }}
                      className={`w-5 h-5 rounded-full bg-white ${
                        intentPolicy ? "ml-auto" : "mr-auto"
                      }`}
                    />
                  </button>
                </div>

                <div className="px-5 py-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-ink">Routing mode</span>
                  <div className="inline-flex items-center p-0.5 bg-canvas border border-hairline-strong rounded-md">
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
                            ? "text-indigo-400"
                            : "text-ink-muted hover:text-ink"
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
                            className="absolute inset-0 bg-elevated rounded"
                          />
                        )}
                        <span className="relative z-10">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="px-5 py-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-ink whitespace-nowrap">
                    Allowed providers
                  </span>
                  <div className="flex items-center flex-wrap justify-end gap-1.5">
                    {ALL_DISPLAY_PROVIDERS.map((p) => (
                      <span
                        key={p.id}
                        style={{ color: p.color }}
                        className="w-6 h-6 rounded bg-elevated border border-hairline-strong font-mono text-[10px] font-bold flex items-center justify-center"
                        title={p.name}
                      >
                        {p.short}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 space-y-6">
              <p className="font-mono text-xs uppercase tracking-wider text-indigo-400">
                03. Governance & Encryption
              </p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-ink leading-[1.12] text-balance">
                Your keys, your policies
              </h2>
              <p className="text-sm sm:text-base text-ink-2 leading-relaxed">
                Every workspace stores upstream provider keys using AES-256-GCM
                encryption. Issue scoped gateway keys with strict model
                allowlists, daily token caps, and monthly USD spend limits.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm text-ink-2">
                {[
                  { label: "AES-256 encrypted key vault", color: "text-emerald-400" },
                  { label: "Bring your own provider keys", color: "text-sky-400" },
                  { label: "Scoped gateway API keys", color: "text-amber-400" },
                  { label: "Daily token & USD budgets", color: "text-violet-400" },
                  { label: "Tool & multimodal translation", color: "text-cyan-400" },
                  { label: "Real-time SSE telemetry logs", color: "text-orange-400" },
                  { label: "Automatic health probes", color: "text-teal-400" },
                  { label: "Isolated multi-tenant storage", color: "text-indigo-400" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <Check className={`w-4 h-4 shrink-0 ${item.color}`} />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={primaryAction}
                className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-indigo-400 transition-colors whitespace-nowrap"
              >
                <span>Manage API keys & guardrails</span>
                <ArrowRight className="w-4 h-4 text-indigo-400" />
              </button>
            </div>
          </div>
        </section>

        {/* SECTION 4: Drop-In SDK Quickstart */}
        <section
          id="quickstart"
          className="max-w-[1280px] mx-auto px-5 sm:px-8 py-16 sm:py-20 border-t border-hairline"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5 space-y-5">
              <p className="font-mono text-xs uppercase tracking-wider text-sky-400">
                04. Two-Line Integration
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink text-balance">
                Drop-in OpenAI & Anthropic SDKs
              </h2>
              <p className="text-sm sm:text-base text-ink-2 leading-relaxed">
                Keep your existing client libraries—just point{" "}
                <code className="font-mono text-sky-400">baseURL</code> to
                your AS ROUTER instance and switch models or combos without
                redeploying your codebase.
              </p>
              <div className="space-y-3 text-xs sm:text-sm text-ink-2">
                <div className="flex items-center gap-2.5">
                  <Layers className="w-4 h-4 text-violet-400 shrink-0" />
                  <span>/v1/chat/completions &amp; /v1/messages</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Per-key token &amp; monthly USD caps</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Drag-and-drop fallback &amp; dry-run simulator</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-surface border border-hairline rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-hairline flex items-center justify-between gap-3">
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
                          ? "text-indigo-400"
                          : "text-ink-muted hover:text-ink"
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
                          className="absolute inset-0 bg-elevated rounded-md"
                        />
                      )}
                      <span className="relative z-10">{label}</span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={copySdk}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline-strong rounded-md whitespace-nowrap"
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

              <pre className="p-5 font-mono text-xs text-ink overflow-x-auto leading-relaxed bg-elevated/60">
                {sdkSnippets[sdkTab]}
              </pre>
            </div>
          </div>
        </section>

        {/* SECTION 5: Architectural Guarantees + Bottom Conversion CTA */}
        <section className="max-w-[1280px] mx-auto px-5 sm:px-8 py-16 sm:py-20 border-t border-hairline">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4 }}
            className="relative overflow-hidden bg-surface border border-hairline rounded-2xl p-6 sm:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
          >
            <div
              className="pointer-events-none absolute -right-24 -top-24 w-72 h-72 rounded-full blur-[90px]"
              style={{ background: "rgba(99,102,241, 0.14)" }}
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -left-20 -bottom-24 w-64 h-64 rounded-full blur-[90px]"
              style={{ background: "rgba(56, 189, 248, 0.1)" }}
              aria-hidden="true"
            />
            <div className="lg:col-span-7 space-y-4 relative z-10">
              <p className="font-mono text-xs uppercase tracking-wider bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
                Built for production teams
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink text-balance">
                Start routing across multiple providers in under 60 seconds.
              </h2>
              <p className="text-sm sm:text-base text-ink-2 leading-relaxed max-w-2xl">
                Create an isolated workspace, connect your existing provider API
                keys, and inspect live SSE traces with full cost and latency
                visibility.
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-6 text-xs text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  Zero vendor lock-in
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Streaming SSE &amp; tool calls
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-sky-400" />
                  Live token &amp; cost logs
                </span>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center lg:items-end justify-end gap-3 relative z-10">
              {!isAuthenticated && (
                <button
                  type="button"
                  onClick={() => onOpenAuth("signin")}
                  className="min-h-[44px] px-5 py-2.5 text-sm font-medium text-ink bg-canvas hover:bg-elevated border border-hairline-strong rounded-lg transition-colors whitespace-nowrap"
                >
                  Sign in
                </button>
              )}
              <motion.button
                type="button"
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={primaryAction}
                className="min-h-[44px] px-6 py-2.5 text-sm font-semibold bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 hover:brightness-110 text-white rounded-lg transition-all whitespace-nowrap inline-flex items-center justify-center gap-2 shadow-[0_6px_24px_-6px_rgba(99,102,241,0.55)]"
              >
                <span>
                  {isAuthenticated ? "Open Dashboard" : "Create free workspace"}
                </span>
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </div>
          </motion.div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-hairline bg-canvas">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-muted">
          <div className="flex items-center gap-2.5">
            <img
              src="/assets/as-logo.svg"
              alt="AS ROUTER"
              className="h-4 w-auto object-contain shrink-0 drop-shadow-[0_0_8px_rgba(56,189,248,0.22)]"
            />
            <span className="font-display font-bold text-ink">
              AS ROUTER
            </span>
            <span>·</span>
            <span>Unified AI Gateway</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => scrollToSection(e, link.href)}
                className="hover:text-ink transition-colors whitespace-nowrap"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
