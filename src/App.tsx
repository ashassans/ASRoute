import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  Activity,
  Check,
  Copy,
  Cpu,
  Home,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Server,
  Settings,
  Terminal,
  X,
} from "lucide-react";
import { AccountSettingsModal } from "./components/AccountSettingsModal.tsx";
import { ApiKeysView } from "./components/ApiKeysView.tsx";
import { AuthGate } from "./components/AuthGate.tsx";
import { CombosView } from "./components/CombosView.tsx";
import { LandingPage } from "./components/LandingPage.tsx";
import { LogsView } from "./components/LogsView.tsx";
import { ModelsView } from "./components/ModelsView.tsx";
import { OverviewView } from "./components/OverviewView.tsx";
import { PlaygroundView } from "./components/PlaygroundView.tsx";
import { ProvidersView } from "./components/ProvidersView.tsx";
import { authClient } from "./lib/auth-client.ts";
import type {
  BootstrapPayload,
  LiveRouteActivity,
  RequestLog,
} from "./types/gateway.ts";

type NavTab =
  | "overview"
  | "providers"
  | "models"
  | "combos"
  | "keys"
  | "logs"
  | "playground";

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "providers", label: "Providers", icon: Server },
  { id: "models", label: "Models", icon: Cpu },
  { id: "combos", label: "Combos", icon: Layers },
  { id: "keys", label: "API Keys", icon: KeyRound },
  { id: "logs", label: "Live Logs", icon: Activity },
  { id: "playground", label: "Playground", icon: Terminal },
];

const VALID_TABS = new Set<NavTab>([
  "overview",
  "providers",
  "models",
  "combos",
  "keys",
  "logs",
  "playground",
]);

function parseRoute(pathname: string): {
  area: "home" | "login" | "signup" | "dashboard";
  tab: NavTab;
} {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/login") return { area: "login", tab: "overview" };
  if (clean === "/signup") return { area: "signup", tab: "overview" };
  if (clean === "/dashboard") return { area: "dashboard", tab: "overview" };
  if (clean.startsWith("/dashboard/")) {
    const seg = clean.slice("/dashboard/".length).split("/")[0] as NavTab;
    return {
      area: "dashboard",
      tab: VALID_TABS.has(seg) ? seg : "overview",
    };
  }
  return { area: "home", tab: "overview" };
}

