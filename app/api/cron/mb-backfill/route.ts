/**
 * MusicBrainz backfill worker (#159).
 *
 * Stage 2 / #157 mints artists by NAME with no spotify_id (Spotify-free
 * generation). This worker lazily restores their external ids
 * (spotify_id / mbid / apple_id / deezer_id) via MusicBrainz — WITHOUT calling
 * the Spotify API — so "open in Spotify" links and real images come back.
 *
 * Schedule: every 10 minutes (see vercel.json crons → /api/cron/mb-backfill).
 *
 * 🔴 SINGLE-PROCESS ONLY. The MB 1-req/s limiter in lib/music-provider/
 * musicbrainz.ts is per-process; running this on multiple instances would
 * violate MusicBrainz's anonymous rate limit. The cron drives exactly one
 * invocation at a time, and we cap the per-run batch so a single run can't run
 * long enough to overlap the next.
 *
 * 🔴 AUTH: /api/cron/* is excluded from middleware auth, so the CRON_SECRET
 * check below is the ONLY gate. Pattern copied from
 * app/api/cron/recommendations/route.ts (timingSafeEqual over HMAC digests).
 */
import { createServiceClient } from "@/lib/supabase/server"
import { resolveArtistExternalIds, searchArtistMbid } from "@/lib/music-provider/musicbrainz"
import { createHmac, timingSafeEqual } from "crypto"
import { NextRequest } from "next/server"

// Per-run cap. The MB limiter is 1 req/s and each artist costs up to 2 MB calls
// (search + resolve), so ~20 artists ≈ ~40s of MB work — comfortably inside a
// function timeout and short enough not to overlap the 10-min schedule.
const BATCH_LIMIT = 20

// Don't re-attempt an artist MB already failed to resolve more often than this.
const REATTEMPT_INTERVAL_DAYS = 14

// Postgres unique-violation SQLSTATE — surfaced by PostgREST/supabase-js as
// error.code on a conflicting update.
const PG_UNIQUE_VIOLATION = "23505"

interface ArtistRow {
  id: string
  name: string
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error("[mb-backfill] CRON_SECRET is not set — refusing request")
    return Response.json({ error: "Server misconfigured" }, { status: 500 })
  }
  const authHeader = req.headers.get("authorization") ?? ""
  const expected = `Bearer ${cronSecret}`
  // HMAC both values to fixed-length digests — prevents length-leak from direct comparison.
  const hmac = (v: string) => createHmac("sha256", "cron-compare").update(v).digest()
  if (!timingSafeEqual(hmac(authHeader), hmac(expected))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - REATTEMPT_INTERVAL_DAYS)

  // Queue: artists still missing a spotify_id, never attempted OR attempted long
  // enough ago. nulls-first → never-attempted artists first (matches the partial
  // index from migration 0038).
  const { data: rows, error: queueErr } = await supabase
    .from("artists")
    .select("id, name")
    .is("spotify_id", null)
    .or(`mbid_attempted_at.is.null,mbid_attempted_at.lt.${cutoff.toISOString()}`)
    .order("mbid_attempted_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT)

  if (queueErr) {
    console.error("[mb-backfill] Queue scan error:", queueErr.message)
    return Response.json({ error: "An unexpected error occurred" }, { status: 500 })
  }

  const batch = (rows ?? []) as ArtistRow[]
  const scanned = batch.length
  if (scanned === BATCH_LIMIT) {
    // Per-run cap hit — surface it so a backlog isn't a silent truncation.
    console.log(`[mb-backfill] per-run cap reached (${BATCH_LIMIT}); more artists remain for next run`)
  }

  let resolved = 0
  let conflicts = 0
  let attempted = 0

  // Serial loop — the MB limiter enforces 1 req/s across both calls per artist.
  for (const artist of batch) {
    const stampedAt = new Date().toISOString()
    const update: Record<string, string | null> = { mbid_attempted_at: stampedAt }

    try {
      const mbid = await searchArtistMbid(artist.name)
      if (mbid) {
        const ext = await resolveArtistExternalIds(mbid)
        update.mbid = mbid
        if (ext.appleId) update.apple_id = ext.appleId
        if (ext.deezerId) update.deezer_id = ext.deezerId
        if (ext.spotifyId) update.spotify_id = ext.spotifyId
      }

      const { error: updErr } = await supabase.from("artists").update(update).eq("id", artist.id)

      if (updErr) {
        // A unique conflict means another artists row already holds this mbid or
        // spotify_id — the name-only artist is really a duplicate of an existing
        // one. Don't crash: retry the update WITHOUT the conflicting columns so
        // we still record the rest + stamp attempted_at, and log it for a future
        // merge pass (full artist-merge is OUT OF SCOPE for #159).
        if (updErr.code === PG_UNIQUE_VIOLATION) {
          conflicts++
          if (update.spotify_id) {
            console.warn(
              `[mb-backfill] spotify_id conflict artist=${artist.id} spotify=${update.spotify_id} (skipping spotify_id; needs merge)`,
            )
          }
          if (update.mbid) {
            console.warn(
              `[mb-backfill] mbid conflict artist=${artist.id} mbid=${update.mbid} (skipping mbid; needs merge)`,
            )
          }
          delete update.spotify_id
          delete update.mbid
          const { error: retryErr } = await supabase
            .from("artists")
            .update(update)
            .eq("id", artist.id)
          if (retryErr) {
            console.error(
              `[mb-backfill] retry update failed artist=${artist.id}: ${retryErr.message}`,
            )
            continue
          }
          attempted++
          continue
        }
        console.error(`[mb-backfill] update failed artist=${artist.id}: ${updErr.message}`)
        continue
      }

      attempted++
      if (update.spotify_id) resolved++
    } catch (err) {
      // searchArtistMbid / resolveArtistExternalIds never throw, but guard the
      // DB calls so one bad row doesn't abort the whole run.
      console.error(
        `[mb-backfill] unexpected error artist=${artist.id}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  console.log(
    `[mb-backfill] scanned=${scanned} resolved=${resolved} conflicts=${conflicts} attempted=${attempted}`,
  )
  return Response.json({ scanned, resolved, conflicts, attempted })
}
