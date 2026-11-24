import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MailCheck,
  User,
} from "lucide-react";
import { authClient } from "../lib/auth-client.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface AuthGateProps {
  initialMode?: "signin" | "signup";
  onBackHome?: () => void;
  onAuthenticated: () => void;
}

const PENDING_VERIFY_KEY = "asrouter_pending_verify_email";

function loadPendingVerifyEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.sessionStorage.getItem(PENDING_VERIFY_KEY) ||
      window.localStorage.getItem(PENDING_VERIFY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string; expiresAt?: number };
    if (
      typeof parsed?.email === "string" &&
      typeof parsed?.expiresAt === "number" &&
      parsed.expiresAt > Date.now()
    ) {
      return parsed.email;
    }
    window.sessionStorage.removeItem(PENDING_VERIFY_KEY);
    window.localStorage.removeItem(PENDING_VERIFY_KEY);
  } catch {
    // ignore storage errors
  }
  return null;
}

function savePendingVerifyEmail(email: string) {
  if (typeof window === "undefined") return;
  try {
    const payload = JSON.stringify({
      email,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    window.sessionStorage.setItem(PENDING_VERIFY_KEY, payload);
    window.localStorage.setItem(PENDING_VERIFY_KEY, payload);
  } catch {
    // ignore storage errors
  }
}

function clearPendingVerifyEmail() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_VERIFY_KEY);
    window.localStorage.removeItem(PENDING_VERIFY_KEY);
  } catch {
    // ignore storage errors
  }
}

const GATEWAY_HIGHLIGHTS = [
  {
    index: "01",
    title: "Automatic Provider Failover",
    description:
      "Routes requests across fallback tiers cleanly whenever upstream providers return rate limits or errors.",
  },
  {
    index: "02",
    title: "Multi-Key Quota Balancing",
    description:
      "Distribute traffic across multiple upstream API keys with zero code changes to your client SDKs.",
  },
  {
    index: "03",
    title: "Scoped Gateway Access",
    description:
      "Issue isolated workspace keys with per-request latency tracking, search grounding, and model filters.",
  },
];