export default function App() {
  const { data: session, isPending: sessionLoading, refetch } =
    authClient.useSession();

  const initialRoute =
    typeof window !== "undefined"
      ? parseRoute(window.location.pathname)
      : { area: "home" as const, tab: "overview" as NavTab };

  const [routeArea, setRouteArea] = useState<
    "home" | "login" | "signup" | "dashboard"
  >(initialRoute.area);
  const [activeTab, setActiveTab] = useState<NavTab>(initialRoute.tab);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspace, setWorkspace] = useState<BootstrapPayload | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [streamPaused, setStreamPaused] = useState(false);
  const [activeRoutes, setActiveRoutes] = useState<LiveRouteActivity[]>([]);
  const [openCreateKeyCounter, setOpenCreateKeyCounter] = useState(0);
  const [copiedBaseUrl, setCopiedBaseUrl] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);

  const navigateTo = useCallback((path: string, replace = false) => {
    const parsed = parseRoute(path);
    setRouteArea(parsed.area);
    setActiveTab(parsed.tab);
    if (typeof window !== "undefined") {
      if (replace) {
        window.history.replaceState(null, "", path);
      } else if (window.location.pathname !== path) {
        window.history.pushState(null, "", path);
      }
    }
  }, []);

  const navigateTab = useCallback(
    (tab: NavTab) => {
      const target = tab === "overview" ? "/dashboard" : `/dashboard/${tab}`;
      navigateTo(target);
    },
    [navigateTo]
  );

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseRoute(window.location.pathname);
      setRouteArea(parsed.area);
      setActiveTab(parsed.tab);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mobileMenuOpen) setMobileMenuOpen(false);
        if (settingsOpen) setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen, settingsOpen]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.user && routeArea === "dashboard") {
      navigateTo("/login", true);
    } else if (
      session?.user &&
      (routeArea === "login" || routeArea === "signup")
    ) {
      navigateTo("/dashboard", true);
    }
  }, [sessionLoading, session?.user, routeArea, navigateTo]);

  const notify = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      setToast({ message, tone });
      setTimeout(() => {
        setToast((prev) => (prev?.message === message ? null : prev));
      }, 3600);
    },
    []
  );

  const fetchBootstrap = useCallback(async () => {
    setLoadingWorkspace(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/bootstrap");
      if (!res.ok) {
        throw new Error("Failed to load AS ROUTER workspace.");
      }
      const data = (await res.json()) as BootstrapPayload;
      setWorkspace(data);
    } catch (err: unknown) {
      setLoadError(
        err instanceof Error ? err.message : "Unable to load workspace."
      );
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchBootstrap();
    } else {
      setWorkspace(null);
    }
  }, [session?.user, fetchBootstrap]);

  // Real-time SSE Log, Live Activity & Circuit Stream
  useEffect(() => {
    if (!session?.user || streamPaused) {
      setSseConnected(false);
      setActiveRoutes([]);
      return;
    }

    const es = new EventSource("/api/logs/stream");

    es.addEventListener("connected", () => {
      setSseConnected(true);
    });

    es.addEventListener("active_snapshot", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          active?: LiveRouteActivity[];
        };
        if (Array.isArray(data.active)) {
          setActiveRoutes(data.active);
        }
      } catch {
        // ignore malformed event
      }
    });

    es.addEventListener("activity", (ev) => {
      try {
        const incoming = JSON.parse(
          (ev as MessageEvent).data
        ) as LiveRouteActivity;
        setActiveRoutes((prev) => {
          if (incoming.phase === "start") {
            const without = prev.filter(
              (r) => r.requestId !== incoming.requestId
            );
            return [incoming, ...without].slice(0, 8);
          }
          return prev.filter((r) => r.requestId !== incoming.requestId);
        });
      } catch {
        // ignore malformed event
      }
    });

    es.addEventListener("log", (ev) => {
      try {
        const incoming = JSON.parse((ev as MessageEvent).data) as RequestLog;
        setWorkspace((prev) => {
          if (!prev) return prev;
          if (prev.logs.some((l) => l.id === incoming.id)) return prev;
          return {
            ...prev,
            logs: [incoming, ...prev.logs].slice(0, 200),
          };
        });
      } catch {
        // ignore malformed event
      }
    });

    es.addEventListener("circuit", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          connectionId: string;
          circuitStatus: string;
        };
        setWorkspace((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            connections: prev.connections.map((c) =>
              c.id === data.connectionId
                ? { ...c, circuitStatus: data.circuitStatus }
                : c
            ),
          };
        });
      } catch {
        // ignore malformed event
      }
    });

    es.onerror = () => {
      setSseConnected(false);
    };

    const cleanupTimer = window.setInterval(() => {
      const cutoff = Date.now() - 60_000;
      setActiveRoutes((prev) =>
        prev.filter((r) => new Date(r.timestamp).getTime() > cutoff)
      );
    }, 10_000);

    return () => {
      window.clearInterval(cleanupTimer);
      es.close();
      setSseConnected(false);
    };
  }, [session?.user, streamPaused]);

  const handleSignOut = async () => {
    await authClient.signOut();
    setWorkspace(null);
    setSettingsOpen(false);
    navigateTo("/");
    await refetch();
  };

  const handleClearLogs = async () => {
    try {
      const res = await fetch("/api/logs", { method: "DELETE" });
      if (res.ok) {
        setWorkspace((prev) => (prev ? { ...prev, logs: [] } : prev));
        notify("Request logs cleared.", "success");
      }
    } catch {
      notify("Failed to clear logs", "error");
    }
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-[#09090B] text-[#A1A1AA] flex items-center justify-center text-sm">
        Loading AS ROUTER...
      </div>
    );
  }

  if (!session?.user) {
    if (routeArea === "login" || routeArea === "signup") {
      return (
        <AuthGate
          initialMode={routeArea === "signup" ? "signup" : "signin"}
          onBackHome={() => navigateTo("/")}
          onAuthenticated={async () => {
            navigateTo("/dashboard", true);
            await refetch();
          }}
        />
      );
    }

    return (
      <LandingPage
        onOpenAuth={(mode) => {
          navigateTo(mode === "signup" ? "/signup" : "/login");
        }}
      />
    );
  }

  if (routeArea === "home") {
    return (
      <LandingPage
        isAuthenticated
        onOpenDashboard={() => navigateTo("/dashboard")}
        onOpenAuth={() => navigateTo("/dashboard")}
      />
    );
  }

  const activeNavLabel =
    NAV_ITEMS.find((n) => n.id === activeTab)?.label || "Overview";

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-[#09090B] text-[#F3F4F6] flex">
      {/* Sidebar Navigation (Desktop 248px) */}
      <aside className="hidden md:flex md:w-[248px] md:flex-col md:fixed md:inset-y-0 bg-[#09090B] border-r border-[#222227]">
        <div className="h-16 px-5 flex items-center justify-between border-b border-[#222227]">
          <span className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap">
            AS ROUTER
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTab(item.id)}
                className={`relative w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  isActive
                    ? "text-white"
                    : "text-[#A1A1AA] hover:text-white hover:bg-[#111114]/60"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-nav-pill"
                    transition={{ type: "spring", stiffness: 360, damping: 32 }}
                    className="absolute inset-0 bg-[#111114] border border-[#222227] rounded-lg"
                  />
                )}
                <span className="relative z-10 flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? "text-amber-400" : "text-[#A1A1AA]"
                    }`}
                  />
                  <span>{item.label}</span>
                </span>
                {item.id === "logs" && workspace && (
                  <span className="relative z-10 font-mono text-xs text-[#A1A1AA] tabular-nums">
                    {workspace.logs.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-[#222227] flex items-center justify-between gap-2">
          <div className="text-xs min-w-0">
            <div className="text-white font-medium truncate">
              {session.user.name}
            </div>
            <div className="text-[#A1A1AA] truncate">{session.user.email}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => navigateTo("/")}
              title="Home"
              aria-label="Home"
              className="w-8 h-8 inline-flex items-center justify-center bg-[#111114] hover:bg-[#18181B] border border-[#222227] hover:border-amber-400/50 rounded-lg transition-colors"
            >
              <Home className="w-3.5 h-3.5 text-amber-400" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Account Settings"
              aria-label="Account Settings"
              className="w-8 h-8 inline-flex items-center justify-center text-[#A1A1AA] hover:text-amber-400 bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-lg transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="w-8 h-8 inline-flex items-center justify-center text-[#A1A1AA] hover:text-white bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-50 md:hidden bg-black/70 flex"
          >
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-64 bg-[#09090B] border-r border-[#222227] h-full flex flex-col justify-between p-4"
            >
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[#222227]">
                <span className="font-display text-base font-bold text-white">
                  AS ROUTER
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-[#A1A1AA] hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        navigateTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap ${
                        isActive
                          ? "text-white"
                          : "text-[#A1A1AA] hover:text-white"
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="mobile-nav-pill"
                          transition={{ type: "spring", stiffness: 360, damping: 32 }}
                          className="absolute inset-0 bg-[#111114] border border-[#222227] rounded-lg"
                        />
                      )}
                      <Icon
                        className={`relative z-10 w-4 h-4 ${
                          isActive ? "text-amber-400" : "text-[#A1A1AA]"
                        }`}
                      />
                      <span className="relative z-10">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="pt-3 border-t border-[#222227] flex items-center justify-between gap-2">
              <div className="text-xs min-w-0">
                <div className="text-white font-medium truncate">
                  {session.user.name}
                </div>
                <div className="text-[#A1A1AA] truncate">
                  {session.user.email}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigateTo("/");
                  }}
                  title="Home"
                  aria-label="Home"
                  className="w-8 h-8 inline-flex items-center justify-center bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-lg"
                >
                  <Home className="w-3.5 h-3.5 text-amber-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                  title="Account Settings"
                  aria-label="Account Settings"
                  className="w-8 h-8 inline-flex items-center justify-center text-[#A1A1AA] hover:text-amber-400 bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-lg"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="w-8 h-8 inline-flex items-center justify-center text-[#A1A1AA] hover:text-white bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-lg"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-[248px] flex flex-col min-w-0">
        {/* Top Bar Contract */}
        <header className="h-16 px-4 sm:px-8 border-b border-[#222227] flex items-center justify-between gap-4 sticky top-0 z-30 bg-[#09090B]/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 text-[#A1A1AA] hover:text-white"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-[#A1A1AA] hidden sm:inline">
                AS ROUTER
              </span>
              <span className="text-[#4B5563] hidden sm:inline">/</span>
              <span className="font-medium text-white truncate">
                {activeNavLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={async () => {
                const baseUrl =
                  workspace?.environment.gatewayEndpoint ||
                  (typeof window !== "undefined"
                    ? `${window.location.origin}/v1`
                    : "");
                if (!baseUrl) return;
                await navigator.clipboard.writeText(baseUrl);
                setCopiedBaseUrl(true);
                notify("Base URL copied.", "success");
                setTimeout(() => setCopiedBaseUrl(false), 1800);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copiedBaseUrl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#A1A1AA]" />
                  <span className="sm:hidden">Copy URL</span>
                  <span className="hidden sm:inline">Copy Base URL</span>
                </>
              )}
            </button>

            {activeTab !== "keys" && (
              <button
                type="button"
                onClick={() => {
                  navigateTab("keys");
                  setOpenCreateKeyCounter((c) => c + 1);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-amber-400" />
                <span className="sm:hidden">New Key</span>
                <span className="hidden sm:inline">New API Key</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-8 py-6 max-w-[1280px] w-full mx-auto">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.message}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className={`mb-5 px-4 py-3 rounded-lg border text-xs flex items-center justify-between ${
                  toast.tone === "error"
                    ? "bg-red-500/10 border-red-500/30 text-red-300"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                }`}
              >
                <span>{toast.message}</span>
                <button
                  type="button"
                  onClick={() => setToast(null)}
                  className="text-current opacity-70 hover:opacity-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {loadError && (
            <div className="mb-5 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300 flex items-center justify-between">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={fetchBootstrap}
                className="underline font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {loadingWorkspace && !workspace ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="h-28 bg-[#111114] border border-[#222227] rounded-lg animate-pulse"
                  />
                ))}
              </div>
              <div className="h-64 bg-[#111114] border border-[#222227] rounded-lg animate-pulse" />
            </div>
          ) : workspace ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                {activeTab === "overview" && (
                  <OverviewView
                    environment={workspace.environment}
                    keys={workspace.keys}
                    connections={workspace.connections}
                    combos={workspace.combos}
                    logs={workspace.logs}
                    activeRoutes={activeRoutes}
                    onNavigate={navigateTab}
                    onRefresh={fetchBootstrap}
                    onNotify={notify}
                  />
                )}
                {activeTab === "providers" && (
                  <ProvidersView
                    connections={workspace.connections}
                    onRefresh={fetchBootstrap}
                    onNotify={notify}
                  />
                )}
                {activeTab === "models" && (
                  <ModelsView
                    connections={workspace.connections}
                    onConnectProvider={() => navigateTab("providers")}
                    onNotify={notify}
                  />
                )}
                {activeTab === "combos" && (
                  <CombosView
                    combos={workspace.combos}
                    connections={workspace.connections}
                    wildcards={workspace.wildcards}
                    onRefresh={fetchBootstrap}
                    onNotify={notify}
                  />
                )}
                {activeTab === "keys" && (
                  <ApiKeysView
                    keys={workspace.keys}
                    combos={workspace.combos}
                    gatewayEndpoint={workspace.environment.gatewayEndpoint}
                    openCreateCounter={openCreateKeyCounter}
                    onRefresh={fetchBootstrap}
                    onNotify={notify}
                  />
                )}
                {activeTab === "logs" && (
                  <LogsView
                    logs={workspace.logs}
                    sseConnected={sseConnected}
                    streamPaused={streamPaused}
                    onTogglePause={() => setStreamPaused((p) => !p)}
                    onClearLogs={handleClearLogs}
                    onOpenPlayground={() => navigateTab("playground")}
                  />
                )}
                {activeTab === "playground" && (
                  <PlaygroundView
                    combos={workspace.combos}
                    connections={workspace.connections}
                    onRefresh={fetchBootstrap}
                    onNotify={notify}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          ) : null}
        </main>
      </div>

      <AnimatePresence>
        {settingsOpen && (
          <AccountSettingsModal
            userName={session.user.name}
            userEmail={session.user.email}
            hasPassword={workspace?.user?.hasPassword ?? false}
            authProviders={workspace?.user?.authProviders ?? []}
            onClose={() => setSettingsOpen(false)}
            onUpdated={async () => {
              await refetch();
            }}
            onNotify={notify}
          />
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}
