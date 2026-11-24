import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, X } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";

interface AccountSettingsModalProps {
  userName: string;
  userEmail: string;
  hasPassword: boolean;
  authProviders: string[];
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function AccountSettingsModal({
  userName,
  userEmail,
  hasPassword,
  authProviders,
  onClose,
  onUpdated,
  onNotify,
}: AccountSettingsModalProps) {
  const [name, setName] = useState(userName);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSavingProfile(true);
    try {
      const res = await authClient.updateUser({ name: name.trim() });
      if (res.error) {
        setError(res.error.message || "Failed to update profile");
        return;
      }
      await onUpdated();
      onNotify("Profile updated.", "success");
    } catch {
      setError("Network error updating profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (res.error) {
        setError(res.error.message || "Failed to change password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onNotify("Password changed.", "success");
      onClose();
    } catch {
      setError("Network error changing password");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-surface border border-hairline rounded-xl p-6 max-h-[90vh] overflow-y-auto outline-none"
      >
        <div className="flex items-center justify-between pb-4 border-b border-hairline">
          <h3
            id="account-settings-title"
            className="font-display text-base font-semibold text-ink"
          >
            Account Settings
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="mt-5 space-y-3">
          <div>
            <label
              htmlFor="account-email"
              className="block text-xs font-medium text-ink-2 mb-1.5"
            >
              Email
            </label>
            <input
              id="account-email"
              type="email"
              disabled
              value={userEmail}
              className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-sm text-ink-muted"
            />
          </div>

          <div>
            <label
              htmlFor="account-name"
              className="block text-xs font-medium text-ink-2 mb-1.5"
            >
              Name
            </label>
            <div className="flex gap-2">
              <input
                id="account-name"
                type="text"
                required
                placeholder="Your display name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 bg-canvas border border-hairline rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                disabled={
                  savingProfile || !name.trim() || name.trim() === userName
                }
                className="px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg whitespace-nowrap"
              >
                {savingProfile ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </form>

        {hasPassword ? (
          <form
            onSubmit={handleChangePassword}
            className="mt-6 pt-5 border-t border-hairline space-y-3"
          >
            <div className="text-xs font-semibold text-ink">
              Change Password
            </div>

            <div>
              <label
                htmlFor="account-current-pw"
                className="block text-xs font-medium text-ink-2 mb-1.5"
              >
                Current Password
              </label>
              <div className="relative">
                <input
                  id="account-current-pw"
                  type={showCurrentPassword ? "text" : "password"}
                  required
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-canvas border border-hairline rounded-lg pl-3 pr-10 py-2 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((v) => !v)}
                  aria-label={
                    showCurrentPassword
                      ? "Hide current password"
                      : "Show current password"
                  }
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink"
                >
                  {showCurrentPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="account-new-pw"
                className="block text-xs font-medium text-ink-2 mb-1.5"
              >
                New Password
              </label>
              <div className="relative">
                <input
                  id="account-new-pw"
                  type={showNewPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-canvas border border-hairline rounded-lg pl-3 pr-10 py-2 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  aria-label={
                    showNewPassword ? "Hide new password" : "Show new password"
                  }
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink"
                >
                  {showNewPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="account-confirm-pw"
                className="block text-xs font-medium text-ink-2 mb-1.5"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="account-confirm-pw"
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-canvas border border-hairline rounded-lg pl-3 pr-10 py-2 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline rounded-lg whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPassword}
                className="px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white rounded-lg whitespace-nowrap"
              >
                {savingPassword ? "Updating..." : "Update Password"}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-6 pt-5 border-t border-hairline space-y-4">
            <div className="rounded-lg border border-hairline bg-canvas px-3.5 py-3">
              <div className="text-xs font-medium text-ink">
                {authProviders.includes("google")
                  ? "Signed in with Google"
                  : "Signed in with External Provider"}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Password login is not enabled for this account. Security and
                password settings are managed through your sign-in provider.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline rounded-lg whitespace-nowrap"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
