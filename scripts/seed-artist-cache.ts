/**
 * Seed artist_search_cache from every leaf in data/genres.json.
 *
 * Phase 1 — Last.fm scan (rate-limited, sequential, ~5 min):
 *   For each leaf tag, call tag.getTopArtists?limit=50 and accumulate a
 *   global name set. Checkpoints every 25 leaves so Ctrl+C is safe.
 *
 * Phase 2 — Spotify resolve (concurrent, ~15-25 min on first run):
 *   Pass the deduped name list through the existing resolveArtistsByName
 *   pipeline. ArtistNameCache.batchRead skips names already cached, so
 *   writes only hit Spotify for net-new artists. Cache writes land in
 *   artist_search_cache for free.
 *
 * Usage:
 *   npx tsx scripts/seed-artist-cache.ts                      # full run
 *   npx tsx scripts/seed-artist-cache.ts --dry-run            # Phase 1 only
 *   npx tsx scripts/seed-artist-cache.ts --fresh              # ignore checkpoint
 *   npx tsx scripts/seed-artist-cache.ts --limit-per-tag=30   # override
 *
 * Env (loaded from .env.local via dotenv):
 *   LASTFM_API_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { SpotifyProvider } from '../lib/music-provider/spotify-provider'
import { getSpotifyClientToken } from '../lib/spotify-client-token'
import { resolveArtistsByName } from '../lib/recommendation/resolve-candidates'
import { ArtistNameCache, type CacheSupabaseClient } from '../lib/recommendation/artist-name-cache'
import type { Artist, RateLimited } from '../lib/music-provider'

// ── Types ────────────────────────────────────────────────────────────────

interface GenreNode {
  id: string
  label: string
  lastfmTag: string
  parentId: string | null
  children: GenreNode[]
}

interface GenreData {
  generated: string
  source: string
  nodes: GenreNode[]
}

interface Checkpoint {
  schema: number
  completedLeafIds: string[]
  collectedNames: string[]
  startedAt: string
  lastSavedAt: string
}

const CHECKPOINT_SCHEMA = 1

// ── Config ───────────────────────────────────────────────────────────────

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0'
const TIMEOUT_MS = 8000
const RATE_LIMIT_DELAY_MS = 500  // ≈2 req/s — matches validate-genre-tree.ts
const DEFAULT_LIMIT_PER_TAG = 50
const CHECKPOINT_EVERY_N_LEAVES = 25

const CHECKPOINT_PATH = join(process.cwd(), 'scripts', 'seed-artist-cache.checkpoint.json')
const GENRES_PATH = join(process.cwd(), 'data', 'genres.json')

// ── CLI args ─────────────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean
  fresh: boolean
  limitPerTag: number
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false
  let fresh = false
  let limitPerTag = DEFAULT_LIMIT_PER_TAG

  for (const a of argv.slice(2)) {
    if (a === '--dry-run') { dryRun = true; continue }
    if (a === '--fresh') { fresh = true; continue }
    const m = a.match(/^--limit-per-tag=(.+)$/)
    if (m) {
      const v = parseInt(m[1], 10)
      if (!Number.isFinite(v) || v < 1 || v > 1000) {
        throw new Error(`--limit-per-tag must be 1-1000, got "${m[1]}"`)
      }
      limitPerTag = v
      continue
    }
    if (a === '-h' || a === '--help') {
      console.log('Usage: seed-artist-cache.ts [--dry-run] [--fresh] [--limit-per-tag=50]')
      process.exit(0)
    }
    throw new Error(`Unknown arg: ${a}`)
  }

  return { dryRun, fresh, limitPerTag }
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

// ── Checkpoint ───────────────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_PATH)) return null
  try {
    const raw = readFileSync(CHECKPOINT_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Checkpoint
    if (parsed.schema !== CHECKPOINT_SCHEMA) {
      console.warn(
        `[seed] checkpoint schema mismatch (have=${parsed.schema}, want=${CHECKPOINT_SCHEMA}). ` +
        `Ignoring — pass --fresh to overwrite.`
      )
      return null
    }
    return parsed
  } catch (err) {
    console.warn(`[seed] checkpoint read failed: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  cp.lastSavedAt = new Date().toISOString()
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2))
}

// ── Tree walk ────────────────────────────────────────────────────────────

function loadTree(): GenreData {
  const raw = readFileSync(GENRES_PATH, 'utf-8')
  return JSON.parse(raw) as GenreData
}

/** Every true leaf (children.length === 0) with its Last.fm tag. */
function collectLeaves(data: GenreData): Array<{ leafId: string; tag: string }> {
  const out: Array<{ leafId: string; tag: string }> = []
  for (const anchor of data.nodes) {
    for (const cluster of anchor.children) {
      for (const leaf of cluster.children) {
        if (leaf.children.length === 0 && leaf.lastfmTag) {
          out.push({ leafId: leaf.id, tag: leaf.lastfmTag })
        }
      }
    }
  }
  return out
}

// ── Last.fm ──────────────────────────────────────────────────────────────

let lastCallAt = 0
async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const elapsed = Date.now() - lastCallAt
  if (elapsed < RATE_LIMIT_DELAY_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS - elapsed))
  }
  lastCallAt = Date.now()
  return fn()
}

async function tagGetTopArtists(
  tag: string,
  limit: number,
  apiKey: string
): Promise<string[]> {
  return rateLimited(async () => {
    try {
      const url = new URL(LASTFM_BASE)
      url.searchParams.set('method', 'tag.gettopartists')
      url.searchParams.set('tag', tag)
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('api_key', apiKey)
      url.searchParams.set('format', 'json')

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) {
        console.warn(`  tag.getTopArtists("${tag}") ${res.status}: ${res.statusText}`)
        return []
      }
      const data = (await res.json()) as {
        topartists?: { artist?: Array<{ name?: string }> }
      }
      const arr = data?.topartists?.artist
      if (!Array.isArray(arr)) return []
      return arr.map((a) => a.name ?? '').filter(Boolean)
    } catch (err) {
      console.warn(`  tag.getTopArtists("${tag}") threw: ${err instanceof Error ? err.message : err}`)
      return []
    }
  })
}

