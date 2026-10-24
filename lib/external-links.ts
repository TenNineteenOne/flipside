/**
 * Server-side external-link resolution ("Open in Apple Music").
 *
 * `linkFor` owns the precedence for a platform deep link:
 *   1. a validated platform id on the `artists` row (written by the MusicBrainz
 *      backfill, app/api/cron/mb-backfill),
 *   2. the cached iTunes result in `artist_external_links` (30-day TTL; a fresh
 *      NULL row is a negative cache → search URL, no live call),
 *   3. a live iTunes artist lookup (cached on the way out),
 *   4. the platform's search URL.
 * URL formatting for client-side links stays in lib/music-links.ts (pure).
 */
import { itunesFetch } from "@/lib/music-provider/itunes"
import type { createServiceClient } from "@/lib/supabase/server"

type SupabaseClient = ReturnType<typeof createServiceClient>

/** Platforms with a server-side resolver. */
export type ResolvablePlatform = "apple_music"

export const EXTERNAL_LINK_CACHE_TTL_DAYS = 30

interface ITunesArtistResult {
  artistId: number
  artistName?: unknown
  artistLinkUrl?: unknown
}

interface ITunesResponse {
  resultCount?: number
  results?: ITunesArtistResult[]
}

export function appleMusicSearchUrl(name: string): string {
  return `https://music.apple.com/search?term=${encodeURIComponent(name)}`
}

/** Apple artist ids are numeric (see parseAppleArtistId in musicbrainz.ts). */
const APPLE_ID_RE = /^\d{1,20}$/

function appleArtistUrl(appleId: string): string {
  return `https://music.apple.com/us/artist/${appleId}`
}

/**
 * Normalize for comparison: lowercase, strip diacritics, collapse punctuation/whitespace.
 * Moved verbatim from the /api/open route; swap for the shared artistNameKey later.
 */
function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** Only redirect to URLs we trust to be Apple's. */
export function isSafeAppleUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== "https:") return false
    return u.hostname === "music.apple.com" || u.hostname.endsWith(".apple.com")
  } catch {
    return false
  }
}

/**
 * Live iTunes artist lookup. `null` = no trusted match (negatively cacheable);
 * `undefined` = skipped because the iTunes breaker is open (transient — do
 * NOT negatively cache it).
 */
async function resolveAppleMusicUrl(name: string): Promise<string | null | undefined> {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}` +
    `&entity=musicArtist&limit=1`
  const r = await itunesFetch<ITunesResponse>(url, 5000)
  if (!r.ok) {
    if (r.reason === "breaker") {
      console.log(`[open/apple_music] itunes breaker open, skip name="${name}"`)
      return undefined
    }
    if (r.reason === "http") console.error(`[open/apple_music] itunes status=${r.status} name="${name}"`)
    else if (r.reason === "network") console.error(`[open/apple_music] itunes fetch failed name="${name}" err=${String(r.error)}`)
    else console.error(`[open/apple_music] itunes json parse failed name="${name}" err=${String(r.error)}`)
    return null
  }
  const hit = r.data?.results?.[0]
  if (!hit || typeof hit.artistName !== "string" || typeof hit.artistLinkUrl !== "string") {
    return null
  }
  if (normalizeName(hit.artistName) !== normalizeName(name)) return null
  if (!isSafeAppleUrl(hit.artistLinkUrl)) {
    console.error(`[open/apple_music] unsafe redirect rejected url="${hit.artistLinkUrl}"`)
    return null
  }
  return hit.artistLinkUrl
}

/**
 * Resolve the best external URL for an artist on `platform` (see precedence in
 * the file header). Never throws on DB/iTunes failure — degrades to the next
 * source and ultimately the search URL. `artist.name` must be non-empty.
 */
export async function linkFor(
  supabase: SupabaseClient,
  artist: { id: string; name: string },
  platform: ResolvablePlatform,
  now: number = Date.now(),
): Promise<string> {
  // Only apple_music is resolvable today; the param keeps the seam for more.
  void platform
  const { id: artistId, name } = artist

  const [{ data: row }, { data: cached }] = await Promise.all([
    supabase.from("artists").select("apple_id").eq("id", artistId).maybeSingle(),
    supabase
      .from("artist_external_links")
      .select("apple_music_url, updated_at")
      .eq("artist_id", artistId)
      .maybeSingle(),
  ])

  // 1. Validated id from the MusicBrainz backfill.
  const appleId = row?.apple_id
  if (typeof appleId === "string" && APPLE_ID_RE.test(appleId)) return appleArtistUrl(appleId)

  // 2. Row-existence + freshness check: if we've resolved (or negatively
  // cached) this artist within the TTL window, skip iTunes entirely.
  const cutoff = new Date(now - EXTERNAL_LINK_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  if (cached && cached.updated_at && cached.updated_at > cutoff) {
    return cached.apple_music_url && isSafeAppleUrl(cached.apple_music_url)
      ? cached.apple_music_url
      : appleMusicSearchUrl(name)
  }

  // 3. Live lookup + cache (upsert null on miss to negatively cache until TTL
  // expiry, so repeated clicks on an unresolvable artist don't hammer iTunes).
  const resolved = await resolveAppleMusicUrl(name)
  if (resolved !== undefined) {
    const { error: upsertError } = await supabase
      .from("artist_external_links")
      .upsert(
        { artist_id: artistId, apple_music_url: resolved, updated_at: new Date(now).toISOString() },
        { onConflict: "artist_id" },
      )
    if (upsertError) {
      console.error(`[open/apple_music] cache upsert failed id=${artistId} err="${upsertError.message}"`)
    }
  }

  // 4. Search fallback.
  return resolved ?? appleMusicSearchUrl(name)
}
