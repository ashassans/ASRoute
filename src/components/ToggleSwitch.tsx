import React from "react";
import { motion } from "motion/react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: ToggleSwitchProps) {
  return (
    <div
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`flex items-center justify-between gap-4 py-1.5 select-none ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium text-ink-2">{label}</div>
        {hint && <div className="text-[11px] text-ink-dim mt-0.5">{hint}</div>}
      </div>
      <motion.button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: 0.92 }}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(!checked);
        }}
        className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-300 ease-out flex items-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
          checked ? "bg-indigo-500" : "bg-subtle"
        }`}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          className={`w-4 h-4 rounded-full bg-white ${
            checked ? "ml-auto" : "mr-auto"
          }`}
        />
      </motion.button>
    </div>
  );
}
