import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";

interface AccountSettingsModalProps {
  userName: string;
  userEmail: string;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function AccountSettingsModal({
  userName,
  userEmail,
  onClose,
  onUpdated,
  onNotify,
}: AccountSettingsModalProps) {
  const [name, setName] = useState(userName);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#111114] border border-[#222227] rounded-xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#222227]">
          <h3 className="font-display text-base font-semibold text-white">
            Account Settings
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#A1A1AA] hover:text-white"
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
            <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
              Email
            </label>
            <input
              type="email"
              disabled
              value={userEmail}
              className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-[#71717A]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
              Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                disabled={savingProfile}
                className="px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] rounded-lg whitespace-nowrap"
              >
                {savingProfile ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </form>

        <form
          onSubmit={handleChangePassword}
          className="mt-6 pt-5 border-t border-[#222227] space-y-3"
        >
          <div className="text-xs font-semibold text-white">Change Password</div>

          <div>
            <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
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
              className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#222227] rounded-lg whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingPassword}
              className="px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] rounded-lg whitespace-nowrap"
            >
              {savingPassword ? "Updating..." : "Update Password"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
