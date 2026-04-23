/**
 * Automated Last.fm validation pass over data/genres.json.
 *
 * For each leaf in the tree, asks Last.fm which tags cluster around it (via
 * `tag.getSimilar`; fallback to `tag.getTopArtists` + `artist.getTopTags`
 * when similar is thin). Each discovered tag is mapped back to its anchor
 * AND cluster in our existing tree. The dominant anchor across the
 * evidence is compared to the leaf's current anchor. When disagreement is
 * detected, the dominant cluster WITHIN the inferred anchor is computed
 * the same way so the leaf has a concrete target on a reassignment.
 *
 * Two modes:
 *   1. REPORT (default) — writes validate-genre-tree.report.json advisory.
 *   2. APPLY (`--apply`) — mutates data/genres.json in place, moving leaves
 *      with confidence ≥ threshold (default 0.75) to their inferred
 *      (anchor, cluster) placement. Writes validate-genre-tree.applied.json
 *      as the audit log of what was moved.
 *
 * Usage:
 *   # Inference only
 *   LASTFM_API_KEY=xxx npx tsx scripts/validate-genre-tree.ts
 *
 *   # Inference + auto-apply at the default 0.75 threshold
 *   LASTFM_API_KEY=xxx npx tsx scripts/validate-genre-tree.ts --apply
 *
 *   # Custom threshold (higher = more conservative)
 *   LASTFM_API_KEY=xxx npx tsx scripts/validate-genre-tree.ts --apply --apply-threshold=0.8
 *
 * Resumable: a checkpoint file records which leafIds have been processed,
 * so Ctrl+C + re-run picks up where it left off. `--apply` is a separate
 * post-pass on the accumulated checkpoint, so inference and application
 * can be staged.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

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

interface EvidenceEntry {
  tag: string
  weight: number      // Last.fm similarity weight, 0–1
  anchor: string | null
}

interface DiffRow {
  leafId: string
  leafLabel: string
  lastfmTag: string
  currentAnchor: string
  currentCluster: string
  inferredAnchor: string
  /**
   * Best-fitting cluster within the inferred anchor. Null when no evidence
   * tag maps to any cluster under the inferred anchor — `--apply` then
   * falls back to the anchor's first cluster so the leaf still lands
   * somewhere sensible.
   */
  inferredCluster: string | null
  confidence: number       // 0–1; (anchor's weight) / (sum of all anchor weights)
  clusterConfidence: number  // same math within the inferred anchor; 0 when inferredCluster null
  evidence: EvidenceEntry[]  // top ~15 contributing tags
}

const CHECKPOINT_SCHEMA = 2  // bumped when DiffRow gained cluster fields

interface Checkpoint {
  schemaVersion?: number
  processedLeafIds: string[]
  diffs: DiffRow[]
  startedAt: string
  lastSavedAt: string
}

// ── Config ───────────────────────────────────────────────────────────────

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0'
const TIMEOUT_MS = 8000
const RATE_LIMIT_DELAY_MS = 500  // ≈2 req/s — Last.fm allows 5/s but we stay conservative
const CONFIDENCE_THRESHOLD = 0.6       // threshold for a diff ENTERING the report
const DEFAULT_APPLY_THRESHOLD = 0.75   // higher bar for AUTO-APPLY — overridable via --apply-threshold
const SIMILAR_MIN = 5                  // below this, fall back to top-artists+their-top-tags
const TOP_ARTIST_FALLBACK = 3          // how many top artists to probe for tags
const EVIDENCE_CAP = 15                // how many evidence rows to keep per diff

const CHECKPOINT_PATH = join(process.cwd(), 'scripts', 'validate-genre-tree.checkpoint.json')
const REPORT_PATH = join(process.cwd(), 'scripts', 'validate-genre-tree.report.json')
const APPLIED_LOG_PATH = join(process.cwd(), 'scripts', 'validate-genre-tree.applied.json')
const GENRES_PATH = join(process.cwd(), 'data', 'genres.json')

// ── CLI args ─────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean
  applyThreshold: number
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false
  let applyThreshold = DEFAULT_APPLY_THRESHOLD
  for (const a of argv.slice(2)) {
    if (a === '--apply') { apply = true; continue }
    const m = a.match(/^--apply-threshold=(.+)$/)
    if (m) {
      const v = parseFloat(m[1])
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`--apply-threshold must be a number 0-1, got "${m[1]}"`)
      }
      applyThreshold = v
      apply = true  // setting a threshold implies apply
      continue
    }
    if (a === '-h' || a === '--help') {
      console.log('Usage: validate-genre-tree.ts [--apply] [--apply-threshold=0.75]')
      process.exit(0)
    }
    throw new Error(`Unknown arg: ${a}`)
  }
  return { apply, applyThreshold }
}

