import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";

interface AuthGateProps {
  initialMode?: "signin" | "signup";
  onBackHome?: () => void;
  onAuthenticated: () => void;
}

export function AuthGate({
  initialMode = "signin",
  onBackHome,
  onAuthenticated,
}: AuthGateProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
  }, [initialMode]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin + "/dashboard",
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to Google sign-in. Make sure GOOGLE_CLIENT_ID is configured."
      );
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === "signup") {
        const res = await authClient.signUp.email({
          name: name.trim() || email.split("@")[0] || "Operator",
          email: email.trim(),
          password,
        });
        if (res.error) {
          setError(res.error.message || "Unable to create account.");
          return;
        }
      } else {
        const res = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (res.error) {
          setError(res.error.message || "Invalid email or password.");
          return;
        }
      }
      onAuthenticated();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Authentication request failed."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA] flex flex-col relative overflow-hidden">
      {/* Subtle amber spotlight backdrop */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 20%, rgba(251,191,36,0.06), transparent 55%)",
        }}
      />

      {/* Minimal Dedicated Auth Top Header */}
      <header className="relative z-10 h-16 border-b border-[#222227] bg-[#09090B]/90 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto h-full px-5 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-display text-base font-bold tracking-tight text-[#FAFAFA]">
            <span className="w-6 h-6 rounded-md bg-amber-400 text-[#09090B] font-mono text-xs font-bold flex items-center justify-center">
              AS
            </span>
            <span>AS ROUTER</span>
          </div>

          {onBackHome && (
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#111114] hover:bg-[#18181B] border border-[#27272A] rounded-lg transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-amber-400" />
              <span>Back to Home</span>
            </button>
          )}
        </div>
      </header>

      {/* Centered Auth Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <div className="bg-[#111114] border border-[#222227] rounded-2xl p-7 shadow-2xl">
            {/* Animated Segmented Sign-In / Sign-Up Switch */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#09090B] border border-[#222227] rounded-lg mb-6">
              {(
                [
                  ["signin", "Sign In"],
                  ["signup", "Create Account"],
                ] as const
              ).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => {
                    setMode(tabId);
                    setError(null);
                  }}
                  className={`relative py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    mode === tabId
                      ? "text-[#FAFAFA]"
                      : "text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  {mode === tabId && (
                    <motion.span
                      layoutId="auth-mode-pill"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 32,
                      }}
                      className="absolute inset-0 bg-[#18181B] border border-[#27272A] rounded-md"
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              ))}
            </div>

            <h1 className="font-display text-2xl font-bold tracking-tight text-[#FAFAFA] mb-1">
              {mode === "signin" ? "Sign in to AS ROUTER" : "Create workspace"}
            </h1>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.2 }}
                >
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Workspace Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3.5 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-amber-400 transition-colors"
                  />
                </motion.div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3.5 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3.5 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || googleLoading}
                className="w-full mt-2 inline-flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap"
              >
                <span>
                  {submitting
                    ? mode === "signin"
                      ? "Signing in..."
                      : "Creating workspace..."
                    : mode === "signin"
                      ? "Sign In to Dashboard"
                      : "Create Workspace"}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#222227]" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                <span className="bg-[#111114] px-2.5 text-[#71717A]">
                  Or continue with
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={submitting || googleLoading}
              onClick={handleGoogleSignIn}
              className="w-full inline-flex items-center justify-center gap-2.5 bg-[#18181B] hover:bg-[#222227] disabled:opacity-60 text-[#FAFAFA] font-medium text-xs py-2.5 px-4 rounded-lg border border-[#27272A] transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>
                {googleLoading ? "Connecting to Google..." : "Continue with Google"}
              </span>
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
