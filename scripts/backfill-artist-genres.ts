/**
 * Backfill real genres + popularity onto cached artists via MusicBrainz +
 * Last.fm. Does NOT touch Spotify — sidesteps Dev-Mode quota entirely.
 *
 * Both `artist_search_cache` and `recommendation_cache` store `artist_data`
 * JSON that was built from Spotify /search, which returns genres:[] and
 * popularity:0. This script fills in real values.
 *
 * Pipeline:
 *   Phase 1 (MusicBrainz, 1 req/s ≈ 62 min for 1,871 artists):
 *     name → /artist?query=… → pick best MBID → /artist/{mbid}?inc=genres+tags
 *     MB `genres` is editor-curated; fall back to MB `tags` within MB if empty.
 *
 *   Phase 2 (Last.fm, 2 req/s ≈ 16 min):
 *     name → artist.getInfo → { listeners, tags[] }
 *     listeners drives popularity; tags are a final fallback genre source.
 *
 *   Phase 3 (Merge + Write):
 *     genres = MB.genres || MB.tags || Last.fm.tags (filtered)
 *     popularity = clamp(round((log10(listeners+1) - 2) × 15), 0, 100)
 *     Update every row in both tables keyed by spotify_artist_id.
 *
 * Every artist is checkpointed after its call — Ctrl+C is safe, re-run to
 * resume. Phase transitions are also checkpointed.
 *
 * Usage:
 *   npx tsx scripts/backfill-artist-genres.ts               # full run
 *   npx tsx scripts/backfill-artist-genres.ts --dry-run     # don't write
 *   npx tsx scripts/backfill-artist-genres.ts --fresh       # ignore checkpoint
 *   npx tsx scripts/backfill-artist-genres.ts --phase=mb    # only phase 1
 *   npx tsx scripts/backfill-artist-genres.ts --phase=lastfm
 *   npx tsx scripts/backfill-artist-genres.ts --phase=write
 *
 * Env (loaded from .env.local):
 *   LASTFM_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { config as loadEnv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Artist } from '../lib/music-provider'

// ── Config ───────────────────────────────────────────────────────────────

const MB_BASE = 'https://musicbrainz.org/ws/2'
const MB_RATE_MS = 1000                // MB enforces 1 req/s
const MB_USER_AGENT = 'Flipside/0.1.0 ( fluxuate27@gmail.com )'
const MB_MIN_SCORE = 85                // accept match if MB score >= this

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0'
const LASTFM_RATE_MS = 500             // 2 req/s

const HTTP_TIMEOUT_MS = 12000
const PAGE_SIZE = 1000                 // Supabase row page size
const CHECKPOINT_EVERY_N_ARTISTS = 25
const CHECKPOINT_PATH = join(process.cwd(), 'scripts', 'backfill-artist-genres.checkpoint.json')
const CHECKPOINT_SCHEMA = 2

// Last.fm non-genre tag blocklist. Conservative — only obvious non-genre.
const LASTFM_TAG_BLOCKLIST = new Set<string>([
  'seen live', 'favorite', 'favourite', 'favorites', 'favourites',
  'favorite artists', 'favourite artists', 'love at first listen',
  'awesome', 'amazing', 'beautiful', 'check out', 'albums i own',
  'female vocalists', 'male vocalists', 'female vocalist', 'male vocalist',
  'spotify', 'mp3', 'bandcamp', 'youtube',
  'my music', 'my favorites', 'good', 'great', 'best',
])
const LASTFM_TAG_ERA_RE = /^(pre-)?\d{2,4}s$/  // "90s", "2000s", "pre-1970s"
const MAX_GENRES_PER_ARTIST = 5

// ── Types ────────────────────────────────────────────────────────────────

interface ArtistRef {
  spotifyId: string
  name: string
}

interface MbResult {
  mbid: string | null
  score: number
  genres: string[]
  tags: string[]
}

interface LastfmResult {
  listeners: number
  tags: string[]
}

interface Checkpoint {
  schema: number
  uniqueArtists: ArtistRef[]
  mbResults: Record<string, MbResult>
  lastfmResults: Record<string, LastfmResult>
  writtenIds: string[]
  stats: {
    searchCacheRows: number
    recommendationCacheRows: number
    uniqueIds: number
    mbMatched: number
    mbUnresolved: number
    lastfmMatched: number
    lastfmUnresolved: number
    searchCacheUpdated: number
    recCacheUpdated: number
  }
  startedAt: string
  lastSavedAt: string
}

interface CliArgs {
  dryRun: boolean
  fresh: boolean
  phase: 'all' | 'mb' | 'lastfm' | 'write'
}

// ── CLI args ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false
  let fresh = false
  let phase: CliArgs['phase'] = 'all'
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') { dryRun = true; continue }
    if (a === '--fresh') { fresh = true; continue }
    const m = a.match(/^--phase=(mb|lastfm|write|all)$/)
    if (m) { phase = m[1] as CliArgs['phase']; continue }
    if (a === '-h' || a === '--help') {
      console.log('Usage: backfill-artist-genres.ts [--dry-run] [--fresh] [--phase=mb|lastfm|write|all]')
      process.exit(0)
    }
    throw new Error(`Unknown arg: ${a}`)
  }
  return { dryRun, fresh, phase }
}

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) { console.error(`Missing env: ${key}`); process.exit(1) }
  return v
}

// ── Rate limiter ─────────────────────────────────────────────────────────

function makeGate(minIntervalMs: number) {
  let last = 0
  return async function gate<T>(fn: () => Promise<T>): Promise<T> {
    const elapsed = Date.now() - last
    if (elapsed < minIntervalMs) {
      await new Promise((r) => setTimeout(r, minIntervalMs - elapsed))
    }
    last = Date.now()
    return fn()
  }
}

// ── Checkpoint ───────────────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_PATH)) return null
  try {
    const parsed = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8')) as Checkpoint
    if (parsed.schema !== CHECKPOINT_SCHEMA) {
      console.warn(`[backfill] schema mismatch (have=${parsed.schema}, want=${CHECKPOINT_SCHEMA}) — ignoring`)
      return null
    }
    return parsed
  } catch (err) {
    console.warn(`[backfill] checkpoint read failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  cp.lastSavedAt = new Date().toISOString()
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2))
}

// ── Supabase paginated reads ─────────────────────────────────────────────

async function readAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  pkColumn: string
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(pkColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as T[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

// ── Name normalization for matching ──────────────────────────────────────

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^\w\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── MusicBrainz ──────────────────────────────────────────────────────────

const mbGate = makeGate(MB_RATE_MS)

async function mbFetch(pathAndQuery: string): Promise<unknown | null> {
  return mbGate(async () => {
    try {
      const res = await fetch(`${MB_BASE}${pathAndQuery}`, {
        headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
      if (res.status === 503) {
        // MB is rate-limiting us; wait a little and return null so caller
        // records a miss rather than crashing.
        console.warn(`[mb] 503 path=${pathAndQuery} — backing off`)
        await new Promise((r) => setTimeout(r, 3000))
        return null
      }
      if (!res.ok) {
        console.warn(`[mb] ${res.status} path=${pathAndQuery}`)
        return null
      }
      return await res.json()
    } catch (err) {
      console.warn(`[mb] threw path=${pathAndQuery}: ${err instanceof Error ? err.message : err}`)
      return null
    }
  })
}

interface MbSearchArtist { id: string; name: string; score: number; disambiguation?: string }

async function mbSearchArtist(name: string): Promise<MbSearchArtist | null> {
  const q = `artist:"${name.replace(/"/g, '\\"')}"`
  const url = `/artist?query=${encodeURIComponent(q)}&fmt=json&limit=5`
  const data = await mbFetch(url) as { artists?: MbSearchArtist[] } | null
  if (!data?.artists?.length) return null

  const nameNorm = normalizeName(name)
  // Prefer: exact normalized name match AND score >= MIN_SCORE; else top score if >= MIN_SCORE.
  const ranked = [...data.artists].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const exact = ranked.find((a) => normalizeName(a.name) === nameNorm && (a.score ?? 0) >= MB_MIN_SCORE)
  if (exact) return exact
  const top = ranked[0]
  if ((top.score ?? 0) >= MB_MIN_SCORE) return top
  return null
}

interface MbLookupResult {
  id: string
  name: string
  genres?: Array<{ name: string; count?: number }>
  tags?: Array<{ name: string; count?: number }>
}

async function mbLookup(mbid: string): Promise<MbLookupResult | null> {
  const url = `/artist/${mbid}?inc=genres+tags&fmt=json`
  return await mbFetch(url) as MbLookupResult | null
}

// ── Last.fm ──────────────────────────────────────────────────────────────

const lastfmGate = makeGate(LASTFM_RATE_MS)

async function lastfmGetInfo(name: string, apiKey: string): Promise<LastfmResult | null> {
  return lastfmGate(async () => {
    try {
      const url = new URL(LASTFM_BASE)
      url.searchParams.set('method', 'artist.getInfo')
      url.searchParams.set('artist', name)
      url.searchParams.set('autocorrect', '1')
      url.searchParams.set('api_key', apiKey)
      url.searchParams.set('format', 'json')

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
      if (!res.ok) {
        console.warn(`[lfm] ${res.status} artist="${name}"`)
        return null
      }
      const data = await res.json() as {
        artist?: {
          stats?: { listeners?: string; playcount?: string }
          tags?: { tag?: Array<{ name?: string }> }
        }
        error?: number
        message?: string
      }
      if (data.error || !data.artist) return null
      const listeners = parseInt(data.artist.stats?.listeners ?? '0', 10) || 0
      const rawTags = data.artist.tags?.tag ?? []
      const tags = rawTags
        .map((t) => (t.name ?? '').toLowerCase().trim())
        .filter((t) => t.length > 0)
        .filter((t) => !LASTFM_TAG_BLOCKLIST.has(t))
        .filter((t) => !LASTFM_TAG_ERA_RE.test(t))
      return { listeners, tags }
    } catch (err) {
      console.warn(`[lfm] threw artist="${name}": ${err instanceof Error ? err.message : err}`)
      return null
    }
  })
}

// ── Merge ────────────────────────────────────────────────────────────────

function pickGenres(mb: MbResult | undefined, lfm: LastfmResult | undefined): string[] {
  if (mb?.genres?.length) return mb.genres.slice(0, MAX_GENRES_PER_ARTIST)
  if (mb?.tags?.length) return mb.tags.slice(0, MAX_GENRES_PER_ARTIST)
  if (lfm?.tags?.length) return lfm.tags.slice(0, MAX_GENRES_PER_ARTIST)
  return []
}

function scaleListeners(listeners: number): number {
  if (listeners <= 0) return 0
  const scaled = Math.round((Math.log10(listeners + 1) - 2) * 15)
  return Math.min(100, Math.max(0, scaled))
}

function mergeArtistData(existing: Artist, genres: string[], popularity: number): Artist {
  return { ...existing, genres, popularity }
}

// ── Writers ──────────────────────────────────────────────────────────────

async function updateSearchCacheBySpotifyId(
  supabase: SupabaseClient,
  spotifyId: string,
  merged: Artist
): Promise<number> {
  const { data, error } = await supabase
    .from('artist_search_cache')
    .update({ artist_data: merged })
    .eq('spotify_artist_id', spotifyId)
    .select('name_lower')
  if (error) {
    console.log(`[backfill] search_cache update fail id=${spotifyId} err="${error.message}"`)
    return 0
  }
  return (data ?? []).length
}

async function updateRecCacheBySpotifyId(
  supabase: SupabaseClient,
  spotifyId: string,
  merged: Artist
): Promise<number> {
  const { data, error } = await supabase
    .from('recommendation_cache')
    .update({ artist_data: merged })
    .eq('spotify_artist_id', spotifyId)
    .select('id')
  if (error) {
    console.log(`[backfill] rec_cache update fail id=${spotifyId} err="${error.message}"`)
    return 0
  }
  return (data ?? []).length
}

// ── Phases ───────────────────────────────────────────────────────────────

async function phaseMusicBrainz(cp: Checkpoint): Promise<void> {
  const todo = cp.uniqueArtists.filter((a) => !(a.spotifyId in cp.mbResults))
  console.log(`[backfill] phase=mb start total=${cp.uniqueArtists.length} todo=${todo.length}`)
  const start = Date.now()
  let sinceCheckpoint = 0

  for (let i = 0; i < todo.length; i++) {
    const a = todo[i]
    const hit = await mbSearchArtist(a.name)
    let result: MbResult
    if (!hit) {
      result = { mbid: null, score: 0, genres: [], tags: [] }
      cp.stats.mbUnresolved++
    } else {
      const lookup = await mbLookup(hit.id)
      const genres = (lookup?.genres ?? [])
        .map((g) => g.name.toLowerCase().trim())
        .filter(Boolean)
      const tags = (lookup?.tags ?? [])
        .filter((t) => (t.count ?? 0) >= 1)
        .map((t) => t.name.toLowerCase().trim())
        .filter(Boolean)
      result = { mbid: hit.id, score: hit.score ?? 0, genres, tags }
      cp.stats.mbMatched++
    }
    cp.mbResults[a.spotifyId] = result
    sinceCheckpoint++

    if (sinceCheckpoint >= CHECKPOINT_EVERY_N_ARTISTS || i === todo.length - 1) {
      saveCheckpoint(cp)
      const elapsedMin = ((Date.now() - start) / 60000).toFixed(1)
      const etaMin = todo.length > 0
        ? (((Date.now() - start) / (i + 1)) * (todo.length - i - 1) / 60000).toFixed(1)
        : '0.0'
      console.log(
        `[backfill] phase=mb ${i + 1}/${todo.length} ` +
        `matched=${cp.stats.mbMatched} unresolved=${cp.stats.mbUnresolved} ` +
        `elapsed=${elapsedMin}m eta=${etaMin}m`
      )
      sinceCheckpoint = 0
    }
  }
}

async function phaseLastfm(cp: Checkpoint, apiKey: string): Promise<void> {
  const todo = cp.uniqueArtists.filter((a) => !(a.spotifyId in cp.lastfmResults))
  console.log(`[backfill] phase=lastfm start total=${cp.uniqueArtists.length} todo=${todo.length}`)
  const start = Date.now()
  let sinceCheckpoint = 0

  for (let i = 0; i < todo.length; i++) {
    const a = todo[i]
    const hit = await lastfmGetInfo(a.name, apiKey)
    if (hit) {
      cp.lastfmResults[a.spotifyId] = hit
      cp.stats.lastfmMatched++
    } else {
      cp.lastfmResults[a.spotifyId] = { listeners: 0, tags: [] }
      cp.stats.lastfmUnresolved++
    }
    sinceCheckpoint++

    if (sinceCheckpoint >= CHECKPOINT_EVERY_N_ARTISTS || i === todo.length - 1) {
      saveCheckpoint(cp)
      const elapsedMin = ((Date.now() - start) / 60000).toFixed(1)
      const etaMin = todo.length > 0
        ? (((Date.now() - start) / (i + 1)) * (todo.length - i - 1) / 60000).toFixed(1)
        : '0.0'
      console.log(
        `[backfill] phase=lastfm ${i + 1}/${todo.length} ` +
        `matched=${cp.stats.lastfmMatched} unresolved=${cp.stats.lastfmUnresolved} ` +
        `elapsed=${elapsedMin}m eta=${etaMin}m`
      )
      sinceCheckpoint = 0
    }
  }
}

async function phaseWrite(
  cp: Checkpoint,
  supabase: SupabaseClient,
  existingById: Map<string, Artist>,
  dryRun: boolean
): Promise<void> {
  const written = new Set(cp.writtenIds)
  const todo = cp.uniqueArtists.filter((a) => !written.has(a.spotifyId))
  console.log(`[backfill] phase=write start total=${cp.uniqueArtists.length} todo=${todo.length} dryRun=${dryRun}`)
  let sinceCheckpoint = 0
  let emptyGenres = 0
  let zeroPopularity = 0

  for (let i = 0; i < todo.length; i++) {
    const a = todo[i]
    const mb = cp.mbResults[a.spotifyId]
    const lfm = cp.lastfmResults[a.spotifyId]
    const genres = pickGenres(mb, lfm)
    const popularity = scaleListeners(lfm?.listeners ?? 0)
    if (genres.length === 0) emptyGenres++
    if (popularity === 0) zeroPopularity++

    const existing = existingById.get(a.spotifyId)
    if (!existing) {
      // Shouldn't happen — existingById is built from the same rows we seeded from.
      console.log(`[backfill] write skip id=${a.spotifyId} — no existing artist_data`)
      written.add(a.spotifyId)
      cp.writtenIds = Array.from(written)
      continue
    }
    const merged = mergeArtistData(existing, genres, popularity)

    if (!dryRun) {
      const searchUpd = await updateSearchCacheBySpotifyId(supabase, a.spotifyId, merged)
      const recUpd = await updateRecCacheBySpotifyId(supabase, a.spotifyId, merged)
      cp.stats.searchCacheUpdated += searchUpd
      cp.stats.recCacheUpdated += recUpd
    }

    written.add(a.spotifyId)
    cp.writtenIds = Array.from(written)
    sinceCheckpoint++

    if (sinceCheckpoint >= CHECKPOINT_EVERY_N_ARTISTS || i === todo.length - 1) {
      saveCheckpoint(cp)
      console.log(
        `[backfill] phase=write ${i + 1}/${todo.length} ` +
        `search_upd=${cp.stats.searchCacheUpdated} rec_upd=${cp.stats.recCacheUpdated} ` +
        `emptyGenres=${emptyGenres} zeroPop=${zeroPopularity}`
      )
      sinceCheckpoint = 0
    }
  }

  console.log(
    `[backfill] phase=write done emptyGenres=${emptyGenres}/${todo.length} ` +
    `zeroPop=${zeroPopularity}/${todo.length}`
  )
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  loadEnv({ path: join(process.cwd(), '.env.local') })
  const args = parseArgs(process.argv)

  const lastfmKey = requireEnv('LASTFM_API_KEY')
  requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // ── Load rows from both tables ─────────────────────────────────────────
  console.log(`[backfill] reading artist_search_cache…`)
  const searchRows = await readAllRows<{
    name_lower: string
    spotify_artist_id: string
    artist_data: Artist
  }>(supabase, 'artist_search_cache', 'name_lower, spotify_artist_id, artist_data', 'name_lower')

  console.log(`[backfill] reading recommendation_cache…`)
  const recRows = await readAllRows<{
    id: string
    spotify_artist_id: string
    artist_data: Artist
  }>(supabase, 'recommendation_cache', 'id, spotify_artist_id, artist_data', 'id')

  // Build unique (spotifyId, name) list — prefer search_cache name, fall
  // back to rec_cache artist_data.name. Also build existingById so phaseWrite
  // can merge against an original Artist object.
  const nameById = new Map<string, string>()
  const existingById = new Map<string, Artist>()
  for (const r of searchRows) {
    if (!r.spotify_artist_id) continue
    if (!nameById.has(r.spotify_artist_id)) {
      nameById.set(r.spotify_artist_id, r.artist_data?.name ?? '')
      existingById.set(r.spotify_artist_id, r.artist_data)
    }
  }
  for (const r of recRows) {
    if (!r.spotify_artist_id) continue
    if (!nameById.has(r.spotify_artist_id)) {
      nameById.set(r.spotify_artist_id, r.artist_data?.name ?? '')
      existingById.set(r.spotify_artist_id, r.artist_data)
    }
  }

  const uniqueArtists: ArtistRef[] = Array.from(nameById.entries())
    .filter(([, name]) => name.length > 0)
    .map(([spotifyId, name]) => ({ spotifyId, name }))

  console.log(
    `[backfill] search_cache rows=${searchRows.length} rec_cache rows=${recRows.length} ` +
    `unique artists=${uniqueArtists.length}`
  )

  // ── Load or initialize checkpoint ──────────────────────────────────────
  const existing = args.fresh ? null : loadCheckpoint()
  const cp: Checkpoint = existing ?? {
    schema: CHECKPOINT_SCHEMA,
    uniqueArtists,
    mbResults: {},
    lastfmResults: {},
    writtenIds: [],
    stats: {
      searchCacheRows: searchRows.length,
      recommendationCacheRows: recRows.length,
      uniqueIds: uniqueArtists.length,
      mbMatched: 0,
      mbUnresolved: 0,
      lastfmMatched: 0,
      lastfmUnresolved: 0,
      searchCacheUpdated: 0,
      recCacheUpdated: 0,
    },
    startedAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString(),
  }
  if (existing) {
    // If new artists appeared since the checkpoint, append them.
    const known = new Set(existing.uniqueArtists.map((a) => a.spotifyId))
    const added = uniqueArtists.filter((a) => !known.has(a.spotifyId))
    if (added.length) {
      cp.uniqueArtists.push(...added)
      console.log(`[backfill] checkpoint: ${added.length} new artists since last run`)
    }
    console.log(
      `[backfill] resuming: mb=${Object.keys(cp.mbResults).length}, ` +
      `lastfm=${Object.keys(cp.lastfmResults).length}, ` +
      `written=${cp.writtenIds.length}`
    )
  }

  // ── Run phases ─────────────────────────────────────────────────────────
  if (args.phase === 'all' || args.phase === 'mb') {
    await phaseMusicBrainz(cp)
  }
  if (args.phase === 'all' || args.phase === 'lastfm') {
    await phaseLastfm(cp, lastfmKey)
  }
  if (args.phase === 'all' || args.phase === 'write') {
    await phaseWrite(cp, supabase, existingById, args.dryRun)
  }

  saveCheckpoint(cp)
  console.log(
    `\n[backfill] complete.\n` +
    `  mb_matched=${cp.stats.mbMatched}/${cp.uniqueArtists.length}\n` +
    `  lastfm_matched=${cp.stats.lastfmMatched}/${cp.uniqueArtists.length}\n` +
    `  search_cache_updated=${cp.stats.searchCacheUpdated}\n` +
    `  rec_cache_updated=${cp.stats.recCacheUpdated}`
  )
}

main().catch((err) => {
  console.error(`[backfill] fatal: ${err instanceof Error ? err.stack : err}`)
  process.exit(1)
})