// ── Tree walk ────────────────────────────────────────────────────────────

function loadTree(): GenreData {
  const raw = readFileSync(GENRES_PATH, 'utf-8')
  return JSON.parse(raw) as GenreData
}

/**
 * Walk the tree and return every leaf along with its anchor and cluster.
 * Only true leaves (children.length === 0) are returned; intermediate
 * cluster nodes are skipped — their placement is a design decision, not
 * a data issue.
 */
function collectLeaves(
  data: GenreData
): { leaf: GenreNode; anchorId: string; clusterId: string }[] {
  const out: { leaf: GenreNode; anchorId: string; clusterId: string }[] = []
  function walk(node: GenreNode, anchorId: string, clusterId: string) {
    if (!node.children || node.children.length === 0) {
      // True leaf: skip navigation-only entries just in case (no lastfmTag).
      if (node.lastfmTag) out.push({ leaf: node, anchorId, clusterId })
      return
    }
    for (const child of node.children) walk(child, anchorId, clusterId)
  }
  for (const anchor of data.nodes) {
    for (const cluster of anchor.children) {
      for (const child of cluster.children) walk(child, anchor.id, cluster.id)
    }
  }
  return out
}

interface TagIndex {
  tagToAnchor: Map<string, string>
  /** lastfmTag → { anchorId, clusterId }; cluster-level reverse lookup for evidence */
  tagToCluster: Map<string, { anchorId: string; clusterId: string }>
  /** anchorId → [clusterId, ...] in tree order (for --apply fallback) */
  anchorClusters: Map<string, string[]>
}

function buildTagIndex(data: GenreData): TagIndex {
  const tagToAnchor = new Map<string, string>()
  const tagToCluster = new Map<string, { anchorId: string; clusterId: string }>()
  const anchorClusters = new Map<string, string[]>()

  function indexDeep(node: GenreNode, anchorId: string, clusterId: string) {
    // Skip navigation-only SUBCLUSTER_ nodes — their lastfmTag is "".
    if (node.lastfmTag) {
      const key = node.lastfmTag.toLowerCase()
      if (!tagToAnchor.has(key)) tagToAnchor.set(key, anchorId)
      if (!tagToCluster.has(key)) tagToCluster.set(key, { anchorId, clusterId })
    }
    for (const child of node.children) indexDeep(child, anchorId, clusterId)
  }
  for (const anchor of data.nodes) {
    tagToAnchor.set(anchor.lastfmTag.toLowerCase(), anchor.id)
    const clusterIds: string[] = []
    for (const cluster of anchor.children) {
      clusterIds.push(cluster.id)
      tagToAnchor.set(cluster.lastfmTag.toLowerCase(), anchor.id)
      tagToCluster.set(cluster.lastfmTag.toLowerCase(), { anchorId: anchor.id, clusterId: cluster.id })
      for (const child of cluster.children) indexDeep(child, anchor.id, cluster.id)
    }
    anchorClusters.set(anchor.id, clusterIds)
  }

  return { tagToAnchor, tagToCluster, anchorClusters }
}

// ── Last.fm ──────────────────────────────────────────────────────────────

const apiKey = process.env.LASTFM_API_KEY
if (!apiKey) {
  console.error('Missing LASTFM_API_KEY environment variable.')
  process.exit(1)
}

let lastCallAt = 0
async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const elapsed = Date.now() - lastCallAt
  if (elapsed < RATE_LIMIT_DELAY_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS - elapsed))
  }
  lastCallAt = Date.now()
  return fn()
}

