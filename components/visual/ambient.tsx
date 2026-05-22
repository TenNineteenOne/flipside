"use client"

import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"

interface AmbientProps {
  palette: string
  adventurousPalette?: string
  adventurous?: boolean
}

const DEFAULT_WARM = `
  radial-gradient(70% 55% at 18% 12%, rgba(255,138,46,0.42) 0%, transparent 70%),
  radial-gradient(60% 50% at 85% 28%, rgba(255,74,130,0.36) 0%, transparent 72%),
  radial-gradient(65% 55% at 50% 92%, rgba(255,184,92,0.32) 0%, transparent 75%),
  radial-gradient(55% 45% at 10% 88%, rgba(212,88,176,0.28) 0%, transparent 72%)
`

export function Ambient({ palette, adventurousPalette, adventurous: adventurousProp }: AmbientProps) {
  // When no prop is passed, read from localStorage + listen for sync events via
  // the hook.  The prop still wins when provided (caller-controlled mode).
  const { adventurous: adventurousLS } = useAdventurousMode(false)

  const adventurous = adventurousProp ?? adventurousLS

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: -1,
        transition: "background 0.8s var(--easing)",
        background: adventurous ? (adventurousPalette ?? DEFAULT_WARM) : palette,
      }}
    />
  )
}
