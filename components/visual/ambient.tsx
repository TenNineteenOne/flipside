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

// Split into two branches so the localStorage + window-event subscription only
// runs when the caller hasn't provided an `adventurous` prop. When the prop is
// provided (e.g. ExploreClient owns its own useAdventurousMode), the storage
// listener here would fire a redundant setState on every toggle that gets
// shadowed by `??` anyway. Keeping the hook out of that branch avoids the
// wasted reconciliation entirely.
export function Ambient({ palette, adventurousPalette, adventurous }: AmbientProps) {
  if (adventurous !== undefined) {
    return <AmbientImpl palette={palette} adventurousPalette={adventurousPalette} adventurous={adventurous} />
  }
  return <AmbientFromStorage palette={palette} adventurousPalette={adventurousPalette} />
}

function AmbientFromStorage({ palette, adventurousPalette }: Omit<AmbientProps, "adventurous">) {
  const { adventurous } = useAdventurousMode(false)
  return <AmbientImpl palette={palette} adventurousPalette={adventurousPalette} adventurous={adventurous} />
}

function AmbientImpl({
  palette,
  adventurousPalette,
  adventurous,
}: {
  palette: string
  adventurousPalette?: string
  adventurous: boolean
}) {
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
