/**
 * Backfill real genres + popularity onto artists via MusicBrainz + Last.fm.
 * Does NOT touch Spotify — sidesteps Dev-Mode quota entirely.
 *
 * Targets the canonical `artists` table (keyed by the uuid `id`; ADR-0001)
 * rows missing genres or popularity, plus the `artist_data` JSON copies in
 * `recommendation_cache` (keyed by `artist_id`). Ported off the dropped
 * `artist_search_cache` / `spotify_artist_id` (#175 D4).
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
 *     artists: fill-only (only empty genres / null-or-0 popularity are
 *     written — never overwrites a value, matching the doorway's write policy).
 *     recommendation_cache: artist_data genres/popularity for that artist_id.
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
import { createMbLimiter } from '../lib/artist-identity/musicbrainz'

// ── Config ───────────────────────────────────────────────────────────────

const MB_BASE = 'https://musicbrainz.org/ws/2'
const MB_USER_AGENT = 'Flipside/0.1.0 ( fluxuate27@gmail.com )'
const MB_MIN_SCORE = 85                // accept match if MB score >= this

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0'
const LASTFM_RATE_MS = 500             // 2 req/s

const HTTP_TIMEOUT_MS = 12000
const PAGE_SIZE = 1000                 // Supabase row page size
const CHECKPOINT_EVERY_N_ARTISTS = 25
const CHECKPOINT_PATH =
  process.env.BACKFILL_CHECKPOINT_PATH ?? join(process.cwd(), 'scripts', 'backfill-artist-genres.checkpoint.json')
const CHECKPOINT_SCHEMA = 3            // 3: keyed by artists.id (was spotify id)

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
  /** artists.id (uuid) */
  id: string
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

export interface Checkpoint {
  schema: number
  uniqueArtists: ArtistRef[]
  mbResults: Record<string, MbResult>
  lastfmResults: Record<string, LastfmResult>
  writtenIds: string[]
  stats: {
    artistsRows: number
    recommendationCacheRows: number
    uniqueIds: number
    mbMatched: number
    mbUnresolved: number
    lastfmMatched: number
    lastfmUnresolved: number
    artistsUpdated: number
    recCacheUpdated: number
  }
  startedAt: string
  lastSavedAt: string
}

interface ArtistsRow {
  id: string
  name: string
  genres: string[] | null
  popularity: number | null
}

