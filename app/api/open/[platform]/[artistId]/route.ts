import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"

interface ITunesArtistResult {
  artistId: number
  artistName?: unknown
  artistLinkUrl?: unknown
}

interface ITunesResponse {
  resultCount?: number
  results?: ITunesArtistResult[]
}

const NAME_MAX_LEN = 200
const CACHE_TTL_DAYS = 30

function appleMusicSearchUrl(name: string): string {
  return `https://music.apple.com/search?term=${encodeURIComponent(name)}`
}

/** Normalize for comparison: lowercase, strip diacritics, collapse punctuation/whitespace. */
function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** Only redirect to URLs we trust to be Apple's. */
function isSafeAppleUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== "https:") return false
    return u.hostname === "music.apple.com" || u.hostname.endsWith(".apple.com")
  } catch {
    return false
  }
}

async function resolveAppleMusicUrl(name: string): Promise<string | null> {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}` +
    `&entity=musicArtist&limit=1`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  } catch (err) {
    console.error(`[open/apple_music] itunes fetch failed name="${name}" err=${String(err)}`)
    return null
  }
  if (!res.ok) {
    console.error(`[open/apple_music] itunes status=${res.status} name="${name}"`)
    return null
  }
  let data: ITunesResponse
  try {
    data = (await res.json()) as ITunesResponse
  } catch (err) {
    console.error(`[open/apple_music] itunes json parse failed name="${name}" err=${String(err)}`)
    return null
  }
  const hit = data.results?.[0]
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string; artistId: string }> }
) {
  // proxy.ts already gates /api/* behind auth, but this route uses the
  // service role to touch a shared cache and redirect; require an explicit
  // session here so a future proxy config change can't silently expose it.
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const { platform, artistId } = await params

  if (platform !== "apple_music") {
    return apiError("Direct resolver only supports apple_music", 400)
  }
  if (!isValidSpotifyId(artistId)) {
    return apiError("Invalid artist id", 400)
  }

  const { searchParams } = new URL(request.url)
  const rawName = (searchParams.get("name") ?? "").trim()
  if (!rawName) {
    return NextResponse.redirect("https://music.apple.com/", 302)
  }
  if (rawName.length > NAME_MAX_LEN) {
    return apiError("Artist name too long", 400)
  }
  const name = rawName

  const supabase = createServiceClient()

  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
  const cutoff = new Date(Date.now() - ttlMs).toISOString()

  // Row-existence + freshness check: if we've resolved (or negatively cached)
  // this artist within the TTL window, skip iTunes entirely.
  const { data: cached } = await supabase
    .from("artist_external_links")
    .select("apple_music_url, updated_at")
    .eq("spotify_artist_id", artistId)
    .maybeSingle()

  const isFresh = cached && cached.updated_at && cached.updated_at > cutoff
  if (isFresh) {
    const target = cached.apple_music_url && isSafeAppleUrl(cached.apple_music_url)
      ? cached.apple_music_url
      : appleMusicSearchUrl(name)
    return NextResponse.redirect(target, 302)
  }

  // Resolve + cache (upsert null on miss to negatively cache until TTL expiry,
  // so repeated clicks on an unresolvable artist don't hammer iTunes)
  const resolved = await resolveAppleMusicUrl(name)
  const { error: upsertError } = await supabase
    .from("artist_external_links")
    .upsert(
      {
        spotify_artist_id: artistId,
        apple_music_url: resolved,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "spotify_artist_id" }
    )
  if (upsertError) {
    console.error(`[open/apple_music] cache upsert failed id=${artistId} err="${upsertError.message}"`)
  }

  return NextResponse.redirect(resolved ?? appleMusicSearchUrl(name), 302)
}
