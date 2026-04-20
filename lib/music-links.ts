/**
 * Where a user wants "Open in …" links to point. Extending this list later
 * (Tidal, Deezer, Amazon Music) is a one-line change here plus:
 *   - update CHECK constraint on users.preferred_music_platform
 *   - add a case to getArtistLink / getShareableArtistLink below
 *   - add a PLATFORM_META entry
 *   - (if direct resolution is possible) add a branch in app/api/open/[platform]/[artistId]/route.ts
 */
export const SUPPORTED_PLATFORMS = ["spotify", "apple_music", "youtube_music"] as const
export type MusicPlatform = (typeof SUPPORTED_PLATFORMS)[number]

export const DEFAULT_MUSIC_PLATFORM: MusicPlatform = "spotify"

export function isMusicPlatform(v: unknown): v is MusicPlatform {
  return typeof v === "string" && (SUPPORTED_PLATFORMS as readonly string[]).includes(v)
}

export interface PlatformMeta {
  /** Human-readable label — used in button text and tooltips. */
  label: string
  /** Brand hex colour, used for the button background on that platform. */
  brandColor: string
  /** Foreground colour to use on the brand background. */
  brandFg: string
}

export const PLATFORM_META: Record<MusicPlatform, PlatformMeta> = {
  spotify:       { label: "Spotify",       brandColor: "#1db954", brandFg: "#0a0a0a" },
  apple_music:   { label: "Apple Music",   brandColor: "#fa2d48", brandFg: "#ffffff" },
  youtube_music: { label: "YouTube Music", brandColor: "#ff0000", brandFg: "#ffffff" },
}

/**
 * URL the in-app "Open in …" button should navigate to.
 *
 * Spotify is a direct artist page. Apple Music goes through our resolver
 * endpoint so we can call iTunes Search once per artist and cache the result
 * server-side. YouTube Music has no public artist-search API, so we route to
 * their search page — the artist is reliably the top result.
 *
 * Encoding note: `encodeURIComponent` covers apostrophes, ampersands, and
 * non-ASCII characters correctly.
 */
export function getArtistLink(
  platform: MusicPlatform,
  params: { spotifyArtistId: string; artistName: string }
): string {
  const { spotifyArtistId, artistName } = params
  switch (platform) {
    case "spotify":
      return `https://open.spotify.com/artist/${spotifyArtistId}`
    case "apple_music":
      return `/api/open/apple_music/${spotifyArtistId}?name=${encodeURIComponent(artistName)}`
    case "youtube_music":
      return `https://music.youtube.com/search?q=${encodeURIComponent(artistName)}`
  }
}

/**
 * URL the share/copy action should put on the clipboard — must be an absolute
 * URL that works when pasted elsewhere. For Apple Music we can't share the
 * `/api/open/…` path (it's tied to this origin), so we copy the Apple Music
 * search URL as a best-effort universal Apple-Music-side link.
 */
export function getShareableArtistLink(
  platform: MusicPlatform,
  params: { spotifyArtistId: string; artistName: string }
): string {
  const { spotifyArtistId, artistName } = params
  switch (platform) {
    case "spotify":
      return `https://open.spotify.com/artist/${spotifyArtistId}`
    case "apple_music":
      return `https://music.apple.com/search?term=${encodeURIComponent(artistName)}`
    case "youtube_music":
      return `https://music.youtube.com/search?q=${encodeURIComponent(artistName)}`
  }
}
