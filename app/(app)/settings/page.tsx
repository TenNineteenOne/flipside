import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { SettingsForm } from "@/components/settings/settings-form"
import { DEFAULT_MUSIC_PLATFORM, isMusicPlatform } from "@/lib/music-links"
import { decryptUsername } from "@/lib/crypto/username"

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()
  const { data: user } = await supabase
    .from("users")
    .select("play_threshold, popularity_curve, lastfm_username, statsfm_username, underground_mode, deep_discovery, adventurous, selected_genres, preferred_music_platform")
    .eq("id", userId)
    .maybeSingle()

  let lastfmUsername: string | null = null
  let statsfmUsername: string | null = null
  try {
    lastfmUsername = decryptUsername(user?.lastfm_username ?? null)
  } catch (err) {
    console.error(`[settings-page] lastfm decrypt failed userId=${userId} err="${err instanceof Error ? err.message : err}"`)
  }
  try {
    statsfmUsername = decryptUsername(user?.statsfm_username ?? null)
  } catch (err) {
    console.error(`[settings-page] statsfm decrypt failed userId=${userId} err="${err instanceof Error ? err.message : err}"`)
  }

  let lastfmArtistCount = 0
  if (user?.lastfm_username) {
    const { count } = await supabase
      .from("listened_artists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "lastfm")
    lastfmArtistCount = count ?? 0
  }

  const { data: seedArtistsData } = await supabase
    .from("seed_artists")
    .select("spotify_artist_id, name, image_url, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: true })

  const seedArtists = (seedArtistsData ?? []).map((r) => ({
    id: r.spotify_artist_id,
    name: r.name,
    genres: [] as string[],
    imageUrl: r.image_url,
    popularity: 0,
  }))

  // Pull recent recs to build distinct example artists at anchor popularities
  const { data: recRows } = await supabase
    .from("recommendation_cache")
    .select("artist_data")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200)

  type FeedArtist = { name: string; popularity: number }
  const userArtists: FeedArtist[] = []
  for (const row of recRows ?? []) {
    const data = row.artist_data as { name?: string; popularity?: number } | null
    const pop = typeof data?.popularity === "number" ? data.popularity : null
    if (pop === null || !data?.name) continue
    userArtists.push({ name: data.name, popularity: pop })
  }

  // Hardcode mainstream anchors so the curve preview is an honest reference
  // regardless of the user's (niche-skewed) cache. Niche anchors still prefer
  // a real cached pick when one falls within tolerance of the target.
  const HARDCODED_ANCHORS: Record<number, string> = {
    30: "Hana Vu",
    70: "Phoebe Bridgers",
    100: "Taylor Swift",
  }
  const TOLERANCE = 7
  // Anchors the curve preview renders at (popularity 0–100).
  const anchors = [0, 30, 70, 100]
  const used = new Set<string>()
  const exampleArtists = anchors.map((target) => {
    const hardcoded = HARDCODED_ANCHORS[target]
    if (hardcoded) {
      return { popularity: target, artist: { name: hardcoded, popularity: target } }
    }
    let best: FeedArtist | null = null
    let bestDiff = Infinity
    for (const a of userArtists) {
      if (used.has(a.name)) continue
      const diff = Math.abs(a.popularity - target)
      if (diff < bestDiff) {
        bestDiff = diff
        best = a
      }
    }
    if (best && bestDiff <= TOLERANCE) {
      used.add(best.name)
      return { popularity: target, artist: best }
    }
    return { popularity: target, artist: null }
  })

  return (
    <SettingsForm
      userSeed={userId}
      initialPlayThreshold={user?.play_threshold ?? 5}
      initialPopularityCurve={user?.popularity_curve ?? 0.95}
      initialLastfmUsername={lastfmUsername}
      initialStatsfmUsername={statsfmUsername}
      initialLastfmArtistCount={lastfmArtistCount}
      initialUndergroundMode={user?.underground_mode ?? false}
      initialDeepDiscovery={user?.deep_discovery ?? false}
      initialAdventurous={user?.adventurous ?? false}
      initialSelectedGenres={(user?.selected_genres as string[] | null) ?? []}
      initialSeedArtists={seedArtists}
      initialMusicPlatform={
        isMusicPlatform(user?.preferred_music_platform)
          ? user.preferred_music_platform
          : DEFAULT_MUSIC_PLATFORM
      }
      exampleArtists={exampleArtists}
    />
  )
}