export function AuthGate({
  initialMode = "signin",
  onBackHome,
  onAuthenticated,
}: AuthGateProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [emailVerificationEnabled, setEmailVerificationEnabled] =
    useState(false);
  const [forgotStep, setForgotStep] = useState<null | "request" | "verify">(
    null
  );
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(
    () => loadPendingVerifyEmail()
  );
  const [otpCode, setOtpCode] = useState("");
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    setForgotStep(null);
    setError(null);
  }, [initialMode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (typeof data.googleOAuthEnabled === "boolean") {
          setGoogleEnabled(data.googleOAuthEnabled);
        }
        if (typeof data.emailVerificationEnabled === "boolean") {
          setEmailVerificationEnabled(data.emailVerificationEnabled);
        }
      })
      .catch(() => {
        // ignore health check errors
      });
    return () => {
      active = false;
    };
  }, []);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin + "/dashboard",
      });
      if (res?.error) {
        setError(
          res.error.message ||
            "Google sign-in is not configured on this server."
        );
        setGoogleLoading(false);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to Google sign-in."
      );
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    const normalizedEmail = email.trim();

    try {
      if (mode === "signup") {
        const res = await authClient.signUp.email({
          name: name.trim() || normalizedEmail.split("@")[0] || "Operator",
          email: normalizedEmail,
          password,
        });
        if (res.error) {
          setError(res.error.message || "Unable to create account.");
          return;
        }
        if (!res.data?.token) {
          savePendingVerifyEmail(normalizedEmail);
          setPendingVerifyEmail(normalizedEmail);
          setOtpCode("");
          setResendCooldown(30);
          setInfo(
            `A 6-digit verification code was sent to ${normalizedEmail}.`
          );
          return;
        }
      } else {
        const res = await authClient.signIn.email({
          email: normalizedEmail,
          password,
        });
        if (res.error) {
          const msg = res.error.message || "Invalid email or password.";
          const isUnverified =
            res.error.code === "EMAIL_NOT_VERIFIED" ||
            res.error.status === 403 ||
            msg.toLowerCase().includes("email not verified");
          if (isUnverified) {
            savePendingVerifyEmail(normalizedEmail);
            setPendingVerifyEmail(normalizedEmail);
            setOtpCode("");
            const otpRes = await authClient.emailOtp.sendVerificationOtp({
              email: normalizedEmail,
              type: "email-verification",
            });
            if (otpRes?.error) {
              setError(
                otpRes.error.message || "Failed to send verification code."
              );
            } else {
              setResendCooldown(30);
              setInfo(
                `Your email is not verified yet. A 6-digit code was sent to ${normalizedEmail}.`
              );
            }
            return;
          }
          setError(msg);
          return;
        }
      }
      clearPendingVerifyEmail();
      onAuthenticated();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Authentication request failed."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVerifyEmail) return;
    const cleanOtp = otpCode.trim();
    if (cleanOtp.length < 6) {
      setError("Enter the 6-digit verification code.");
      return;
    }
    setError(null);
    setInfo(null);
    setVerifyingOtp(true);
    try {
      const res = await authClient.emailOtp.verifyEmail({
        email: pendingVerifyEmail,
        otp: cleanOtp,
      });
      if (res.error) {
        setError(res.error.message || "Invalid or expired verification code.");
        return;
      }
      clearPendingVerifyEmail();
      onAuthenticated();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Verification request failed."
      );
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (!pendingVerifyEmail || resendCooldown > 0) return;
    setError(null);
    setInfo(null);
    setResendingOtp(true);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email: pendingVerifyEmail,
        type: "email-verification",
      });
      if (res.error) {
        setError(res.error.message || "Failed to resend verification code.");
        return;
      }
      setResendCooldown(30);
      setInfo(`A new verification code was sent to ${pendingVerifyEmail}.`);
    } catch {
      setError("Network error resending verification code.");
    } finally {
      setResendingOtp(false);
    }
  };

  const handleSendResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = (resetEmail || email).trim();
    if (!targetEmail) {
      setError("Enter your account email address.");
      return;
    }
    if (!emailVerificationEnabled) {
      setError(
        "Email OTP delivery requires Gmail SMTP (GMAIL_USER / GMAIL_APP_PASSWORD) configured on this server."
      );
      return;
    }
    setError(null);
    setInfo(null);
    setResetSubmitting(true);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email: targetEmail,
        type: "forget-password",
      });
      if (res.error) {
        setError(res.error.message || "Unable to send password reset code.");
        return;
      }
      setResetEmail(targetEmail);
      setResetOtp("");
      setNewPassword("");
      setResendCooldown(30);
      setForgotStep("verify");
      setInfo(`A 6-digit password reset code was sent to ${targetEmail}.`);
    } catch {
      setError("Network error requesting password reset code.");
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleConfirmResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = resetEmail.trim();
    const cleanOtp = resetOtp.trim();
    if (cleanOtp.length < 6) {
      setError("Enter the 6-digit verification code.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError(null);
    setInfo(null);
    setResetSubmitting(true);
    try {
      const res = await authClient.emailOtp.resetPassword({
        email: targetEmail,
        otp: cleanOtp,
        password: newPassword,
      });
      if (res.error) {
        setError(res.error.message || "Invalid or expired reset code.");
        return;
      }
      setForgotStep(null);
      setEmail(targetEmail);
      setPassword("");
      setResetOtp("");
      setNewPassword("");
      setMode("signin");
      setInfo("Password updated. Sign in with your new password.");
    } catch {
      setError("Network error resetting password.");
    } finally {
      setResetSubmitting(false);
    }
  };

  const feedbackBanners = (
    <>
      {info && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
          <span>{info}</span>
        </motion.div>
      )}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
          <span>{error}</span>
        </motion.div>
      )}
    </>
  );

  const googleButtonBlock = googleEnabled ? (
    <div className="mb-5">
      <button
        type="button"
        disabled={submitting || googleLoading}
        onClick={handleGoogleSignIn}
        className="w-full min-h-[44px] inline-flex items-center justify-center gap-2.5 bg-elevated hover:bg-subtle disabled:opacity-60 text-ink font-medium text-sm py-2.5 px-4 rounded-xl border border-hairline-strong hover:border-indigo-400/50 transition-all whitespace-nowrap cursor-pointer"
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
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

      <div className="relative mt-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-hairline" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-surface px-3 text-ink-dim">
            or continue with email
          </span>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col relative overflow-x-hidden">
      {/* Subtle Static Architectural Grid & Radial Ambient Backdrop */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(560px 420px at 20% 10%, rgba(99,102,241,0.12), transparent 70%), radial-gradient(460px 380px at 85% 28%, rgba(56,189,248,0.10), transparent 70%), linear-gradient(to right, rgba(52, 62, 94, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(52, 62, 94, 0.06) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 100% 100%, 56px 56px, 56px 56px",
        }}
      />

      {/* Minimal Top Bar */}
      <header className="relative z-10 h-16 border-b border-hairline bg-surface">
        <div className="max-w-[1200px] mx-auto h-full px-5 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 font-display text-base font-bold tracking-tight text-ink whitespace-nowrap shrink-0">
            <img
              src="/assets/as-logo.svg"
              alt="AS ROUTER"
              className="h-5 w-auto object-contain shrink-0 drop-shadow-[0_0_10px_rgba(56,189,248,0.28)]"
            />
            <span>AS ROUTER</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            {onBackHome && (
              <button
                type="button"
                onClick={onBackHome}
                className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-ink-2 hover:text-ink bg-surface hover:bg-elevated border border-hairline-strong rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-sky-400" />
                <span>Back to Home</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Split-Layout Container */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-5 sm:px-8 py-10 lg:py-14">
        <div className="w-full max-w-[1060px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Left Editorial Showcase Panel (Desktop) */}
          <motion.section
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="hidden lg:flex lg:col-span-6 flex-col justify-center space-y-8 pr-4"
          >
            <div className="space-y-4">
              <img
                src="/assets/as-logo.svg"
                alt="AS ROUTER"
                className="h-8 w-auto object-contain drop-shadow-[0_0_18px_rgba(99,102,241,0.32)]"
              />
              <h2
                className="font-display font-bold tracking-tight text-ink leading-[1.12]"
                style={{
                  fontSize: "clamp(2rem, 3.1vw, 2.75rem)",
                  textWrap: "balance",
                }}
              >
                One unified gateway for every AI model.
              </h2>
              <p className="text-sm leading-relaxed text-ink-muted max-w-md">
                Sign in to configure upstream providers, build smart failover
                combos, test web-grounded prompts, and manage workspace API keys.
              </p>
            </div>

            <div className="divide-y divide-hairline border-t border-b border-hairline">
              {GATEWAY_HIGHLIGHTS.map((item) => (
                <div key={item.index} className="py-4 flex items-start gap-4">
                  <span className="font-mono text-xs font-semibold text-indigo-400 tabular-nums pt-0.5 shrink-0">
                    {item.index}.
                  </span>
                  <div className="space-y-1">
                    <h3 className="font-display text-sm font-semibold text-ink">
                      {item.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-ink-muted font-mono">
              <span>OpenAI-Compatible Endpoint</span>
              <span className="text-sky-300">POST /v1/chat/completions</span>
            </div>
          </motion.section>

          {/* Right Auth Form Column */}
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-6 w-full max-w-[440px] mx-auto"
          >
            <div className="relative overflow-hidden bg-surface border border-hairline-strong rounded-2xl p-6 sm:p-8 auth-card-shadow">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                style={{
                  background:
                    "linear-gradient(90deg, var(--accent-primary) 0%, #38BDF8 35%, #34D399 68%, #F472B6 100%)",
                }}
              />

              <AnimatePresence mode="wait">
                {pendingVerifyEmail ? (
                  <motion.div
                    key="verify-otp"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="w-11 h-11 rounded-xl bg-indigo-500/12 border border-indigo-500/25 flex items-center justify-center mb-4">
                      <MailCheck className="w-5 h-5 text-indigo-400" />
                    </div>
                    <h1 className="font-display text-2xl font-bold tracking-tight text-ink mb-1.5">
                      Verify your email
                    </h1>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      Enter the 6-digit code sent to{" "}
                      <span className="text-ink font-medium">
                        {pendingVerifyEmail}
                      </span>
                    </p>

                    {feedbackBanners}

                    <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
                      <div>
                        <label
                          htmlFor="auth-verify-otp"
                          className="block text-xs font-medium text-ink-2 mb-1.5"
                        >
                          6-Digit Verification Code
                        </label>
                        <input
                          id="auth-verify-otp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          required
                          maxLength={6}
                          placeholder="000000"
                          value={otpCode}
                          onChange={(e) =>
                            setOtpCode(
                              e.target.value.replace(/\D/g, "").slice(0, 6)
                            )
                          }
                          className="w-full min-h-[48px] bg-canvas border border-hairline rounded-xl px-4 py-3 text-center font-mono text-xl tracking-[0.42em] tabular-nums text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                        />
                      </div>

                      <motion.button
                        type="submit"
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        disabled={verifyingOtp || otpCode.length < 6}
                        className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 hover:brightness-110 disabled:opacity-60 text-white font-semibold text-sm py-2.5 px-5 rounded-xl transition-all shadow-[0_8px_24px_rgba(99,102,241,0.28)] whitespace-nowrap cursor-pointer"
                      >
                        <span>
                          {verifyingOtp ? "Verifying..." : "Verify & Continue"}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </motion.button>
                    </form>

                    <div className="mt-5 pt-4 border-t border-hairline flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          clearPendingVerifyEmail();
                          setPendingVerifyEmail(null);
                          setOtpCode("");
                          setInfo(null);
                          setError(null);
                        }}
                        className="text-ink-muted hover:text-ink transition-colors cursor-pointer"
                      >
                        Change email
                      </button>

                      <button
                        type="button"
                        disabled={resendingOtp || resendCooldown > 0}
                        onClick={handleResendOtp}
                        className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50 font-medium tabular-nums transition-colors cursor-pointer"
                      >
                        {resendingOtp
                          ? "Sending..."
                          : resendCooldown > 0
                            ? `Resend in ${resendCooldown}s`
                            : "Resend code"}
                      </button>
                    </div>
                  </motion.div>
                ) : forgotStep ? (
                  <motion.div
                    key={`forgot-${forgotStep}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="w-11 h-11 rounded-xl bg-sky-500/12 border border-sky-500/25 flex items-center justify-center mb-4">
                      <KeyRound className="w-5 h-5 text-sky-400" />
                    </div>
                    <h1 className="font-display text-2xl font-bold tracking-tight text-ink mb-1.5">
                      Reset password
                    </h1>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      {forgotStep === "request"
                        ? "Enter your account email to receive a 6-digit security code."
                        : `Enter the 6-digit code sent to ${resetEmail} and set a new password.`}
                    </p>

                    {feedbackBanners}

                    {forgotStep === "request" ? (
                      <form
                        onSubmit={handleSendResetOtp}
                        className="mt-5 space-y-4"
                      >
                        <div>
                          <label
                            htmlFor="auth-reset-email"
                            className="block text-xs font-medium text-ink-2 mb-1.5"
                          >
                            Email Address
                          </label>
                          <div className="relative group">
                            <Mail className="w-4 h-4 text-ink-dim group-focus-within:text-indigo-400 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              id="auth-reset-email"
                              type="email"
                              required
                              placeholder="you@company.com"
                              value={resetEmail}
                              onChange={(e) => setResetEmail(e.target.value)}
                              className="w-full min-h-[44px] bg-canvas border border-hairline rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                        </div>
                        {!emailVerificationEnabled && (
                          <p className="text-[11px] leading-relaxed text-ink-muted">
                            Server email OTP delivery requires Gmail SMTP
                            credentials configured in the environment.
                          </p>
                        )}
                        <motion.button
                          type="submit"
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          disabled={resetSubmitting || !emailVerificationEnabled}
                          className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 hover:brightness-110 disabled:opacity-60 text-white font-semibold text-sm py-2.5 px-5 rounded-xl transition-all shadow-[0_8px_24px_rgba(99,102,241,0.28)] whitespace-nowrap cursor-pointer"
                        >
                          <span>
                            {resetSubmitting ? "Sending..." : "Send Reset Code"}
                          </span>
                          <ArrowRight className="w-4 h-4" />
                        </motion.button>
                      </form>
                    ) : (
                      <form
                        onSubmit={handleConfirmResetPassword}
                        className="mt-5 space-y-4"
                      >
                        <div>
                          <label
                            htmlFor="auth-reset-otp"
                            className="block text-xs font-medium text-ink-2 mb-1.5"
                          >
                            6-Digit Reset Code
                          </label>
                          <input
                            id="auth-reset-otp"
                            type="text"
                            inputMode="numeric"
                            required
                            maxLength={6}
                            placeholder="000000"
                            value={resetOtp}
                            onChange={(e) =>
                              setResetOtp(
                                e.target.value.replace(/\D/g, "").slice(0, 6)
                              )
                            }
                            className="w-full min-h-[48px] bg-canvas border border-hairline rounded-xl px-4 py-2.5 text-center font-mono text-lg tracking-[0.38em] tabular-nums text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="auth-reset-new-password"
                            className="block text-xs font-medium text-ink-2 mb-1.5"
                          >
                            New Password
                          </label>
                          <div className="relative group">
                            <Lock className="w-4 h-4 text-ink-dim group-focus-within:text-indigo-400 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              id="auth-reset-new-password"
                              type={showNewPassword ? "text" : "password"}
                              required
                              minLength={6}
                              placeholder="Minimum 6 characters"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="w-full min-h-[44px] bg-canvas border border-hairline rounded-xl pl-10 pr-11 py-2.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword((v) => !v)}
                              aria-label={
                                showNewPassword
                                  ? "Hide new password"
                                  : "Show new password"
                              }
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-ink-dim hover:text-ink-2 transition-colors cursor-pointer"
                            >
                              {showNewPassword ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                        <motion.button
                          type="submit"
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          disabled={resetSubmitting}
                          className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 hover:brightness-110 disabled:opacity-60 text-white font-semibold text-sm py-2.5 px-5 rounded-xl transition-all shadow-[0_8px_24px_rgba(99,102,241,0.28)] whitespace-nowrap cursor-pointer"
                        >
                          <span>
                            {resetSubmitting ? "Updating..." : "Reset Password"}
                          </span>
                          <ArrowRight className="w-4 h-4" />
                        </motion.button>
                      </form>
                    )}

                    <div className="mt-5 pt-4 border-t border-hairline flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotStep(null);
                          setError(null);
                          setInfo(null);
                        }}
                        className="text-ink-muted hover:text-ink transition-colors cursor-pointer"
                      >
                        Back to Sign In
                      </button>
                      {forgotStep === "verify" && (
                        <button
                          type="button"
                          disabled={resetSubmitting || resendCooldown > 0}
                          onClick={(e) =>
                            handleSendResetOtp(e as unknown as React.FormEvent)
                          }
                          className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50 font-medium tabular-nums transition-colors cursor-pointer"
                        >
                          {resendCooldown > 0
                            ? `Resend in ${resendCooldown}s`
                            : "Resend code"}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="auth-main"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    {/* Header */}
                    <div className="mb-6">
                      <img
                        src="/assets/as-logo.svg"
                        alt="AS ROUTER"
                        className="h-6 w-auto object-contain mb-3 lg:hidden drop-shadow-[0_0_12px_rgba(99,102,241,0.3)]"
                      />
                      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                        {mode === "signin"
                          ? "Welcome back"
                          : "Create your workspace"}
                      </h1>
                      <p className="mt-1 text-xs text-ink-muted">
                        {mode === "signin"
                          ? "Sign in to manage providers, routing combos, and API keys."
                          : "Set up a private AI gateway workspace in seconds."}
                      </p>
                    </div>

                    {/* Segmented Mode Switch */}
                    <div className="grid grid-cols-2 gap-1 p-1 bg-canvas border border-hairline rounded-xl mb-6">
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
                            setInfo(null);
                          }}
                          className={`relative min-h-[38px] py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                            mode === tabId
                              ? "text-ink"
                              : "text-ink-muted hover:text-ink"
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
                              className="absolute inset-0 bg-elevated border border-hairline-strong rounded-lg shadow-sm"
                            />
                          )}
                          <span className="relative z-10">{label}</span>
                        </button>
                      ))}
                    </div>

                    {googleButtonBlock}

                    {feedbackBanners}

                    <form onSubmit={handleSubmit} className="space-y-4">
                      {mode === "signup" && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <label
                            htmlFor="auth-name"
                            className="block text-xs font-medium text-ink-2 mb-1.5"
                          >
                            Workspace Name
                          </label>
                          <div className="relative group">
                            <User className="w-4 h-4 text-ink-dim group-focus-within:text-indigo-400 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              id="auth-name"
                              type="text"
                              required
                              autoComplete="organization"
                              placeholder="Acme AI Engineering"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full min-h-[44px] bg-canvas border border-hairline rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                          </div>
                        </motion.div>
                      )}

                      <div>
                        <label
                          htmlFor="auth-email"
                          className="block text-xs font-medium text-ink-2 mb-1.5"
                        >
                          Email Address
                        </label>
                        <div className="relative group">
                          <Mail className="w-4 h-4 text-ink-dim group-focus-within:text-indigo-400 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            id="auth-email"
                            type="email"
                            required
                            autoComplete="email"
                            placeholder="you@company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full min-h-[44px] bg-canvas border border-hairline rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label
                            htmlFor="auth-password"
                            className="block text-xs font-medium text-ink-2"
                          >
                            Password
                          </label>
                          {mode === "signin" && (
                            <button
                              type="button"
                              onClick={() => {
                                setResetEmail(email.trim());
                                setForgotStep("request");
                                setError(null);
                                setInfo(null);
                              }}
                              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                            >
                              Forgot password?
                            </button>
                          )}
                        </div>
                        <div className="relative group">
                          <Lock className="w-4 h-4 text-ink-dim group-focus-within:text-indigo-400 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            id="auth-password"
                            type={showPassword ? "text" : "password"}
                            required
                            minLength={6}
                            autoComplete={
                              mode === "signin"
                                ? "current-password"
                                : "new-password"
                            }
                            placeholder={
                              mode === "signin"
                                ? "Enter your password"
                                : "Minimum 6 characters"
                            }
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full min-h-[44px] bg-canvas border border-hairline rounded-xl pl-10 pr-11 py-2.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={
                              showPassword ? "Hide password" : "Show password"
                            }
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-ink-dim hover:text-ink-2 transition-colors cursor-pointer"
                          >
                            {showPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        {mode === "signup" && password.length > 0 && (
                          <p className="mt-1.5 text-[11px] text-ink-muted">
                            {password.length < 6
                              ? `${6 - password.length} more character${6 - password.length === 1 ? "" : "s"} required`
                              : password.length >= 10
                                ? "Strong password length"
                                : "Meets minimum length"}
                          </p>
                        )}
                      </div>

                      <motion.button
                        type="submit"
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        disabled={submitting || googleLoading}
                        className="w-full min-h-[44px] mt-2 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 hover:brightness-110 disabled:opacity-60 text-white font-semibold text-sm py-2.5 px-5 rounded-xl transition-all shadow-[0_10px_28px_-4px_rgba(99,102,241,0.42)] whitespace-nowrap cursor-pointer"
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
                      </motion.button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
