"use client"

import { useState } from "react"
import { toast } from "sonner"
import { PlatformPicker } from "@/components/settings/platform-picker"
import { patchSettings } from "@/lib/settings/patch-settings"
import type { MusicPlatform } from "@/lib/music-links"

interface PlatformPanelProps {
  initialMusicPlatform: MusicPlatform
}

export function PlatformPanel({ initialMusicPlatform }: PlatformPanelProps) {
  const [musicPlatform, setMusicPlatform] = useState<MusicPlatform>(initialMusicPlatform)

  async function handleMusicPlatformChange(next: MusicPlatform) {
    if (next === musicPlatform) return
    const prev = musicPlatform
    setMusicPlatform(next)
    try {
      await patchSettings({ preferredMusicPlatform: next })
      toast.success("Saved")
    } catch {
      setMusicPlatform(prev)
      toast.error("Failed to save preference")
    }
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Where do you listen?</div>
      <div className="fs-card col gap-12">
        <PlatformPicker value={musicPlatform} onChange={handleMusicPlatformChange} />
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Pick the app where you want to open and save artists. We&rsquo;ll only link out &mdash;{" "}
          <strong style={{ color: "var(--text-secondary)" }}>we won&rsquo;t ask for your Apple Music or YouTube Music login.</strong>
        </div>
      </div>
    </div>
  )
}
