import type { MusicPlatform } from "@/lib/music-links"

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
