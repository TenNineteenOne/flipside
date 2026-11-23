"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { PlatformPicker } from "@/components/settings/platform-picker"
import { patchSettings } from "@/lib/settings/patch-settings"
import type { MusicPlatform } from "@/lib/music-links"

interface PlatformPanelProps {
  initialMusicPlatform: MusicPlatform
}

export function PlatformPanel({ initialMusicPlatform }: PlatformPanelProps) {
  const [musicPlatform, setMusicPlatform] = useState<MusicPlatform>(initialMusicPlatform)

  // Saves run one at a time in tap order (as createFameWriter in discovery-panel), so an older
  // PATCH can never land after a newer one; only the newest failure rolls back, to the last saved value.
  const saves = useRef({ chain: Promise.resolve(), latest: 0, confirmed: initialMusicPlatform })

  function handleMusicPlatformChange(next: MusicPlatform) {
    if (next === musicPlatform) return
    setMusicPlatform(next)
    const s = saves.current
    const id = ++s.latest
    s.chain = s.chain.then(() => patchSettings({ preferredMusicPlatform: next })).then(
      () => {
        s.confirmed = next
        toast.success("Saved")
      },
      () => {
        if (id === s.latest) setMusicPlatform(s.confirmed)
        toast.error("Failed to save preference")
      },
    )
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Where do you listen?</div>
      <div className="fs-card col gap-12">
        <PlatformPicker value={musicPlatform} onChange={handleMusicPlatformChange} />
      </div>
    </div>
  )
}