// ── Phase 1 ──────────────────────────────────────────────────────────────

async function phase1CollectNames(
  cp: Checkpoint,
  leaves: Array<{ leafId: string; tag: string }>,
  limitPerTag: number,
  apiKey: string
): Promise<void> {
  const done = new Set(cp.completedLeafIds)
  const nameSet = new Set(cp.collectedNames)
  const startCount = done.size
  const remaining = leaves.filter((l) => !done.has(l.leafId))

  console.log(
    `[seed] phase1 start leaves=${leaves.length} remaining=${remaining.length} ` +
    `preCollected=${nameSet.size} limitPerTag=${limitPerTag}`
  )

  let sinceCheckpoint = 0
  for (let i = 0; i < remaining.length; i++) {
    const { leafId, tag } = remaining[i]
    const names = await tagGetTopArtists(tag, limitPerTag, apiKey)
    for (const n of names) nameSet.add(n)
    done.add(leafId)
    sinceCheckpoint++

    const globalIdx = startCount + i + 1
    if (sinceCheckpoint >= CHECKPOINT_EVERY_N_LEAVES || i === remaining.length - 1) {
      cp.completedLeafIds = Array.from(done)
      cp.collectedNames = Array.from(nameSet)
      saveCheckpoint(cp)
      console.log(
        `[seed] phase1 progress ${globalIdx}/${leaves.length} leaves ` +
        `uniqueNames=${nameSet.size} (lastTag="${tag}" +${names.length})`
      )
      sinceCheckpoint = 0
    }
  }

  cp.completedLeafIds = Array.from(done)
  cp.collectedNames = Array.from(nameSet)
  saveCheckpoint(cp)
  console.log(`[seed] phase1 done leaves=${done.size}/${leaves.length} uniqueNames=${nameSet.size}`)
}

// ── Phase 2 ──────────────────────────────────────────────────────────────

async function phase2ResolveNames(
  names: string[],
  cache: ArtistNameCache,
  provider: SpotifyProvider
): Promise<void> {
  console.log(`[seed] phase2 start totalNames=${names.length}`)

  const searchArtists = async (name: string): Promise<Artist[] | RateLimited> => {
    const token = await getSpotifyClientToken()
    if (!token) return []
    return provider.searchArtists(token, name)
  }

  const result = await resolveArtistsByName(names, {
    cache,
    searchArtists,
    concurrency: 4,
    delayMs: 200,
  })

  console.log(
    `[seed] phase2 done ` +
    `cacheHits=${result.cacheHits} cacheMisses=${result.cacheMisses} ` +
    `searchOk=${result.searchOk} searchFail=${result.searchFail} ` +
    `rateLimited=${result.rateLimited} backoffExhausted=${result.backoffBudgetExhausted}`
  )
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  loadEnv({ path: join(process.cwd(), '.env.local') })
  const args = parseArgs(process.argv)

  const lastfmKey = requireEnv('LASTFM_API_KEY')
  // Phase 2 env is only required when we actually run Phase 2.
  if (!args.dryRun) {
    requireEnv('SPOTIFY_CLIENT_ID')
    requireEnv('SPOTIFY_CLIENT_SECRET')
    requireEnv('NEXT_PUBLIC_SUPABASE_URL')
    requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  }

  const tree = loadTree()
  const leaves = collectLeaves(tree)
  console.log(`[seed] loaded ${leaves.length} leaves from data/genres.json`)

  // Checkpoint: load or fresh.
  const existing = args.fresh ? null : loadCheckpoint()
  const cp: Checkpoint = existing ?? {
    schema: CHECKPOINT_SCHEMA,
    completedLeafIds: [],
    collectedNames: [],
    startedAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString(),
  }
  if (existing) {
    console.log(
      `[seed] resuming checkpoint: ${existing.completedLeafIds.length}/${leaves.length} leaves done, ` +
      `${existing.collectedNames.length} names collected`
    )
  }

  await phase1CollectNames(cp, leaves, args.limitPerTag, lastfmKey)

  if (args.dryRun) {
    const byAnchor = new Map<string, number>()
    const leafToAnchor = new Map<string, string>()
    for (const anchor of tree.nodes) {
      for (const cluster of anchor.children) {
        for (const leaf of cluster.children) leafToAnchor.set(leaf.id, anchor.label)
      }
    }
    for (const leafId of cp.completedLeafIds) {
      const a = leafToAnchor.get(leafId) ?? 'unknown'
      byAnchor.set(a, (byAnchor.get(a) ?? 0) + 1)
    }
    console.log(`\n[seed] dry-run complete. Unique names collected: ${cp.collectedNames.length}`)
    console.log(`[seed] leaves processed by anchor:`)
    for (const [anchor, n] of Array.from(byAnchor).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${anchor.padEnd(24)} ${n}`)
    }
    return
  }

  // Phase 2: real Supabase + real Spotify.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const cache = new ArtistNameCache(supabase as unknown as CacheSupabaseClient)
  const provider = new SpotifyProvider()

  await phase2ResolveNames(cp.collectedNames, cache, provider)
  console.log(`[seed] all phases complete.`)
}

main().catch((err) => {
  console.error(`[seed] fatal: ${err instanceof Error ? err.stack : err}`)
  process.exit(1)
})
