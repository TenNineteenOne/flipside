/**
 * Post-backfill verification. Shows sample rows, aggregate stats, and the
 * top-20 genre distribution so we can sanity-check that real genres and
 * popularity made it into artist_search_cache and recommendation_cache.
 */

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { join } from 'path'
import type { Artist } from '../lib/music-provider'

interface Row {
  spotify_artist_id: string
  artist_data: Artist
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(supabase: any, table: string): Promise<Row[]> {
  const out: Row[] = []
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('spotify_artist_id, artist_data')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as Row[]))
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

function summarize(rows: Row[], label: string) {
  const total = rows.length
  const withGenres = rows.filter((r) => (r.artist_data?.genres?.length ?? 0) > 0).length
  const withPop = rows.filter((r) => (r.artist_data?.popularity ?? 0) > 0).length
  const avgGenres = rows.reduce((a, r) => a + (r.artist_data?.genres?.length ?? 0), 0) / total
  const avgPop = rows.reduce((a, r) => a + (r.artist_data?.popularity ?? 0), 0) / total

  console.log(`\n=== ${label} ===`)
  console.log(`  total=${total}`)
  console.log(`  withGenres=${withGenres} (${((withGenres / total) * 100).toFixed(1)}%)`)
  console.log(`  withPopularity=${withPop} (${((withPop / total) * 100).toFixed(1)}%)`)
  console.log(`  avgGenres=${avgGenres.toFixed(2)} avgPopularity=${avgPop.toFixed(1)}`)
}

function topGenres(rows: Row[], n: number): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    for (const g of r.artist_data?.genres ?? []) {
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

function sample(rows: Row[], n: number): Row[] {
  const out: Row[] = []
  const seen = new Set<number>()
  while (out.length < n && seen.size < rows.length) {
    const i = Math.floor(Math.random() * rows.length)
    if (seen.has(i)) continue
    seen.add(i)
    out.push(rows[i])
  }
  return out
}

async function main() {
  loadEnv({ path: join(process.cwd(), '.env.local') })
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const searchRows = await fetchAll(supabase, 'artist_search_cache')
  const recRows = await fetchAll(supabase, 'recommendation_cache')

  summarize(searchRows, 'artist_search_cache')
  summarize(recRows, 'recommendation_cache')

  console.log(`\n=== top 20 genres (search_cache) ===`)
  for (const [g, c] of topGenres(searchRows, 20)) {
    console.log(`  ${String(c).padStart(4)} ${g}`)
  }

  console.log(`\n=== 5 random sample artists ===`)
  for (const r of sample(searchRows, 5)) {
    const a = r.artist_data
    console.log(
      `  ${a.name.padEnd(28)} pop=${String(a.popularity).padStart(3)} ` +
      `genres=[${(a.genres ?? []).slice(0, 5).join(', ')}]`
    )
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
})
