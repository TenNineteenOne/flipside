import { Suspense } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { getCachedUser } from "@/lib/user-cache"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import {
  buildExploreRails,
  RAIL_META_KEY,
  type HydratedRailArtist,
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
import ExploreLoading from "./loading"

const RAIL_TITLES: Record<RailKey, { title: string; subtitle: string; empty: string }> = {
  adjacent: {
    title: "After hours",
    subtitle: "Ambient, hushed, and late-night — a dimmer shelf to browse",
    empty: "Hang tight — the moodier corners are loading.",
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

  const [user, savesResult, accessTokenRaw] = await Promise.all([
    getCachedUser(userId),
    supabase.from("saves").select("spotify_artist_id").eq("user_id", userId),
    getSpotifyClientToken(),
  ])

  if (!user) redirect("/sign-in")

  const musicPlatform: MusicPlatform = isMusicPlatform(user.preferred_music_platform)
    ? user.preferred_music_platform
    : DEFAULT_MUSIC_PLATFORM
  const adventurous = !!user.adventurous
  const undergroundMode = !!user.underground_mode
  const popularityCurve = typeof user.popularity_curve === "number" ? user.popularity_curve : undefined
  const playThreshold = typeof user.play_threshold === "number" ? user.play_threshold : undefined
  const initialSavedIds = (savesResult.data ?? []).map((r) => r.spotify_artist_id as string)
  const accessToken = accessTokenRaw ?? ""

  return (
    <Suspense fallback={<ExploreLoading />}>
      <ExploreRailsSection
        userId={user.id}
        accessToken={accessToken}
        adventurous={adventurous}
        undergroundMode={undergroundMode}
        popularityCurve={popularityCurve}
        playThreshold={playThreshold}
        musicPlatform={musicPlatform}
        initialSavedIds={initialSavedIds}
      />
    </Suspense>
  )
}

interface RailsSectionProps {
  userId: string
  accessToken: string
  adventurous: boolean
  undergroundMode: boolean
  popularityCurve: number | undefined
  playThreshold: number | undefined
  musicPlatform: MusicPlatform
  initialSavedIds: string[]
}

async function ExploreRailsSection({
  userId,
  accessToken,
  adventurous,
  undergroundMode,
  popularityCurve,
  playThreshold,
  musicPlatform,
  initialSavedIds,
}: RailsSectionProps) {
  const supabase = createServiceClient()

  // Fire challenge in parallel but do NOT await it here — we pass the unawaited
  // promise down to ExploreClient, which wraps the challenge slot in Suspense
  // via React 19's `use` hook. Rails render as soon as they're ready; challenge
  // streams in when it finishes. Cold /explore stops waiting on the slower of
  // the two, which is usually the challenge's genre hydration.
  const challengePromise = loadChallenge(supabase, userId)
  const buildResult = await buildExploreRails(
    { userId, accessToken, adventurous, undergroundMode, popularityCurve, playThreshold },
    { hydrate: true },
  )
  const { rails, hydrated } = buildResult
  const artistById: Map<string, HydratedRailArtist> = hydrated ?? new Map()

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

  return (
    <ExploreClient
      rails={payloads}
      musicPlatform={musicPlatform}
      adventurous={adventurous}
      initialSavedIds={initialSavedIds}
      challengePromise={challengePromise}
    />
  )
}

async function loadChallenge(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<ChallengePayload | null> {
  // Best-effort: challenge is a secondary surface, never block the page on it.
  try {
    // getCachedUser is request-scoped — this hits the cache from the main page
    // fetch rather than issuing another users-table query.
    const [userRow, { data: listenedRows }, { data: thumbsUp }] = await Promise.all([
      getCachedUser(userId),
      supabase.from("listened_artists").select("spotify_artist_id").eq("user_id", userId).limit(500),
      supabase.from("feedback").select("spotify_artist_id").eq("user_id", userId).eq("signal", "thumbs_up").is("deleted_at", null).limit(1),
    ])

    const listenedIds = (listenedRows ?? []).map((r) => r.spotify_artist_id as string)
    const genresById = new Map<string, string[]>()

    const chunks: string[][] = []
    for (let i = 0; i < listenedIds.length; i += 200) {
      chunks.push(listenedIds.slice(i, i + 200))
    }
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("artist_search_cache")
          .select("spotify_artist_id, artist_data")
          .in("spotify_artist_id", chunk),
      ),
    )
    for (const { data } of chunkResults) {
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
  } catch (err) {
    console.error("[explore-page] loadChallenge failed", err instanceof Error ? err.message : err)
    return null
  }
}
