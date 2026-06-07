import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getCachedUser } from "@/lib/user-cache"
import { FeedClient } from "@/components/feed/feed-client"
import { ExplorePrewarm } from "@/components/feed/explore-prewarm"
import { RecommendationsLoader } from "@/components/feed/recommendations-loader"
import { DEFAULT_MUSIC_PLATFORM, isMusicPlatform, type MusicPlatform } from "@/lib/music-links"
import { hasPlayablePreview } from "@/lib/recommendation/confirm-previews"

interface Rec {
  artist_id: string
  artist_data: {
    id: string;
    spotifyId?: string | null;
    name: string;
    genres: string[]; 
    imageUrl: string | null; 
    popularity: number; 
    topTracks: Array<{
      id: string;
      spotifyTrackId: string | null;
      name: string;
      previewUrl: string | null;
      durationMs: number;
      albumName: string;
      albumImageUrl: string | null;
      source: 'itunes' | 'spotify' | 'deezer';
    }>;
  }
  score: number
  why: { sourceArtists: string[]; genres: string[]; friendBoost: string[] }
}

/** Round-robin interleave by primary source artist so results aren't clustered. */
function interleave(recs: Rec[]): Rec[] {
  const buckets = new Map<string, Rec[]>()
  for (const rec of recs) {
    const key = rec.why?.sourceArtists?.[0] ?? "__none"
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(rec)
  }
  const groups = Array.from(buckets.values())
  const out: Rec[] = []
  let i = 0
  while (out.length < recs.length) {
    const g = groups[i % groups.length]
    if (g.length > 0) out.push(g.shift()!)
    i++
    if (groups.every((g) => g.length === 0)) break
  }
  return out
}

export default async function FeedPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  // Look up user row (request-scoped cache — layout.tsx already fetched this)
  const user = await getCachedUser(userId)
  if (!user) {
    redirect("/sign-in")
  }

  // Fetch cached recommendations
  const { data: recs, error: recsError } = await supabase
    .from("recommendation_cache")
    .select("artist_id, artist_data, score, why")
    .eq("user_id", user.id)
    .is("seen_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("score", { ascending: false })
    .limit(20)

  if (recsError) {
    console.error(`[feed-page] recs err="${recsError.message}" userId=${user.id}`)
    throw new Error(`Failed to load recommendations: ${recsError.message}`)
  }

  // Filter out entries missing essential artist data
  const validRecs = (recs ?? []).filter(
    (r: { artist_data?: { id?: string; name?: string } }) => r.artist_data?.id && r.artist_data?.name
  ) as Rec[]

  const musicPlatform: MusicPlatform = isMusicPlatform(user.preferred_music_platform)
    ? user.preferred_music_platform
    : DEFAULT_MUSIC_PLATFORM

  // No valid recommendations — client component triggers generation and refreshes
  if (validRecs.length === 0) {
    return (
      <>
        <RecommendationsLoader />
        <ExplorePrewarm />
      </>
    )
  }

  // Fetch tracks + signal counts in parallel — counts depend only on user.id,
  // tracks fetch needs artistIds (already known). Saves one DB round-trip vs.
  // running tracks sequentially before the count Promise.all.
  const artistIds = validRecs.map((r) => r.artist_id)

  const [
    { data: tracksCache },
    { count: artistCount },
    { count: feedbackCount },
    { count: saveCount },
  ] = await Promise.all([
    supabase
      .from("artist_tracks_cache")
      .select("artist_id, tracks")
      .in("artist_id", artistIds),
    supabase.from("listened_artists").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("feedback").select("*", { count: "exact", head: true }).eq("user_id", user.id).is("deleted_at", null),
    supabase.from("saves").select("*", { count: "exact", head: true }).eq("user_id", user.id),
  ])

  const tracksMap = new Map<string, Rec["artist_data"]["topTracks"]>()
  for (const row of tracksCache ?? []) {
    tracksMap.set(row.artist_id, (row.tracks as Rec["artist_data"]["topTracks"]) ?? [])
  }

  const recsWithColor = validRecs.map((rec) => {
    // Prefer the previews baked into artist_data during resolution (#134); fall
    // back to artist_tracks_cache for legacy rows written before the bake.
    const baked = rec.artist_data.topTracks
    rec.artist_data.topTracks =
      baked && baked.length > 0 ? baked : tracksMap.get(rec.artist_id) ?? []
    const artist_color = (rec.artist_data as Record<string, unknown>).artist_color as string | null ?? null
    return { ...rec, artist_color }
  })

  // Defensive: never render a dead card. New rows are dropped at write time if
  // they have no preview, but a legacy row (written before previews were baked)
  // with no playable track in artist_data or the tracks cache is filtered here.
  const playableRecs = recsWithColor.filter((rec) => hasPlayablePreview(rec.artist_data.topTracks))

  const signalCount = (artistCount ?? 0) + (feedbackCount ?? 0) + (saveCount ?? 0)

  return (
    <>
      <FeedClient recommendations={interleave(playableRecs)} musicPlatform={musicPlatform} signalCount={signalCount} />
      <ExplorePrewarm />
    </>
  )
}