async function lastfmCall(params: Record<string, string>): Promise<unknown> {
  const url = new URL(LASTFM_BASE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('api_key', apiKey!)
  url.searchParams.set('format', 'json')
  return rateLimited(async () => {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Last.fm ${res.status}: ${res.statusText}`)
    return res.json()
  })
}

async function tagGetSimilar(tag: string): Promise<{ name: string; weight: number }[]> {
  try {
    const data = (await lastfmCall({ method: 'tag.getsimilar', tag })) as {
      similartags?: { tag?: Array<{ name?: string; match?: string | number }> }
    }
    const arr = data?.similartags?.tag
    if (!Array.isArray(arr)) return []
    return arr
      .map((t) => ({
        name: (t.name ?? '').toLowerCase(),
        weight: typeof t.match === 'number' ? t.match : parseFloat((t.match as string | undefined) ?? '0') || 0,
      }))
      .filter((t) => t.name)
  } catch (err) {
    console.warn(`  tag.getSimilar("${tag}") failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

async function tagGetTopArtists(tag: string, limit = 10): Promise<string[]> {
  try {
    const data = (await lastfmCall({ method: 'tag.gettopartists', tag, limit: String(limit) })) as {
      topartists?: { artist?: Array<{ name?: string }> }
    }
    const arr = data?.topartists?.artist
    if (!Array.isArray(arr)) return []
    return arr.map((a) => a.name ?? '').filter(Boolean)
  } catch (err) {
    console.warn(`  tag.getTopArtists("${tag}") failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

async function artistGetTopTags(artist: string): Promise<{ name: string; weight: number }[]> {
  try {
    const data = (await lastfmCall({ method: 'artist.gettoptags', artist })) as {
      toptags?: { tag?: Array<{ name?: string; count?: string | number }> }
    }
    const arr = data?.toptags?.tag
    if (!Array.isArray(arr)) return []
    return arr
      .map((t) => ({
        name: (t.name ?? '').toLowerCase(),
        // Last.fm artist.getTopTags returns a 0–100 count — normalize to 0–1.
        weight: (typeof t.count === 'number' ? t.count : parseFloat((t.count as string | undefined) ?? '0') || 0) / 100,
      }))
      .filter((t) => t.name)
  } catch (err) {
    console.warn(`  artist.getTopTags("${artist}") failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

// ── Evidence → anchor inference ──────────────────────────────────────────

async function gatherEvidence(tag: string): Promise<{ name: string; weight: number }[]> {
  const primary = await tagGetSimilar(tag)
  if (primary.length >= SIMILAR_MIN) return primary

  // Fallback: probe the tag's top artists and merge their top tags.
  const artists = await tagGetTopArtists(tag, 10)
  if (artists.length === 0) return primary
  const picked = artists.slice(0, TOP_ARTIST_FALLBACK)
  const merged = new Map<string, number>()
  for (const p of primary) merged.set(p.name, p.weight)

  for (const artist of picked) {
    const tags = await artistGetTopTags(artist)
    for (const t of tags) {
      // Don't let the seed tag count as evidence for itself.
      if (t.name === tag.toLowerCase()) continue
      merged.set(t.name, (merged.get(t.name) ?? 0) + t.weight)
    }
  }
  return [...merged.entries()].map(([name, weight]) => ({ name, weight }))
}

interface Inference {
  anchor: string | null
  confidence: number
  cluster: string | null
  clusterConfidence: number
  topEvidence: EvidenceEntry[]
}

function inferAnchor(
  evidence: { name: string; weight: number }[],
  idx: TagIndex
): Inference {
  const byAnchor = new Map<string, number>()
  let total = 0
  const topEvidence: EvidenceEntry[] = []

  for (const { name, weight } of evidence) {
    const anchor = idx.tagToAnchor.get(name) ?? null
    topEvidence.push({ tag: name, weight, anchor })
    if (anchor === null || weight <= 0) continue
    byAnchor.set(anchor, (byAnchor.get(anchor) ?? 0) + weight)
    total += weight
  }

  topEvidence.sort((a, b) => b.weight - a.weight)
  topEvidence.splice(EVIDENCE_CAP)

  if (total === 0) return { anchor: null, confidence: 0, cluster: null, clusterConfidence: 0, topEvidence }

  let bestAnchor: string | null = null
  let bestAnchorWeight = 0
  for (const [anchor, w] of byAnchor) {
    if (w > bestAnchorWeight) {
      bestAnchorWeight = w
      bestAnchor = anchor
    }
  }

  // Second pass: among evidence tags whose CLUSTER is inside the winning
  // anchor, compute the dominant cluster. This gives --apply a concrete
  // (anchor, cluster) landing zone for each reassigned leaf.
  let bestCluster: string | null = null
  let bestClusterWeight = 0
  let clusterTotal = 0
  if (bestAnchor) {
    const byCluster = new Map<string, number>()
    for (const { name, weight } of evidence) {
      if (weight <= 0) continue
      const tc = idx.tagToCluster.get(name)
      if (!tc || tc.anchorId !== bestAnchor) continue
      byCluster.set(tc.clusterId, (byCluster.get(tc.clusterId) ?? 0) + weight)
      clusterTotal += weight
    }
    for (const [cid, w] of byCluster) {
      if (w > bestClusterWeight) {
        bestClusterWeight = w
        bestCluster = cid
      }
    }
  }

  return {
    anchor: bestAnchor,
    confidence: bestAnchorWeight / total,
    cluster: bestCluster,
    clusterConfidence: clusterTotal > 0 ? bestClusterWeight / clusterTotal : 0,
    topEvidence,
  }
}

// ── Checkpoint / main ────────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_PATH)) return null
  try {
    const parsed = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8')) as Checkpoint
    if ((parsed.schemaVersion ?? 1) < CHECKPOINT_SCHEMA) {
      console.warn(
        `[checkpoint] found v${parsed.schemaVersion ?? 1}, current is v${CHECKPOINT_SCHEMA}. ` +
        `Ignoring stale checkpoint — run will restart from scratch.`
      )
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveCheckpoint(ckpt: Checkpoint): void {
  ckpt.schemaVersion = CHECKPOINT_SCHEMA
  ckpt.lastSavedAt = new Date().toISOString()
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(ckpt, null, 2), 'utf-8')
}

// ── --apply mutation ─────────────────────────────────────────────────────

interface AppliedRow {
  leafId: string
  leafLabel: string
  lastfmTag: string
  from: { anchor: string; cluster: string }
  to: { anchor: string; cluster: string; clusterFallback: boolean }
  confidence: number
  clusterConfidence: number
}

/**
 * Mutate the in-memory tree: for each diff above the threshold, move the
 * leaf from its current cluster to the inferred (anchor, cluster). Falls
 * back to the first cluster in the inferred anchor when cluster inference
 * yields nothing. Returns the audit log of changes applied.
 *
 * Leaves that are already in the target anchor (anchor change was already
 * applied in a prior run) are a no-op. Leaves whose source cluster can't
 * be found (stale checkpoint) are skipped with a warning.
 */
function applyReassignments(
  data: GenreData,
  diffs: DiffRow[],
  threshold: number
): AppliedRow[] {
  const applied: AppliedRow[] = []

  // Build id → node maps for O(1) lookup/mutation.
  const anchorById = new Map<string, GenreNode>()
  const clusterById = new Map<string, GenreNode>()
  const clusterToAnchor = new Map<string, string>()
  for (const anchor of data.nodes) {
    anchorById.set(anchor.id, anchor)
    for (const cluster of anchor.children) {
      clusterById.set(cluster.id, cluster)
      clusterToAnchor.set(cluster.id, anchor.id)
    }
  }

  const eligible = diffs.filter((d) => d.confidence >= threshold)
  console.log(`\n[apply] ${eligible.length}/${diffs.length} diffs pass threshold ${threshold}.`)

  for (const diff of eligible) {
    const sourceCluster = clusterById.get(diff.currentCluster)
    const targetAnchor = anchorById.get(diff.inferredAnchor)
    if (!sourceCluster) {
      console.warn(`  [skip] ${diff.leafLabel}: source cluster ${diff.currentCluster} not found`)
      continue
    }
    if (!targetAnchor) {
      console.warn(`  [skip] ${diff.leafLabel}: target anchor ${diff.inferredAnchor} not found`)
      continue
    }

    const leafIdx = sourceCluster.children.findIndex((n) => n.id === diff.leafId)
    if (leafIdx < 0) {
      // Already moved in a prior pass, or id drift.
      console.warn(`  [skip] ${diff.leafLabel}: leaf not present in source cluster`)
      continue
    }

    // Resolve target cluster: prefer inferredCluster, fall back to anchor's first.
    let targetClusterId = diff.inferredCluster
    let clusterFallback = false
    if (!targetClusterId || !clusterById.has(targetClusterId) || clusterToAnchor.get(targetClusterId) !== targetAnchor.id) {
      targetClusterId = targetAnchor.children[0]?.id ?? null
      clusterFallback = true
    }
    if (!targetClusterId) {
      console.warn(`  [skip] ${diff.leafLabel}: target anchor ${targetAnchor.id} has no clusters`)
      continue
    }
    const targetCluster = clusterById.get(targetClusterId)!

    const [leaf] = sourceCluster.children.splice(leafIdx, 1)
    leaf.parentId = targetCluster.id
    targetCluster.children.push(leaf)
    targetCluster.children.sort((a, b) => a.label.localeCompare(b.label))

    console.log(
      `  [move] ${diff.leafLabel}: ${sourceCluster.id} → ${targetCluster.id}` +
      (clusterFallback ? ' (fallback: first cluster)' : '')
    )

    applied.push({
      leafId: diff.leafId,
      leafLabel: diff.leafLabel,
      lastfmTag: diff.lastfmTag,
      from: { anchor: diff.currentAnchor, cluster: diff.currentCluster },
      to: { anchor: targetAnchor.id, cluster: targetCluster.id, clusterFallback },
      confidence: diff.confidence,
      clusterConfidence: diff.clusterConfidence,
    })
  }

  return applied
}

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs(process.argv)
  const data = loadTree()
  const tagIndex = buildTagIndex(data)
  const leaves = collectLeaves(data)

  const existing = loadCheckpoint()
  const ckpt: Checkpoint = existing ?? {
    processedLeafIds: [],
    diffs: [],
    startedAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString(),
  }
  const processedSet = new Set(ckpt.processedLeafIds)

  console.log(`Validating ${leaves.length} leaves (${processedSet.size} already done).`)
  if (cli.apply) {
    console.log(`--apply enabled (threshold ${cli.applyThreshold}) — will mutate data/genres.json at end of run.`)
  }

  let done = 0
  for (const { leaf, anchorId, clusterId } of leaves) {
    if (processedSet.has(leaf.id)) continue
    done++
    const prefix = `[${processedSet.size + done}/${leaves.length}]`
    console.log(`${prefix} ${leaf.label} (${leaf.lastfmTag}) …`)

    const evidence = await gatherEvidence(leaf.lastfmTag)
    const { anchor, confidence, cluster, clusterConfidence, topEvidence } = inferAnchor(evidence, tagIndex)

    if (anchor && anchor !== anchorId && confidence >= CONFIDENCE_THRESHOLD) {
      console.log(
        `  → DIFF: ${anchorId} → ${anchor} (anchor-conf ${confidence.toFixed(2)}, ` +
        `cluster-conf ${clusterConfidence.toFixed(2)})`
      )
      ckpt.diffs.push({
        leafId: leaf.id,
        leafLabel: leaf.label,
        lastfmTag: leaf.lastfmTag,
        currentAnchor: anchorId,
        currentCluster: clusterId,
        inferredAnchor: anchor,
        inferredCluster: cluster,
        confidence,
        clusterConfidence,
        evidence: topEvidence,
      })
    }

    processedSet.add(leaf.id)
    ckpt.processedLeafIds = [...processedSet]

    // Checkpoint every 10 leaves to keep write volume sane while still being
    // Ctrl+C safe.
    if (done % 10 === 0) saveCheckpoint(ckpt)
  }

  saveCheckpoint(ckpt)

  const report = {
    generatedAt: new Date().toISOString(),
    totalLeaves: leaves.length,
    diffCount: ckpt.diffs.length,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    diffs: ckpt.diffs.sort((a, b) => b.confidence - a.confidence),
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`\nDone. ${ckpt.diffs.length} proposed reassignments written to ${REPORT_PATH}.`)

  if (!cli.apply) {
    console.log('Review the report. Re-run with --apply to auto-apply reassignments.')
    return
  }

  // ── --apply pass ──────────────────────────────────────────────────────
  const applied = applyReassignments(data, ckpt.diffs, cli.applyThreshold)

  if (applied.length === 0) {
    console.log('[apply] No changes made.')
    return
  }

  data.generated = new Date().toISOString()
  data.source = `${data.source} + validated-lastfm@${cli.applyThreshold}`
  writeFileSync(GENRES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')

  const appliedLog = {
    appliedAt: new Date().toISOString(),
    threshold: cli.applyThreshold,
    totalApplied: applied.length,
    totalDiffs: ckpt.diffs.length,
    reassignments: applied.sort((a, b) => b.confidence - a.confidence),
  }
  writeFileSync(APPLIED_LOG_PATH, JSON.stringify(appliedLog, null, 2), 'utf-8')

  console.log(`\n[apply] Applied ${applied.length} reassignments.`)
  console.log(`[apply] data/genres.json updated; audit log → ${APPLIED_LOG_PATH}`)
  console.log('[apply] Suggested next step: re-run without --apply to verify stability.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
