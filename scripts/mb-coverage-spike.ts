/**
 * MusicBrainz coverage spike.
 *
 * Decides whether Path B' (Spotify-vocabulary + MB-augmented edges) is
 * viable by measuring how well MusicBrainz's canonical genre list covers
 * the actual Spotify genre strings our engine sees.
 *
 * Process:
 *   Phase 1 — Fetch all MB genres via /ws/2/genre/all (paginated).
 *   Phase 2 — Read artist_search_cache, extract the union of Spotify
 *             artist.genres[] strings + per-genre artist frequency.
 *   Phase 3 — Match each Spotify genre to MB (normalized equality).
 *             Bucket: matched / unmatched. Also compute head-coverage
 *             — what % of *genre observations* (artist·genre pairs)
 *             are matched, weighted by artist count.
 *   Phase 4 — For top-N Spotify genres by artist count, compare their
 *             cache-derived neighbors vs their MB-derived neighbors
 *             (via /ws/2/artist?query=genre:"X"). Human eyeballs
 *             these in the report to judge adjacency quality.
 *
 * Decision rule (my read, not enforced by the script):
 *   - observation-weighted match > 80% → Path B' is viable.
 *   - 60-80% → Path B' usable with a fallback bucket for the gap.
 *   - < 60% → Path C (cache-only) is a better bet; MB vocabulary
 *     doesn't cover our real distribution.
 *
 * Usage:
 *   npx tsx scripts/mb-coverage-spike.ts                   # default 20-genre spot check
 *   npx tsx scripts/mb-coverage-spike.ts --skip-spot-check # coverage math only
 *   npx tsx scripts/mb-coverage-spike.ts --sample-size=10  # smaller spot check
 *
 * Output:
 *   scripts/mb-coverage-spike.report.json — full detail
 *   stdout — human summary
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { normalizeGenre } from '../lib/genre/normalize'

// ── Types ────────────────────────────────────────────────────────────────

interface MbGenre {
  id: string
  name: string
}

interface GenreStat {
  displayName: string
  normalized: string
  artistCount: number
}

interface MatchedEntry {
  spotify: string
  normalized: string
  mb: string
  artistCount: number
}

interface UnmatchedEntry {
  spotify: string
  normalized: string
  artistCount: number
}

interface SpotCheckEntry {
  spotifyGenre: string
  matchedMbGenre: string | null
  cacheNeighbors: Array<{ name: string; count: number }>
  mbNeighbors: Array<{ name: string; count: number }>
  mbArtistsSampled: number
}

interface Report {
  runAt: string
  cache: {
    totalArtists: number
    totalGenreObservations: number
    uniqueGenres: number
  }
  mb: {
    totalGenres: number
  }
  coverage: {
    uniqueMatchedCount: number
    uniqueUnmatchedCount: number
    uniqueMatchedPct: number
    observationMatchedCount: number
    observationMatchedPct: number
  }
  matched: MatchedEntry[]
  unmatched: UnmatchedEntry[]
  spotCheck: SpotCheckEntry[]
}

// ── Config ───────────────────────────────────────────────────────────────

const MB_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'Flipside/0.1.0 ( fluxuate27@gmail.com )'
const RATE_LIMIT_MS = 1100  // 1 req/s + 100ms buffer to avoid MB 503s
const MB_TIMEOUT_MS = 15000
const MB_PAGE_SIZE = 100
const DEFAULT_SAMPLE_SIZE = 20
const MB_ARTISTS_PER_SEED = 5  // artists to sample per spot-check genre
const REPORT_PATH = join(process.cwd(), 'scripts', 'mb-coverage-spike.report.json')

// ── CLI args ─────────────────────────────────────────────────────────────

interface CliArgs {
  sampleSize: number
  skipSpotCheck: boolean
}

function parseArgs(argv: string[]): CliArgs {
  let sampleSize = DEFAULT_SAMPLE_SIZE
  let skipSpotCheck = false
  for (const a of argv.slice(2)) {
    if (a === '--skip-spot-check') { skipSpotCheck = true; continue }
    const m = a.match(/^--sample-size=(.+)$/)
    if (m) {
      const v = parseInt(m[1], 10)
      if (!Number.isFinite(v) || v < 1 || v > 100) {
        throw new Error(`--sample-size must be 1-100, got "${m[1]}"`)
      }
      sampleSize = v
      continue
    }
    if (a === '-h' || a === '--help') {
      console.log('Usage: mb-coverage-spike.ts [--sample-size=20] [--skip-spot-check]')
      process.exit(0)
    }
    throw new Error(`Unknown arg: ${a}`)
  }
  return { sampleSize, skipSpotCheck }
}

// ── Env ──────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) {
    console.error(`Missing required env var: ${key}`)
    process.exit(1)
  }
  return v
}

// ── MB rate-limited fetch ────────────────────────────────────────────────

let lastCallAt = 0
async function mbFetch<T>(path: string): Promise<T | null> {
  const elapsed = Date.now() - lastCallAt
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed))
  }
  lastCallAt = Date.now()

  const url = `${MB_BASE}${path}${path.includes('?') ? '&' : '?'}fmt=json`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(MB_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`  MB ${res.status}: ${path}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`  MB threw on ${path}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Phase 1: Fetch all MB genres ─────────────────────────────────────────

async function fetchAllMbGenres(): Promise<MbGenre[]> {
  const all: MbGenre[] = []
  let offset = 0
  let total = Infinity

  console.log(`[spike] phase1 fetching MB genres (page size ${MB_PAGE_SIZE})...`)
  while (offset < total) {
    const data = await mbFetch<{
      'genre-count': number
      'genre-offset': number
      genres: MbGenre[]
    }>(`/genre/all?limit=${MB_PAGE_SIZE}&offset=${offset}`)
    if (!data) break
    total = data['genre-count']
    for (const g of data.genres ?? []) all.push(g)
    offset += (data.genres?.length ?? 0)
    if ((data.genres?.length ?? 0) === 0) break
    console.log(`[spike] phase1 progress ${all.length}/${total}`)
  }

  console.log(`[spike] phase1 done — ${all.length} MB genres`)
  return all
}

// ── Phase 2: Read Spotify genre strings from cache ───────────────────────

interface CacheScan {
  totalArtists: number
  totalObservations: number
  genreStats: Map<string, GenreStat>   // normalized → stat
  artistToGenres: Map<string, string[]>  // spotifyId → normalized genres
  normalizedToDisplay: Map<string, string>  // normalized → first-seen raw
}

async function scanSpotifyCache(
  supabaseUrl: string,
  supabaseKey: string
): Promise<CacheScan> {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  })

  const genreStats = new Map<string, GenreStat>()
  const artistToGenres = new Map<string, string[]>()
  const normalizedToDisplay = new Map<string, string>()

  // Paginate with range() to avoid any row-limit ceiling.
  const PAGE = 1000
  let offset = 0
  let totalArtists = 0
  let totalObservations = 0

  console.log(`[spike] phase2 scanning artist_search_cache...`)
  for (;;) {
    const { data, error } = await supabase
      .from('artist_search_cache')
      .select('spotify_artist_id, artist_data')
      .range(offset, offset + PAGE - 1)

    if (error) {
      console.error(`[spike] phase2 read error: ${error.message}`)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      totalArtists++
      const artistData = row.artist_data as { genres?: string[] } | null
      const genres = artistData?.genres ?? []
      const normalized: string[] = []
      for (const raw of genres) {
        if (!raw) continue
        const n = normalizeGenre(raw)
        if (!n) continue
        normalized.push(n)
        totalObservations++
        if (!normalizedToDisplay.has(n)) normalizedToDisplay.set(n, raw)
        const stat = genreStats.get(n)
        if (stat) stat.artistCount++
        else genreStats.set(n, { displayName: raw, normalized: n, artistCount: 1 })
      }
      artistToGenres.set(row.spotify_artist_id, normalized)
    }

    console.log(`[spike] phase2 progress artists=${totalArtists} obs=${totalObservations}`)
    if (data.length < PAGE) break
    offset += PAGE
  }

  console.log(
    `[spike] phase2 done artists=${totalArtists} obs=${totalObservations} ` +
    `uniqueGenres=${genreStats.size}`
  )
  return { totalArtists, totalObservations, genreStats, artistToGenres, normalizedToDisplay }
}

// ── Phase 3: Match ───────────────────────────────────────────────────────

interface MatchResult {
  matched: MatchedEntry[]
  unmatched: UnmatchedEntry[]
  matchedNormalizedSet: Set<string>
  spotifyToMb: Map<string, string>  // normalized spotify → MB name
}

function matchGenres(scan: CacheScan, mbGenres: MbGenre[]): MatchResult {
  const mbByNormalized = new Map<string, string>()
  for (const g of mbGenres) {
    mbByNormalized.set(normalizeGenre(g.name), g.name)
  }

  const matched: MatchedEntry[] = []
  const unmatched: UnmatchedEntry[] = []
  const matchedNormalizedSet = new Set<string>()
  const spotifyToMb = new Map<string, string>()

  for (const [normalized, stat] of scan.genreStats) {
    const mb = mbByNormalized.get(normalized)
    if (mb) {
      matched.push({
        spotify: stat.displayName,
        normalized,
        mb,
        artistCount: stat.artistCount,
      })
      matchedNormalizedSet.add(normalized)
      spotifyToMb.set(normalized, mb)
    } else {
      unmatched.push({
        spotify: stat.displayName,
        normalized,
        artistCount: stat.artistCount,
      })
    }
  }

  matched.sort((a, b) => b.artistCount - a.artistCount)
  unmatched.sort((a, b) => b.artistCount - a.artistCount)

  return { matched, unmatched, matchedNormalizedSet, spotifyToMb }
}

// ── Phase 4: Spot check neighbors ────────────────────────────────────────

function cacheNeighbors(
  targetNormalized: string,
  scan: CacheScan,
  limit = 10
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const genres of scan.artistToGenres.values()) {
    if (!genres.includes(targetNormalized)) continue
    for (const g of genres) {
      if (g === targetNormalized) continue
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([n, c]) => ({ name: scan.normalizedToDisplay.get(n) ?? n, count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

async function mbNeighbors(
  mbGenreName: string,
  limit = 10
): Promise<{ neighbors: Array<{ name: string; count: number }>; sampled: number }> {
  // Step 1: find MB artists tagged with this genre.
  const searchQ = `genre:"${mbGenreName.replace(/"/g, '\\"')}"`
  const search = await mbFetch<{
    artists?: Array<{ id: string; name: string }>
  }>(`/artist?query=${encodeURIComponent(searchQ)}&limit=${MB_ARTISTS_PER_SEED}`)
  if (!search?.artists) return { neighbors: [], sampled: 0 }

  const counts = new Map<string, number>()
  let sampled = 0
  for (const artist of search.artists) {
    const detail = await mbFetch<{
      genres?: Array<{ name: string; count?: number }>
    }>(`/artist/${artist.id}?inc=genres`)
    if (!detail?.genres) continue
    sampled++
    for (const g of detail.genres) {
      if (normalizeGenre(g.name) === normalizeGenre(mbGenreName)) continue
      counts.set(g.name, (counts.get(g.name) ?? 0) + (g.count ?? 1))
    }
  }

  const neighbors = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
  return { neighbors, sampled }
}

async function runSpotCheck(
  match: MatchResult,
  scan: CacheScan,
  sampleSize: number
): Promise<SpotCheckEntry[]> {
  // Top-N Spotify genres by artist count, matched in MB.
  const candidates = match.matched.slice(0, sampleSize)
  console.log(`[spike] phase4 spot-checking top ${candidates.length} genres (MB calls: ~${candidates.length * (1 + MB_ARTISTS_PER_SEED)})`)

  const out: SpotCheckEntry[] = []
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const cache = cacheNeighbors(c.normalized, scan)
    const { neighbors: mb, sampled } = await mbNeighbors(c.mb)
    out.push({
      spotifyGenre: c.spotify,
      matchedMbGenre: c.mb,
      cacheNeighbors: cache,
      mbNeighbors: mb,
      mbArtistsSampled: sampled,
    })
    console.log(`[spike] phase4 ${i + 1}/${candidates.length} "${c.spotify}" mbSampled=${sampled} cacheN=${cache.length} mbN=${mb.length}`)
  }
  return out
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  loadEnv({ path: join(process.cwd(), '.env.local') })
  const args = parseArgs(process.argv)

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  const [mbGenres, scan] = await Promise.all([
    fetchAllMbGenres(),
    scanSpotifyCache(supabaseUrl, supabaseKey),
  ])

  const match = matchGenres(scan, mbGenres)

  // Observation-weighted coverage — each genre contributes its artistCount.
  const totalObs = scan.totalObservations
  const matchedObs = match.matched.reduce((s, m) => s + m.artistCount, 0)
  const observationMatchedPct = totalObs > 0 ? (matchedObs / totalObs) * 100 : 0
  const uniqueMatchedPct = scan.genreStats.size > 0
    ? (match.matched.length / scan.genreStats.size) * 100
    : 0

  console.log('\n──────────────── COVERAGE ────────────────')
  console.log(`Spotify cache:    ${scan.totalArtists} artists · ${scan.totalObservations} obs · ${scan.genreStats.size} unique genres`)
  console.log(`MusicBrainz:      ${mbGenres.length} genres`)
  console.log(`Unique match:     ${match.matched.length}/${scan.genreStats.size} (${uniqueMatchedPct.toFixed(1)}%)`)
  console.log(`Observation match: ${matchedObs}/${totalObs} (${observationMatchedPct.toFixed(1)}%)   ← this is the deciding number`)
  console.log('──────────────────────────────────────────\n')

  console.log(`Top 10 unmatched (by artist count):`)
  for (const u of match.unmatched.slice(0, 10)) {
    console.log(`  ${u.artistCount.toString().padStart(4)} × ${u.spotify}`)
  }

  // Spot check
  const spotCheck = args.skipSpotCheck
    ? []
    : await runSpotCheck(match, scan, args.sampleSize)

  const report: Report = {
    runAt: new Date().toISOString(),
    cache: {
      totalArtists: scan.totalArtists,
      totalGenreObservations: scan.totalObservations,
      uniqueGenres: scan.genreStats.size,
    },
    mb: {
      totalGenres: mbGenres.length,
    },
    coverage: {
      uniqueMatchedCount: match.matched.length,
      uniqueUnmatchedCount: match.unmatched.length,
      uniqueMatchedPct: Number(uniqueMatchedPct.toFixed(2)),
      observationMatchedCount: matchedObs,
      observationMatchedPct: Number(observationMatchedPct.toFixed(2)),
    },
    matched: match.matched,
    unmatched: match.unmatched,
    spotCheck,
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(`\n[spike] wrote ${REPORT_PATH}`)
}

main().catch((err) => {
  console.error(`[spike] fatal: ${err instanceof Error ? err.stack : err}`)
  process.exit(1)
})
