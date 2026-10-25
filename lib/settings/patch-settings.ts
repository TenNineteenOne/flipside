import type { MusicPlatform } from "@/lib/music-links"

/** Username formats PATCH /api/settings accepts — shared so onboarding can block a submit the server would 400. */
export const LASTFM_USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,24}$/
export const STATSFM_USERNAME_RE = /^[a-zA-Z0-9._-]{1,30}$/

/** Every key PATCH /api/settings accepts (see app/api/settings/route.ts). */
export interface SettingsPatch {
  playThreshold?: number
  popularityCurve?: number
  lastfmUsername?: string
  statsfmUsername?: string
  selectedGenres?: string[]
  undergroundMode?: boolean
  deepDiscovery?: boolean
  adventurous?: boolean
  preferredMusicPlatform?: MusicPlatform
  onboardingCompleted?: boolean
}

/**
 * PATCH /api/settings rejects the WHOLE patch when selectedGenres is longer
 * than this (app/api/settings/route.ts) — onboarding would lose its
 * completion stamp, platform and Last.fm with it. Pickers cap here.
 */
export const MAX_SELECTED_GENRES = 50

/** The server answered non-2xx. `message` is the server's error text, or "Failed to save". */
export class SettingsSaveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "SettingsSaveError"
  }
}

/**
 * The one client writer for user settings: PATCH /api/settings.
 *
 * Rejects with `SettingsSaveError` when the server answers non-2xx; a network
 * failure or abort (`signal`) rejects with fetch's own error (an abort is
 * `name === "AbortError"`), so callers can tell the three apart.
 */
export async function patchSettings(
  payload: SettingsPatch,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const res = await (opts.fetchImpl ?? fetch)("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: opts.signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new SettingsSaveError((data as { error?: string }).error ?? "Failed to save", res.status)
  }
}
