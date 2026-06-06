/**
 * Shared rail-payload assembly — used by both the Explore page (server component)
 * and GET /api/explore/rails (read-only route) to guarantee identical
 * shape, titles, subtitles, why text, and hasPlayablePreview filtering.
 *
 * This module is the single source of truth for how a RailResult + hydration
 * map turns into a RailPayload[]. Any change to titling, fallback detection,
 * or filtering must be made here and nowhere else.
 */

import { hasPlayablePreview } from "@/lib/recommendation/confirm-previews"
import {
  RAIL_META_KEY,
  type HydratedRailArtist,
  type RailKey,
  type RailResult,
  type RailWhy,
} from "@/lib/recommendation/explore-engine"
import type { RailArtist } from "@/components/explore/rail"
import type { RailPayload } from "@/components/explore/explore-client"

export const RAIL_TITLES: Record<RailKey, { title: string; subtitle: string; empty: string }> = {
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

export const WILDCARDS_FALLBACK_META = {
  title: "More curveballs",
  subtitle: "Thumbs-up a few artists to unlock your rabbit holes — until then, another blind throw",
  empty: "Nothing yet — regenerate for another throw.",
} as const

/**
 * Hydrate a list of artist IDs into RailArtist[] using the map returned by
 * `buildExploreRails({ hydrate: true })`. Applies the same hasPlayablePreview
 * guard the page uses: legacy rows (topTracks=undefined) pass through; rows
 * with topTracks present but all unplayable are dropped.
 */
export function hydrateRailArtists(
  ids: string[],
  why: Record<string, RailWhy>,
  artistById: Map<string, HydratedRailArtist>,
): RailArtist[] {
  const out: RailArtist[] = []
  for (const id of ids) {
    const a = artistById.get(id)
    if (!a) continue
    // Defensive: drop only when topTracks is present AND confirmed unplayable.
    // Legacy cached rows have topTracks=undefined — keep those.
    if (a.topTracks !== undefined && !hasPlayablePreview(a.topTracks)) continue
    out.push({
      id: a.id,
      name: a.name,
      genres: a.genres ?? [],
      imageUrl: a.imageUrl ?? null,
      popularity: a.popularity ?? 0,
      artistColor: a.artist_color ?? null,
      topTracks: a.topTracks ?? [],
      why: why[id]
        ? {
            sourceArtist: why[id].sourceArtist,
            chain: why[id].chain,
            tag: why[id].tag,
            anchor: why[id].anchor,
          }
        : undefined,
    })
  }
  return out
}

/**
 * Assemble a RailResult[] + hydration map into the RailPayload[] shape that
 * ExploreClient consumes. When `artistById` is empty/undefined (cold start or
 * no hydration), artists arrays will be empty — the client handles that.
 */
export function assembleRailPayloads(
  rails: RailResult[],
  artistById: Map<string, HydratedRailArtist>,
): RailPayload[] {
  return rails.map((r) => {
    const defaultMeta = RAIL_TITLES[r.railKey]
    const fallbackMarker = (r.why ?? {})[RAIL_META_KEY]
    const isWildcardsFallback =
      r.railKey === "wildcards" && fallbackMarker?.fallbackKind === "leftfield-for-wildcards"
    const meta = isWildcardsFallback ? WILDCARDS_FALLBACK_META : defaultMeta
    return {
      railKey: r.railKey,
      title: meta.title,
      subtitle: meta.subtitle,
      artists: hydrateRailArtists(r.artistIds, r.why ?? {}, artistById),
      emptyCaption: meta.empty,
    }
  })
}
