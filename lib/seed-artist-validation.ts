import { isValidSpotifyId } from "@/lib/spotify-ids"

export interface SeedArtistInput {
  id: string
  name: string
  imageUrl: string | null
}

export interface ValidatedSeedArtist {
  id: string
  name: string
  imageUrl: string | null
}

const HTTP_URL = /^https?:\/\//

export function validateSeedArtists(
  input: unknown,
  { min, max }: { min: number; max: number },
): { ok: true; artists: ValidatedSeedArtist[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, error: `artists must be an array of ${min}–${max} entries` }
  }
  if (input.length < min || input.length > max) {
    return { ok: false, error: `artists must be an array of ${min}–${max} entries` }
  }

  const out: ValidatedSeedArtist[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "each artist must be an object" }
    }
    const e = entry as Record<string, unknown>
    if (typeof e.id !== "string" || !isValidSpotifyId(e.id)) {
      return { ok: false, error: "invalid Spotify artist id" }
    }
    if (typeof e.name !== "string") {
      return { ok: false, error: "artist name must be a string" }
    }
    const name = e.name.trim()
    if (name.length === 0 || name.length > 200) {
      return { ok: false, error: "artist name must be 1–200 chars" }
    }
    let imageUrl: string | null = null
    if (e.imageUrl !== null && e.imageUrl !== undefined) {
      if (typeof e.imageUrl !== "string" || e.imageUrl.length > 500 || !HTTP_URL.test(e.imageUrl)) {
        return { ok: false, error: "imageUrl must be an http(s) URL up to 500 chars, or null" }
      }
      imageUrl = e.imageUrl
    }
    out.push({ id: e.id, name, imageUrl })
  }
  return { ok: true, artists: out }
}
