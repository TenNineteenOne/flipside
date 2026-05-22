"use client"

import { useState } from "react"
import { Ambient } from "@/components/visual/ambient"
import { hexToRgba } from "@/lib/color-utils"
import { regenerateFeedAndExplore } from "@/lib/settings/regenerate"
import { ACCENT, MINT, ROSE } from "@/lib/settings/obscurity"
import { ProfilePanel } from "@/components/settings/panels/profile-panel"
import { AccountPanel } from "@/components/settings/panels/account-panel"
import { PlatformPanel } from "@/components/settings/panels/platform-panel"
import { ConnectedSourcesPanel } from "@/components/settings/panels/connected-sources-panel"
import { SeedsPanel } from "@/components/settings/panels/seeds-panel"
import { ObscurityPanel } from "@/components/settings/panels/obscurity-panel"
import type { SpotifyArtist } from "@/components/onboarding/artist-search"
import type { MusicPlatform } from "@/lib/music-links"

interface SettingsFormProps {
  userSeed: string
  initialPlayThreshold: number
  initialPopularityCurve: number
  initialLastfmUsername: string | null
  initialStatsfmUsername: string | null
  initialLastfmArtistCount: number
  initialUndergroundMode: boolean
  initialDeepDiscovery: boolean
  initialAdventurous: boolean
  initialSelectedGenres: string[]
  initialSeedArtists: SpotifyArtist[]
  initialMusicPlatform: MusicPlatform
  exampleArtists: { popularity: number; artist: { name: string; popularity: number } | null }[]
}

export function SettingsForm({
  userSeed,
  initialPlayThreshold,
  initialPopularityCurve,
  initialLastfmUsername,
  initialStatsfmUsername,
  initialLastfmArtistCount,
  initialUndergroundMode,
  initialDeepDiscovery,
  initialAdventurous,
  initialSelectedGenres,
  initialSeedArtists,
  initialMusicPlatform,
  exampleArtists,
}: SettingsFormProps) {
  // Shared regeneration gate — multiple panels can trigger a rebuild, but only
  // one may be in-flight at a time. isGenerating is lifted here so the button
  // in ObscurityPanel and the callbacks fired by toggle changes all share state.
  const [isGenerating, setIsGenerating] = useState(false)

  const palette = `
    radial-gradient(50% 40% at 18% 20%, ${hexToRgba(ACCENT, 0.20)} 0%, transparent 70%),
    radial-gradient(55% 45% at 82% 35%, ${hexToRgba(MINT, 0.14)} 0%, transparent 70%),
    radial-gradient(60% 50% at 50% 95%, ${hexToRgba(ROSE, 0.12)} 0%, transparent 70%)
  `

  async function handleRegenerateBoth() {
    await regenerateFeedAndExplore({ isGenerating, setGenerating: setIsGenerating })
  }

  return (
    <>
      <style>{`
        .obs-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }
        .obs-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
        .obs-slider::-moz-range-thumb {
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
      `}</style>

      <Ambient palette={palette} />

      <div>
        <div className="page-head">
          <h1>Settings</h1>
          <span className="sub">
            <span className="serif" style={{ fontSize: 15, color: "var(--text-secondary)" }}>
              Your preferences, politely tuned.
            </span>
            <span style={{ display: "block", marginTop: 4 }}>no email · no password</span>
          </span>
        </div>

        <div className="col gap-16" style={{ marginTop: 8 }}>
          <ProfilePanel userSeed={userSeed} />

          <ObscurityPanel
            initialPlayThreshold={initialPlayThreshold}
            initialPopularityCurve={initialPopularityCurve}
            initialUndergroundMode={initialUndergroundMode}
            initialDeepDiscovery={initialDeepDiscovery}
            initialAdventurous={initialAdventurous}
            exampleArtists={exampleArtists}
            onRegenerate={handleRegenerateBoth}
            isGenerating={isGenerating}
          />

          <SeedsPanel
            initialSelectedGenres={initialSelectedGenres}
            initialSeedArtists={initialSeedArtists}
          />

          <ConnectedSourcesPanel
            initialLastfmUsername={initialLastfmUsername}
            initialStatsfmUsername={initialStatsfmUsername}
            initialLastfmArtistCount={initialLastfmArtistCount}
          />

          <PlatformPanel initialMusicPlatform={initialMusicPlatform} />

          <AccountPanel />
        </div>
      </div>
    </>
  )
}
