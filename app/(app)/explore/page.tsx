import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import {
  buildExploreRails,
  RAIL_META_KEY,
  type RailKey,
  type RailWhy,
} from "@/lib/recommendation/explore-engine"
import {
  ExploreClient,
  type RailPayload,
  type ChallengePayload,
} from "@/components/explore/explore-client"
import type { RailArtist } from "@/components/explore/rail"
import {
  DEFAULT_MUSIC_PLATFORM,
  isMusicPlatform,
  type MusicPlatform,
} from "@/lib/music-links"
import {
  buildApplicabilityCtx,
  ensureWeeklyChallenge,
} from "@/lib/challenges/engine"

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
    title: "Close cousins",
    subtitle: "One hop over from what you already love",
    empty: "Pick a few genres or artists first — this rail grows with your taste.",
  },
  outside: {
    title: "Uncharted territory",
    subtitle: "Corners of the sonic map you've never set foot in",
    empty: "Listen a little first — we need to know where the edges are.",
  },
  wildcards: {
    title: "Rabbit holes",
    subtitle: "Deep cuts spun off the artists you've starred",
    empty: "Thumbs-up an artist and the rabbit hole opens up.",
  },
  leftfield: {
    title: "Curveballs",
    subtitle: "A blind pick from the sonic map — good luck",
    empty: "Nothing yet — regenerate for another throw.",
  },
}

/**
 * When wildcardsRail has no thumbs-ups to seed from, the engine substitutes
 * a second left-field sample in that slot and marks it via `why.__meta`.
 * The page reads the marker and re-titles the rail so the user doesn't see
 * "From your wildcards" above picks that weren't wildcard-sourced.
 */
const WILDCARDS_FALLBACK_META = {
  title: "More curveballs",
  subtitle: "Thumbs-up a few artists to unlock your rabbit holes — until then, another blind throw",
  empty: "Nothing yet — regenerate for another throw.",
} as const

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
    const defaultMeta = RAIL_TITLES[r.railKey]
    const fallbackMarker = (r.why ?? {})[RAIL_META_KEY]
    const isWildcardsFallback =
      r.railKey === "wildcards" && fallbackMarker?.fallbackKind === "leftfield-for-wildcards"
    const meta = isWildcardsFallback ? WILDCARDS_FALLBACK_META : defaultMeta
    return {
      railKey: r.railKey,
      title: meta.title,
      subtitle: meta.subtitle,
      artists: hydrate(r.artistIds, r.why ?? {}),
      emptyCaption: meta.empty,
    }
  })

  // Weekly challenge: ensure one is assigned for this ISO week, compute
  // applicability from the same signals rails use. Best-effort — if the DB
  // write fails we just render without a challenge card.
  const challenge = await loadChallenge(supabase, user.id)

  return (
    <ExploreClient
      rails={payloads}
      musicPlatform={musicPlatform}
      adventurous={adventurous}
      initialSavedIds={initialSavedIds}
      challenge={challenge}
    />
  )
}

async function loadChallenge(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<ChallengePayload | null> {
  // Pull just enough context to judge applicability. Matches what the engine
  // reads internally but scoped narrower so this stays cheap.
  const [{ data: userRow }, { data: listenedRows }, { data: thumbsUp }] = await Promise.all([
    supabase.from("users").select("selected_genres").eq("id", userId).maybeSingle(),
    supabase.from("listened_artists").select("spotify_artist_id").eq("user_id", userId).limit(500),
    supabase.from("feedback").select("spotify_artist_id").eq("user_id", userId).eq("signal", "thumbs_up").is("deleted_at", null).limit(1),
  ])

  const listenedIds = (listenedRows ?? []).map((r) => r.spotify_artist_id as string)
  const genresById = new Map<string, string[]>()
  for (let i = 0; i < listenedIds.length; i += 200) {
    const chunk = listenedIds.slice(i, i + 200)
    if (chunk.length === 0) continue
    const { data } = await supabase
      .from("artist_search_cache")
      .select("spotify_artist_id, artist_data")
      .in("spotify_artist_id", chunk)
    for (const row of data ?? []) {
      const a = row.artist_data as { genres?: string[] } | null
      genresById.set(row.spotify_artist_id as string, a?.genres ?? [])
    }
  }

  const ctx = buildApplicabilityCtx({
    selectedGenres: (userRow?.selected_genres as string[]) ?? [],
    listened: listenedIds.map((id) => ({ genres: genresById.get(id) ?? [] })),
    hasThumbsUp: (thumbsUp ?? []).length > 0,
  })

  const challenge = await ensureWeeklyChallenge(supabase, userId, ctx)
  if (!challenge || !challenge.template) return null

  return {
    title: challenge.template.title,
    description: challenge.template.description,
    progress: challenge.progress,
    target: challenge.target,
    completed: !!challenge.completedAt,
  }
}
