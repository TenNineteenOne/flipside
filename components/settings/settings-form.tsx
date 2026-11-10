"use client"

import { ProfilePanel } from "@/components/settings/panels/profile-panel"
import { AccountPanel } from "@/components/settings/panels/account-panel"
import { PlatformPanel } from "@/components/settings/panels/platform-panel"
import { ConnectedSourcesPanel } from "@/components/settings/panels/connected-sources-panel"
import { SeedsPanel } from "@/components/settings/panels/seeds-panel"
import { DiscoveryPanel } from "@/components/settings/panels/discovery-panel"
import type { SpotifyArtist } from "@/components/onboarding/artist-search"
import type { MusicPlatform } from "@/lib/music-links"

interface SettingsFormProps {
  userSeed: string
  initialFameLevel: number
  initialLastfmUsername: string | null
  initialStatsfmUsername: string | null
  initialLastfmArtistCount: number
  initialAdventurous: boolean
  initialSelectedGenres: string[]
  initialSeedArtists: SpotifyArtist[]
  initialMusicPlatform: MusicPlatform
}

export function SettingsForm({
  userSeed,
  initialFameLevel,
  initialLastfmUsername,
  initialStatsfmUsername,
  initialLastfmArtistCount,
  initialAdventurous,
  initialSelectedGenres,
  initialSeedArtists,
  initialMusicPlatform,
}: SettingsFormProps) {
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

          {/* Discovery changes apply to the next batch; nothing is rebuilt (#205). */}
          <DiscoveryPanel initialFameLevel={initialFameLevel} initialAdventurous={initialAdventurous} />

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