/** One user's recommendation_cache row for an artist. */
interface RecRow {
  id: string
  artist_id: string
  artist_data: Artist
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

// ── MusicBrainz ──────────────────────────────────────────────────────────

// The shared MusicBrainz 1 req/s limiter (lib/artist-identity/musicbrainz.ts).
const mbLimiter = createMbLimiter()

async function mbFetch(pathAndQuery: string): Promise<unknown | null> {
  return mbLimiter.run(async () => {
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

/**
 * Diacritic-folding name normalizer for MB matching ("Björk" ≡ "Bjork").
 * Deliberately NOT artistNameKey (which keeps diacritics); this script's
 * original matcher, restored in #175 D4.
 */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^\w\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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

/** Fill-only: write only the fields the artists row has empty. Returns rows updated. */
async function fillArtistsRow(
  supabase: SupabaseClient,
  row: ArtistsRow,
  genres: string[],
  popularity: number
): Promise<number> {
  const patch: { genres?: string[]; popularity?: number } = {}
  if (genres.length > 0 && !(row.genres?.length)) patch.genres = genres
  if (popularity > 0 && !row.popularity) patch.popularity = popularity
  if (Object.keys(patch).length === 0) return 0
  const { data, error } = await supabase
    .from('artists')
    .update(patch)
    .eq('id', row.id)
    .select('id')
  if (error) {
    console.log(`[backfill] artists update fail id=${row.id} err="${error.message}"`)
    return 0
  }
  return (data ?? []).length
}

/**
 * Patch genres/popularity into EACH user's own `artist_data` copy (by row id).
 * One blob copied onto every user's row would overwrite each row's own baked
 * previews (`topTracks`), `artist_color` and image with another row's (#175).
 */
async function updateRecCacheRows(
  supabase: SupabaseClient,
  rows: RecRow[],
  genres: string[],
  popularity: number
): Promise<number> {
  let n = 0
  for (const r of rows) {
    const merged = mergeArtistData(
      r.artist_data,
      genres.length > 0 ? genres : r.artist_data.genres,
      popularity || r.artist_data.popularity
    )
    const { data, error } = await supabase
      .from('recommendation_cache')
      .update({ artist_data: merged })
      .eq('id', r.id)
      .select('id')
    if (error) {
      console.log(`[backfill] rec_cache update fail row=${r.id} err="${error.message}"`)
      continue
    }
    n += (data ?? []).length
  }
  return n
}

// ── Phases ───────────────────────────────────────────────────────────────

async function phaseMusicBrainz(cp: Checkpoint): Promise<void> {
  const todo = cp.uniqueArtists.filter((a) => !(a.id in cp.mbResults))
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
    cp.mbResults[a.id] = result
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
  const todo = cp.uniqueArtists.filter((a) => !(a.id in cp.lastfmResults))
  console.log(`[backfill] phase=lastfm start total=${cp.uniqueArtists.length} todo=${todo.length}`)
  const start = Date.now()
  let sinceCheckpoint = 0

  for (let i = 0; i < todo.length; i++) {
    const a = todo[i]
    const hit = await lastfmGetInfo(a.name, apiKey)
    if (hit) {
      cp.lastfmResults[a.id] = hit
      cp.stats.lastfmMatched++
    } else {
      cp.lastfmResults[a.id] = { listeners: 0, tags: [] }
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

export async function phaseWrite(
  cp: Checkpoint,
  supabase: SupabaseClient,
  artistsById: Map<string, ArtistsRow>,
  recRowsByArtist: Map<string, RecRow[]>,
  dryRun: boolean
): Promise<void> {
  const written = new Set(cp.writtenIds)
  const todo = cp.uniqueArtists.filter((a) => !written.has(a.id))
  console.log(`[backfill] phase=write start total=${cp.uniqueArtists.length} todo=${todo.length} dryRun=${dryRun}`)
  let sinceCheckpoint = 0
  let emptyGenres = 0
  let zeroPopularity = 0

  for (let i = 0; i < todo.length; i++) {
    const a = todo[i]
    const mb = cp.mbResults[a.id]
    const lfm = cp.lastfmResults[a.id]
    const genres = pickGenres(mb, lfm)
    const popularity = scaleListeners(lfm?.listeners ?? 0)
    if (genres.length === 0) emptyGenres++
    if (popularity === 0) zeroPopularity++

    const row = artistsById.get(a.id)
    if (!row) {
      // Row deleted since the checkpoint was taken.
      console.log(`[backfill] write skip id=${a.id} — no artists row`)
      continue
    }

    // A dry run writes nothing — so it must checkpoint nothing as written
    // either, or the next real run skips every id (#175).
    if (!dryRun) {
      cp.stats.artistsUpdated += await fillArtistsRow(supabase, row, genres, popularity)
      const recRows = recRowsByArtist.get(a.id) ?? []
      if (genres.length > 0 || popularity > 0) {
        cp.stats.recCacheUpdated += await updateRecCacheRows(supabase, recRows, genres, popularity)
      }
      written.add(a.id)
      cp.writtenIds = Array.from(written)
    }
    sinceCheckpoint++

    if (sinceCheckpoint >= CHECKPOINT_EVERY_N_ARTISTS || i === todo.length - 1) {
      saveCheckpoint(cp)
      console.log(
        `[backfill] phase=write ${i + 1}/${todo.length} ` +
        `artists_upd=${cp.stats.artistsUpdated} rec_upd=${cp.stats.recCacheUpdated} ` +
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

  // ── Load rows ──────────────────────────────────────────────────────────
  console.log(`[backfill] reading artists…`)
  const artistRows = await readAllRows<ArtistsRow>(supabase, 'artists', 'id, name, genres, popularity', 'id')

  console.log(`[backfill] reading recommendation_cache…`)
  const recRows = await readAllRows<RecRow>(supabase, 'recommendation_cache', 'id, artist_id, artist_data', 'id')

  // Work list = artists rows still missing genres or popularity. artistsById
  // feeds the fill-only write; recRowsByArtist holds every user's cache row
  // per artist_id, each patched with its own artist_data.
  const artistsById = new Map<string, ArtistsRow>()
  for (const r of artistRows) artistsById.set(r.id, r)
  const recRowsByArtist = new Map<string, RecRow[]>()
  for (const r of recRows) {
    if (!r.artist_id || !r.artist_data) continue
    const list = recRowsByArtist.get(r.artist_id)
    if (list) list.push(r)
    else recRowsByArtist.set(r.artist_id, [r])
  }

  const uniqueArtists: ArtistRef[] = artistRows
    .filter((r) => r.name && (!(r.genres?.length) || !r.popularity))
    .map((r) => ({ id: r.id, name: r.name }))

  console.log(
    `[backfill] artists rows=${artistRows.length} rec_cache rows=${recRows.length} ` +
    `to backfill=${uniqueArtists.length}`
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
      artistsRows: artistRows.length,
      recommendationCacheRows: recRows.length,
      uniqueIds: uniqueArtists.length,
      mbMatched: 0,
      mbUnresolved: 0,
      lastfmMatched: 0,
      lastfmUnresolved: 0,
      artistsUpdated: 0,
      recCacheUpdated: 0,
    },
    startedAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString(),
  }
  if (existing) {
    // If new artists appeared since the checkpoint, append them.
    const known = new Set(existing.uniqueArtists.map((a) => a.id))
    const added = uniqueArtists.filter((a) => !known.has(a.id))
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
    await phaseWrite(cp, supabase, artistsById, recRowsByArtist, args.dryRun)
  }

  saveCheckpoint(cp)
  console.log(
    `\n[backfill] complete.\n` +
    `  mb_matched=${cp.stats.mbMatched}/${cp.uniqueArtists.length}\n` +
    `  lastfm_matched=${cp.stats.lastfmMatched}/${cp.uniqueArtists.length}\n` +
    `  artists_updated=${cp.stats.artistsUpdated}\n` +
    `  rec_cache_updated=${cp.stats.recCacheUpdated}`
  )
}

// ponytail: env guard so the test can import phaseWrite without running main.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(`[backfill] fatal: ${err instanceof Error ? err.stack : err}`)
    process.exit(1)
  })
}
