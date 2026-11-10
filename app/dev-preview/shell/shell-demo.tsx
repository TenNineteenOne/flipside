"use client"

import { useCallback } from "react"
import { ShellSlot, useShellBadge, useShellShortcuts } from "@/components/shell/shell-context"

/** Exercises the shell's page hooks: a Saved badge, the Shortcuts button and both slots. */
export function ShellDemo() {
  useShellBadge("/saved", 3)
  useShellShortcuts(useCallback(() => console.info("[dev-preview] shortcuts pressed"), []))
  return (
    <>
      <ShellSlot name="top">
        <span style={{ fontSize: 13, color: "var(--fg-3)" }}>top slot</span>
      </ShellSlot>
      <ShellSlot name="rail">
        <p style={{ padding: "0 10px", fontSize: 13, color: "var(--fg-3)" }}>Rail slot (the feed puts Tuning here).</p>
      </ShellSlot>
    </>
  )
}
