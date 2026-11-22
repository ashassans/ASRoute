import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";

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
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [emailVerificationEnabled, setEmailVerificationEnabled] = useState(false);
  const [forgotStep, setForgotStep] = useState<null | "request" | "verify">(null);
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
        // When email verification is enabled, token is null until OTP is verified
        if (!res.data?.token) {
          savePendingVerifyEmail(normalizedEmail);
          setPendingVerifyEmail(normalizedEmail);
          setOtpCode("");
          setResendCooldown(30);
          setInfo(`A 6-digit verification code was sent to ${normalizedEmail}.`);
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

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA] flex flex-col relative overflow-hidden">
      {/* Subtle amber spotlight backdrop */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 20%, rgba(253,223,138,0.05), transparent 55%)",
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
            {pendingVerifyEmail ? (
              <div>
                <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/25 flex items-center justify-center mb-4">
                  <MailCheck className="w-5 h-5 text-amber-400" />
                </div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-[#FAFAFA] mb-1">
                  Verify your email
                </h1>
                <p className="text-xs text-[#A1A1AA]">
                  Enter the 6-digit code sent to{" "}
                  <span className="text-white font-medium">
                    {pendingVerifyEmail}
                  </span>
                </p>

                {info && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300"
                  >
                    {info}
                  </motion.div>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300"
                  >
                    {error}
                  </motion.div>
                )}

                <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                      6-Digit Verification Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) =>
                        setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3.5 py-3 text-center font-mono text-xl tracking-[0.4em] text-[#FAFAFA] focus:outline-none focus:border-amber-400 transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={verifyingOtp || otpCode.length < 6}
                    className="w-full inline-flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>
                      {verifyingOtp ? "Verifying..." : "Verify & Continue"}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                <div className="mt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      clearPendingVerifyEmail();
                      setPendingVerifyEmail(null);
                      setOtpCode("");
                      setInfo(null);
                      setError(null);
                    }}
                    className="text-[#A1A1AA] hover:text-white transition-colors"
                  >
                    Change email
                  </button>

                  <button
                    type="button"
                    disabled={resendingOtp || resendCooldown > 0}
                    onClick={handleResendOtp}
                    className="text-amber-400 hover:text-amber-300 disabled:opacity-50 font-medium transition-colors"
                  >
                    {resendingOtp
                      ? "Sending..."
                      : resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : "Resend code"}
                  </button>
                </div>
              </div>
            ) : forgotStep ? (
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-[#FAFAFA] mb-1">
                  Reset password
                </h1>
                <p className="text-xs text-[#A1A1AA]">
                  {forgotStep === "request"
                    ? "Enter your account email to receive a 6-digit reset code."
                    : `Enter the 6-digit code sent to ${resetEmail} and choose a new password.`}
                </p>

                {info && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300"
                  >
                    {info}
                  </motion.div>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300"
                  >
                    {error}
                  </motion.div>
                )}

                {forgotStep === "request" ? (
                  <form onSubmit={handleSendResetOtp} className="mt-5 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                        Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3.5 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-amber-400 transition-colors"
                      />
                    </div>
                    {!emailVerificationEnabled && (
                      <p className="text-[11px] text-[#A1A1AA]">
                        Note: Server email OTP delivery is currently disabled until GMAIL_USER and GMAIL_APP_PASSWORD are set.
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={resetSubmitting || !emailVerificationEnabled}
                      className="w-full inline-flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <span>{resetSubmitting ? "Sending..." : "Send Reset Code"}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleConfirmResetPassword} className="mt-5 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                        6-Digit Reset Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        maxLength={6}
                        value={resetOtp}
                        onChange={(e) =>
                          setResetOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.35em] text-[#FAFAFA] focus:outline-none focus:border-amber-400 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                        New Password
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3.5 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-amber-400 transition-colors"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={resetSubmitting}
                      className="w-full inline-flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <span>
                        {resetSubmitting ? "Updating..." : "Reset Password"}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}

                <div className="mt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotStep(null);
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-[#A1A1AA] hover:text-white transition-colors"
                  >
                    Back to Sign In
                  </button>
                  {forgotStep === "verify" && (
                    <button
                      type="button"
                      disabled={resetSubmitting || resendCooldown > 0}
                      onClick={(e) => handleSendResetOtp(e as unknown as React.FormEvent)}
                      className="text-amber-400 hover:text-amber-300 disabled:opacity-50 font-medium transition-colors"
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
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
                        setInfo(null);
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

                {info && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300"
                  >
                    {info}
                  </motion.div>
                )}

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
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-medium text-[#D4D4D8]">
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
                          className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
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

                {googleEnabled && (
                  <>
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
                        {googleLoading
                          ? "Connecting to Google..."
                          : "Continue with Google"}
                      </span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
