import { apiError } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { createWindowLimiter } from "@/lib/rate-limiter"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { ArtistIdentity, stringSimilarity, SIMILARITY_THRESHOLD } from "@/lib/artist-identity"
import { resolveArtistExternalIds } from "@/lib/artist-identity/musicbrainz"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

// Resolution is low-volume (only when a user SELECTS a Last.fm-only suggestion,
// not per keystroke) and each miss can trigger a MusicBrainz call, so cap it
// tighter than the typeahead search.
const isRateLimited = createWindowLimiter({ max: 30, windowMs: 60_000 })

const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const foldMarks = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
const hasLatin = (s: string) => /\p{Script=Latin}/u.test(s)

/**
 * Client name vs MusicBrainz's canonical name (#175 R6). Diacritic-folded, so
 * "Bjork" matches "Björk". When exactly one side has Latin letters (e.g. "BTS"
 * vs "방탄소년단") bigrams can't compare across scripts, so the check is
 * skipped: the mint still uses MB's name, which is the poisoning protection.
 */
function namesMatch(clientName: string, mbName: string): boolean {
  if (hasLatin(clientName) !== hasLatin(mbName)) return true
  return stringSimilarity(foldMarks(clientName), foldMarks(mbName)) >= SIMILARITY_THRESHOLD
}

/**
 * Resolve a Last.fm-sourced onboarding suggestion to our internal artist uuid,
 * so a seed can persist (`artist_id` is the load-bearing key post Stage-2).
 * Tries the folded `artists` table by exact name first; on a miss (or an
 * ambiguous name), falls back to MusicBrainz url-rels by mbid → a Spotify id,
 * which the doorway resolves/mints by spotify_id to obtain its uuid. Returns 404 when neither yields an id — the
 * client blocks that selection. The returned `id` is a uuid the client relays
 * to the seed routes. Makes ZERO Spotify calls.
 *
 * withAuthedCsrfRoute (not withAuthedJsonRoute): rate-limits BEFORE parsing
 * the body, and its invalid-body error is "Invalid JSON body" (not the
 * wrapper's generic "Invalid JSON") — both need body-parsing kept local.
 */
export const POST = withAuthedCsrfRoute(async ({ userId, request }) => {
  if (isRateLimited(userId)) {
    return apiError("Too many lookups — slow down for a moment", 429)
  }

  let body: { name?: unknown; mbid?: unknown } | null
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  if (typeof body?.name !== "string") {
    return apiError("name must be a string", 400)
  }
  const name = body.name.trim()
  if (name.length === 0 || name.length > 200) {
    return apiError("name must be 1–200 chars", 400)
  }
  const mbid = typeof body.mbid === "string" && MBID_RE.test(body.mbid) ? body.mbid : null

  // Through the artist-identity doorway: an unambiguous `artists` name hit is
  // returned as-is; otherwise (unknown OR ambiguous name) the lookup runs
  // MusicBrainz url-rels by mbid (keyless; 1-req/s limited internally). The
  // url-rel's Spotify id is the evidence that picks/mints the right row — the
  // Last.fm mbid itself is only a hint. No mbid / no Spotify rel → 404.
  //
  // Catalog-poisoning guard (#175 F9): a miss can MINT a shared `artists` row,
  // so the minted name is MusicBrainz's canonical name for the mbid, never the
  // client's free text — and the client's name must match it (the doorway's
  // 0.8 similarity), else 404. Legit picks come from search results, so they match.
  let viaMb = false
  const identity = new ArtistIdentity(createServiceClient())
  const resolved = (
    await identity.resolve([name], async () => {
      if (!mbid) return null
      // ponytail: captures the MB artist `name` from the same url-rels response
      // via the fetchImpl seam; upgrade path: have resolveArtistExternalIds
      // (lib/artist-identity) return the canonical name itself.
      let mbName: string | null = null
      const captureName: typeof fetch = async (input, init) => {
        const res = await fetch(input, init)
        try {
          const body = (await res.clone().json()) as { name?: unknown }
          if (typeof body.name === "string" && body.name.trim()) mbName = body.name.trim()
        } catch { /* non-JSON: fetchArtistRelations reports it */ }
        return res
      }
      const { spotifyId } = await resolveArtistExternalIds(mbid, { fetchImpl: captureName })
      if (!spotifyId || !isValidSpotifyId(spotifyId) || !mbName) return null
      if (!namesMatch(name, mbName)) {
        console.log(`[onboard-resolve] name-mismatch name="${name}" mb="${mbName}" mbid=${mbid}`)
        return null
      }
      viaMb = true
      return { spotifyId, name: mbName }
    })
  ).get(name)
  if (resolved) {
    if (viaMb) console.log(`[onboard-resolve] mb-resolved name="${name}" mbid=${mbid} uuid=${resolved.id}`)
    return Response.json({ id: resolved.id, name, imageUrl: resolved.imageUrl })
  }

  console.log(`[onboard-resolve] unresolved name="${name}" mbid=${mbid ?? "-"}`)
  return apiError("Could not resolve this artist", 404)
})
