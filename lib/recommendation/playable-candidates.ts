/**
 * PlayableCandidates — the one name → confirmed-playable-artist pipeline
 * shared by the Feed and Explore engines (#175 D2).
 *
 *   resolve(names)  doorway resolve (ArtistIdentity: name-cache → lookup →
 *                   mint) → the caller's `keep` gate (exclusions etc.) →
 *                   preview rehydrate (PreviewStore) — results keyed by the
 *                   INPUT name, never the roster row's spelling.
 *   confirm(items)  confirm-to-target (iTunes-first, Spotify fallback); every
 *                   live outcome is collected.
 *   flush()         persist the collected outcomes to artist_tracks_cache.
 *   playable(...)   Explore's one-shot: resolve → confirm → flush, awaited.
 *
 * Scoring, tiering, picking and provenance stay in the engines: the Feed runs
 * resolve → score/pick → confirm in tiers → flush in `finish()`; Explore
 * calls `playable` per rail and MUST have flushed before rail hydration (the
 * #162 read-after-write).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Artist, Track } from "@/lib/music-provider/types"
import { ArtistIdentity } from "@/lib/artist-identity"
import { resolveArtistsByName, type ResolveDeps, type ResolveResult } from "./resolve-candidates"
import { confirmPlayableTracks, confirmToTarget, type ConfirmPreviewDeps } from "./confirm-previews"
import { PreviewStore, type ConfirmCollector } from "./preview-store"
import { buildEnrichArtist, lastfmResolve } from "@/lib/artist-identity/lastfm-lookup"
import { searchTracksByArtist } from "@/lib/music-provider/itunes"
import { musicProvider } from "@/lib/music-provider/provider"

/** The outbound ports: Last.fm name lookup/enrichment, iTunes, Spotify top-tracks. */
export interface PlayablePorts {
  searchArtists: ResolveDeps["searchArtists"]
  enrichArtist?: ResolveDeps["enrichArtist"]
  searchItunes: ConfirmPreviewDeps["searchItunes"]
  getSpotifyTopTracks: ConfirmPreviewDeps["getSpotifyTopTracks"]
}

/**
 * The live ports, shared by Feed and Explore: Last.fm getInfo as the doorway
 * lookup + enrichment, iTunes-first previews (free, no auth, near-universal 30s
 * clips), Spotify top-tracks as the fallback — keyed on the SPOTIFY id, never
 * the uuid identity; no id (Last.fm-only artist) or no token → no-op to [].
 */
export function livePlayablePorts(accessToken: string): PlayablePorts {
  return {
    searchArtists: (name) => lastfmResolve(name),
    enrichArtist: buildEnrichArtist(),
    searchItunes: (name) => searchTracksByArtist(name, "US", 5),
    getSpotifyTopTracks: (spotifyId) =>
      accessToken && spotifyId
        ? musicProvider.getArtistTopTracks(accessToken, spotifyId, 5, "US").catch(() => [])
        : Promise.resolve([]),
  }
}

export interface ResolveOpts {
  /** Gate applied BEFORE rehydrate/confirm; false = drop. Default: keep all. */
  keep?: (artist: Artist) => boolean
  /** Resolver tuning (defaults: resolve-candidates' own). */
  concurrency?: number
  delayMs?: number
}

export class PlayableCandidates {
  private readonly identity: ArtistIdentity
  private readonly previews: PreviewStore
  private readonly collector: ConfirmCollector

  constructor(supabase: Pick<SupabaseClient, "from">, private readonly ports: PlayablePorts) {
    this.identity = new ArtistIdentity(supabase)
    this.previews = new PreviewStore(supabase)
    this.collector = this.previews.collector()
  }

  /**
   * Resolve names to artists. `artists` holds the kept, rehydrated artists
   * keyed by input name (insertion order = resolver order); `stats` is the raw
   * doorway result (every resolved name, pre-gate) for logs/metrics.
   */
  async resolve(names: string[], opts: ResolveOpts = {}): Promise<{ artists: Map<string, Artist>; stats: ResolveResult }> {
    const unique = [...new Set(names.filter(Boolean))]
    const stats = await resolveArtistsByName(unique, {
      cache: this.identity,
      searchArtists: this.ports.searchArtists,
      enrichArtist: this.ports.enrichArtist,
      mintArtist: (artist) => this.identity.ensure(artist),
      concurrency: opts.concurrency,
      delayMs: opts.delayMs,
    })
    const keep = opts.keep ?? (() => true)
    const artists = new Map([...stats.resolved].filter(([, a]) => keep(a)))
    // Warm positives skip iTunes entirely; fresh confirmed-empty negatives
    // short-circuit (dropped without a re-query).
    await this.previews.rehydrate([...artists.values()].map((artist) => ({ artist })))
    return { artists, stats }
  }

  /** Confirm score-ordered items until `target` are playable; outcomes are collected for `flush`. */
  confirm<T extends { artist: Artist }>(items: T[], target: number): Promise<{ kept: T[]; confirmedCount: number }> {
    return confirmToTarget(items, target, (artist) => this.confirmOne(artist))
  }

  /** Persist every outcome collected so far. Never throws. */
  flush(): Promise<void> {
    return this.collector.flush()
  }

  /**
   * Explore's pipeline: resolve → confirm up to `target` → flush (awaited, so
   * a following hydration read sees the rows). Confirmed artists (topTracks
   * baked) keyed by INPUT name.
   */
  async playable(names: string[], target: number, keep?: (artist: Artist) => boolean): Promise<Map<string, Artist>> {
    const { artists } = await this.resolve(names, { keep })
    const items = [...artists].map(([name, artist]) => ({ name, artist }))
    const { kept } = await this.confirm(items, target)
    await this.flush()
    return new Map(kept.map((k) => [k.name, k.artist]))
  }

  private confirmOne(artist: Artist): Promise<Track[]> {
    return confirmPlayableTracks(
      {
        id: artist.id,
        name: artist.name,
        spotifyId: artist.spotifyId,
        topTracks: artist.topTracks,
        knownEmpty: artist.knownEmpty,
      },
      {
        onConfirmOutcome: this.collector.onConfirmOutcome,
        searchItunes: this.ports.searchItunes,
        getSpotifyTopTracks: this.ports.getSpotifyTopTracks,
      },
    )
  }
}
