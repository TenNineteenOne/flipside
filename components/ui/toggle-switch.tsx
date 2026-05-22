"use client"

import { hexToRgba } from "@/lib/color-utils"

const DEFAULT_TINT = "#8b5cf6"

interface ToggleSwitchProps {
  checked: boolean
  onClick: () => void
  tint?: string
}

export function ToggleSwitch({ checked, onClick, tint = DEFAULT_TINT }: ToggleSwitchProps) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={checked}
      style={{
        width: 48,
        height: 28,
        borderRadius: 14,
        border: 0,
        cursor: "pointer",
        flexShrink: 0,
        background: checked ? tint : "rgba(255,255,255,0.10)",
        position: "relative",
        transition: "background 0.2s",
        boxShadow: checked ? `0 0 16px ${hexToRgba(tint, 0.45)}` : "none",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "#fff",
          position: "absolute",
          top: 3,
          left: checked ? 23 : 3,
          transition: "left 0.2s",
        }}
      />
    </button>
  )
}
