import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { FeedClient } from "@/components/feed/feed-client"
import { RecommendationsLoader } from "@/components/feed/recommendations-loader"

interface Rec {
  spotify_artist_id: string
  artist_data: { 
    id: string; 
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

  // Look up user row (created during sign-in via credentials provider)
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle()

  if (userError) {
    console.log(`[feed-page] user lookup err="${userError.message}" userId=${userId}`)
    throw new Error(`Failed to load your account: ${userError.message}`)
  }
  if (!user) {
    redirect("/sign-in")
  }

  // Fetch cached recommendations
  const { data: recs, error: recsError } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why")
    .eq("user_id", user.id)
    .is("seen_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("score", { ascending: false })
    .limit(20)

  if (recsError) {
    console.log(`[feed-page] recs err="${recsError.message}" userId=${user.id}`)
    throw new Error(`Failed to load recommendations: ${recsError.message}`)
  }

  // Filter out entries missing essential artist data
  const validRecs = (recs ?? []).filter(
    (r: { artist_data?: { id?: string; name?: string } }) => r.artist_data?.id && r.artist_data?.name
  ) as Rec[]

  // No valid recommendations — client component triggers generation and refreshes
  if (validRecs.length === 0) {
    return <RecommendationsLoader />
  }

  // Fetch tracks for the recommendations
  const artistIds = validRecs.map((r) => r.spotify_artist_id)
  
  const { data: tracksCache } = await supabase
    .from("artist_tracks_cache")
    .select("spotify_artist_id, tracks")
    .in("spotify_artist_id", artistIds)

  const tracksMap = new Map<string, Rec["artist_data"]["topTracks"]>()
  for (const row of tracksCache ?? []) {
    tracksMap.set(row.spotify_artist_id, (row.tracks as Rec["artist_data"]["topTracks"]) ?? [])
  }

  const recsWithColor = validRecs.map((rec) => {
    rec.artist_data.topTracks = tracksMap.get(rec.spotify_artist_id) ?? []
    const artist_color = (rec.artist_data as Record<string, unknown>).artist_color as string | null ?? null
    return { ...rec, artist_color }
  })

  return <FeedClient recommendations={interleave(recsWithColor)} />
}
