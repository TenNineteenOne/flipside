import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import {
  buildExploreRails,
  type RailKey,
  type RailWhy,
} from "@/lib/recommendation/explore-engine"
import { ExploreClient, type RailPayload } from "@/components/explore/explore-client"
import type { RailArtist } from "@/components/explore/rail"
import {
  DEFAULT_MUSIC_PLATFORM,
  isMusicPlatform,
  type MusicPlatform,
} from "@/lib/music-links"

interface ArtistData {
  id: string
  name: string
  genres?: string[]
  imageUrl?: string | null
  popularity?: number
  artist_color?: string | null
}

const RAIL_TITLES: Record<RailKey, { title: string; subtitle: string; empty: string }> = {
  adjacent: {
    title: "Adjacent to your taste",
    subtitle: "One hop from what you already love",
    empty: "Pick a few genres or artists first — this rail grows with your taste.",
  },
  outside: {
    title: "Totally outside your taste",
    subtitle: "Genres you've never touched",
    empty: "Coming soon — listen a little so we know what's outside.",
  },
  wildcards: {
    title: "From your wildcards",
    subtitle: "Deep cuts inspired by your thumbs-ups",
    empty: "Thumbs-up an artist and a wildcard rail will appear.",
  },
  leftfield: {
    title: "Left-field wildcards",
    subtitle: "Random leaves from the sonic map",
    empty: "Nothing yet — regenerate to sample the map.",
  },
}

export default async function ExplorePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const userId = session.user.id
  const supabase = createServiceClient()

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, adventurous, preferred_music_platform")
    .eq("id", userId)
    .maybeSingle()

  if (userErr) {
    console.error("[explore-page] user lookup err", userErr.message)
    throw new Error(`Failed to load your account: ${userErr.message}`)
  }
  if (!user) redirect("/sign-in")

  const musicPlatform: MusicPlatform = isMusicPlatform(user.preferred_music_platform)
    ? user.preferred_music_platform
    : DEFAULT_MUSIC_PLATFORM
  const adventurous = !!user.adventurous

  // Load saves so the initial render marks existing saves correctly.
  const { data: savesRows } = await supabase
    .from("saves")
    .select("spotify_artist_id")
    .eq("user_id", user.id)
  const initialSavedIds = (savesRows ?? []).map((r) => r.spotify_artist_id as string)

  // Build (or return cached) rails. In P2.1 rail generators return empty
  // results; subsequent issues fill them in. `buildExploreRails` handles cache
  // read + parallel generation + upsert.
  const accessToken = (await getSpotifyClientToken()) ?? ""
  const { rails } = await buildExploreRails({
    userId: user.id,
    accessToken,
    adventurous,
  })

  // Hydrate artist IDs into full Artist records for the UI.
  const allIds = Array.from(new Set(rails.flatMap((r) => r.artistIds)))
  const artistById = new Map<string, ArtistData>()
  if (allIds.length > 0) {
    const { data: rows } = await supabase
      .from("artist_search_cache")
      .select("spotify_artist_id, artist_data, artist_color")
      .in("spotify_artist_id", allIds)
    for (const row of rows ?? []) {
      const a = (row.artist_data ?? {}) as ArtistData
      artistById.set(row.spotify_artist_id as string, {
        ...a,
        id: row.spotify_artist_id as string,
        artist_color: (row.artist_color as string | null) ?? null,
      })
    }
  }

  function hydrate(ids: string[], why: Record<string, RailWhy>): RailArtist[] {
    const out: RailArtist[] = []
    for (const id of ids) {
      const a = artistById.get(id)
      if (!a) continue
      out.push({
        id: a.id,
        name: a.name,
        genres: a.genres ?? [],
        imageUrl: a.imageUrl ?? null,
        popularity: a.popularity ?? 0,
        artistColor: a.artist_color ?? null,
        why: why[id] ? { sourceArtist: why[id].sourceArtist, chain: why[id].chain, tag: why[id].tag, anchor: why[id].anchor } : undefined,
      })
    }
    return out
  }

  const payloads: RailPayload[] = rails.map((r) => {
    const meta = RAIL_TITLES[r.railKey]
    return {
      railKey: r.railKey,
      title: meta.title,
      subtitle: meta.subtitle,
      artists: hydrate(r.artistIds, r.why ?? {}),
      emptyCaption: meta.empty,
    }
  })

  return (
    <ExploreClient
      rails={payloads}
      musicPlatform={musicPlatform}
      adventurous={adventurous}
      initialSavedIds={initialSavedIds}
    />
  )
}
