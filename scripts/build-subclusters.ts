#!/usr/bin/env tsx
/**
 * Build sub-cluster nodes inside `data/genres.json`.
 *
 * For each cluster whose leaf count exceeds SPLIT_THRESHOLD, we apply the
 * keyword dictionary from `subcluster-keywords.ts` to route its leaves into
 * named sub-buckets. Leaves that match nothing drop into a sibling
 * "Other in [parent]" bucket (browsable, never further split).
 *
 * Recursion: sub-buckets whose leaf count still exceeds SPLIT_THRESHOLD get
 * re-split via `keywordsFor(subclusterId)` which falls back to the shared
 * REGIONAL_BUCKETS. Hard cap at MAX_DEPTH tiers from the root.
 *
 * Sub-clusters are navigation-only: no `lastfmTag`, ids prefixed
 * `SUBCLUSTER_`. The picker treats those nodes as non-selectable.
 *
 * Re-runnable: the script strips previously-generated SUBCLUSTER_ nodes
 * before rebuilding, so it can be run repeatedly after keyword edits.
 *
 * Usage: `pnpm tsx scripts/build-subclusters.ts`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GenreNode } from '../lib/types'
import { keywordsFor, ALPHABETICAL_BUCKETS, type KeywordBucket } from './subcluster-keywords'

const REPO_ROOT = join(__dirname, '..')
const GENRES_PATH = join(REPO_ROOT, 'data', 'genres.json')
const REPORT_PATH = join(REPO_ROOT, 'scripts', 'build-subclusters.report.json')

const SPLIT_THRESHOLD = 30
const MAX_DEPTH = 6 // anchor(1) + cluster(2) + sub(3) + sub(4) + alpha(5) + leaf(6)
// Buckets larger than this at terminal depth get the alphabetical fallback
// treatment rather than scrolling as a wall.
const ALPHA_FALLBACK_THRESHOLD = 80

interface GenresFile {
  generated: string
  source: string
  nodes: GenreNode[]
}

interface BucketStats {
  id: string
  label: string
  leafCount: number
  depth: number
  wasRecursivelySplit: boolean
}

interface ClusterReport {
  clusterId: string
  clusterLabel: string
  startingLeafCount: number
  subclustersCreated: number
  otherBucketSize: number
  maxDepthReached: number
  buckets: BucketStats[]
}

const report: ClusterReport[] = []

function stripGeneratedSubclusters(node: GenreNode): GenreNode {
  // Flatten any previously-created SUBCLUSTER_ nodes back to their leaf
  // descendants so the script is idempotent across runs.
  const children: GenreNode[] = []
  for (const child of node.children) {
    if (child.id.startsWith('SUBCLUSTER_')) {
      const leaves = collectLeaves(child)
      for (const leaf of leaves) children.push(leaf)
    } else {
      children.push(stripGeneratedSubclusters(child))
    }
  }
  return { ...node, children }
}

function collectLeaves(node: GenreNode): GenreNode[] {
  if (!node.children.length) return [node]
  const out: GenreNode[] = []
  for (const child of node.children) {
    for (const leaf of collectLeaves(child)) out.push(leaf)
  }
  return out
}

interface SplitResult {
  buckets: Map<string, { label: string; leaves: GenreNode[] }>
  other: GenreNode[]
}

function routeLeaves(leaves: GenreNode[], rules: KeywordBucket[]): SplitResult {
  const buckets = new Map<string, { label: string; leaves: GenreNode[] }>()
  const other: GenreNode[] = []
  for (const leaf of leaves) {
    const tag = leaf.lastfmTag
    let matched = false
    for (const rule of rules) {
      if (rule.pattern.test(tag)) {
        const existing = buckets.get(rule.id)
        if (existing) existing.leaves.push(leaf)
        else buckets.set(rule.id, { label: rule.label, leaves: [leaf] })
        matched = true
        break
      }
    }
    if (!matched) other.push(leaf)
  }
  return { buckets, other }
}

function splitNode(
  parent: GenreNode,
  parentDepth: number,
  clusterReport: ClusterReport,
): GenreNode {
  if (parent.children.length <= SPLIT_THRESHOLD) return parent
  if (parentDepth >= MAX_DEPTH - 1) return parent // one level left = leaves only

  let rules = keywordsFor(parent.id)
  let isAlphaPass = false

  // Try the contextual dictionary first…
  let splitAttempt = rules ? routeLeaves(parent.children, rules) : null

  // …if it didn't produce any matches (or wasn't defined) and the bucket is
  // still wall-sized, fall back to an alphabetical split so the user isn't
  // scrolling hundreds of leaves as one flat list.
  if (
    (!splitAttempt || splitAttempt.buckets.size === 0) &&
    parent.children.length > ALPHA_FALLBACK_THRESHOLD
  ) {
    rules = ALPHABETICAL_BUCKETS
    isAlphaPass = true
    splitAttempt = routeLeaves(parent.children, rules)
  }

  if (!splitAttempt || splitAttempt.buckets.size === 0) return parent

  const { buckets, other } = splitAttempt
  if (isAlphaPass && other.length > 0) {
    const fallback = buckets.get('uz') ?? buckets.values().next().value
    if (fallback) for (const leaf of other) fallback.leaves.push(leaf)
    other.length = 0
  }

  const newChildren: GenreNode[] = []

  for (const [subId, bucket] of buckets) {
    const fullId = `SUBCLUSTER_${stripPrefix(parent.id)}_${subId}`
    const subNode: GenreNode = {
      id: fullId,
      label: bucket.label,
      lastfmTag: '', // navigation-only, not selectable
      parentId: parent.id,
      children: bucket.leaves.map((leaf) => ({ ...leaf, parentId: fullId })),
    }

    const wasRecursivelySplit =
      subNode.children.length > SPLIT_THRESHOLD && parentDepth + 1 < MAX_DEPTH - 1

    const splitSub = splitNode(subNode, parentDepth + 1, clusterReport)
    newChildren.push(splitSub)

    clusterReport.buckets.push({
      id: fullId,
      label: bucket.label,
      leafCount: bucket.leaves.length,
      depth: parentDepth + 1,
      wasRecursivelySplit,
    })
    if (parentDepth + 1 > clusterReport.maxDepthReached) {
      clusterReport.maxDepthReached = parentDepth + 1
    }
  }

  if (other.length > 0) {
    const otherId = `SUBCLUSTER_${stripPrefix(parent.id)}_other`
    // Dedupe "Other Other More X" chains — if the parent is already an Other,
    // inherit its label instead of stacking another "Other ".
    const parentIsOther = /^Other (More |in )?/.test(parent.label)
    const otherNode: GenreNode = {
      id: otherId,
      label: parentIsOther ? parent.label : `Other in ${parent.label}`,
      lastfmTag: '',
      parentId: parent.id,
      children: other.map((leaf) => ({ ...leaf, parentId: otherId })),
    }
    // Recursively split the Other bucket too — if keywordsFor() returns a
    // different dictionary at this depth (e.g. REGIONAL_BUCKETS kicking in
    // for SUBCLUSTER_* ids), the giant junk-drawer gets sliced again.
    const splitOther = splitNode(otherNode, parentDepth + 1, clusterReport)
    newChildren.push(splitOther)
    clusterReport.buckets.push({
      id: otherId,
      label: otherNode.label,
      leafCount: other.length,
      depth: parentDepth + 1,
      wasRecursivelySplit: splitOther !== otherNode,
    })
    clusterReport.otherBucketSize = other.length
  }

  clusterReport.subclustersCreated = newChildren.length
  return { ...parent, children: newChildren }
}

function stripPrefix(id: string): string {
  // Turn "CLUSTER_rock_indie" → "rock_indie", "ANCHOR_pop_OTHER" → "pop_OTHER",
  // "SUBCLUSTER_pop_OTHER_bubble" → "pop_OTHER_bubble", so the next prefix
  // doesn't produce SUBCLUSTER_SUBCLUSTER_… chains.
  return id.replace(/^(ANCHOR_|CLUSTER_|SUBCLUSTER_)/, '')
}

function processCluster(cluster: GenreNode): GenreNode {
  const stripped = stripGeneratedSubclusters(cluster)
  if (stripped.children.length <= SPLIT_THRESHOLD) return stripped

  const clusterReport: ClusterReport = {
    clusterId: stripped.id,
    clusterLabel: stripped.label,
    startingLeafCount: stripped.children.length,
    subclustersCreated: 0,
    otherBucketSize: 0,
    maxDepthReached: 0,
    buckets: [],
  }
  const split = splitNode(stripped, 2, clusterReport) // cluster sits at depth 2 under anchor
  report.push(clusterReport)
  return split
}

function main() {
  const raw = readFileSync(GENRES_PATH, 'utf-8')
  const data = JSON.parse(raw) as GenresFile

  const outNodes: GenreNode[] = data.nodes.map((anchor) => {
    const newClusters = anchor.children.map((cluster) => processCluster(cluster))
    return { ...anchor, children: newClusters }
  })

  // Strip any prior "+subclustered" tags before re-appending, so repeated
  // runs don't pile up "+subclustered+subclustered+…".
  const baseSource = data.source.replace(/(\+subclustered)+$/, '')
  const outData: GenresFile = {
    ...data,
    generated: new Date().toISOString().slice(0, 10),
    source: `${baseSource}+subclustered`,
    nodes: outNodes,
  }

  writeFileSync(GENRES_PATH, JSON.stringify(outData, null, 2) + '\n')

  const summary = {
    generated: outData.generated,
    splitThreshold: SPLIT_THRESHOLD,
    maxDepth: MAX_DEPTH,
    clustersProcessed: report.length,
    clustersOverThreshold: report.filter((r) => r.startingLeafCount > SPLIT_THRESHOLD).length,
    totalSubclustersCreated: report.reduce((s, r) => s + r.subclustersCreated, 0),
    deepestCluster: report.reduce(
      (acc, r) => (r.maxDepthReached > acc.maxDepthReached ? r : acc),
      { clusterId: '', maxDepthReached: 0 } as ClusterReport,
    ).clusterId,
    reports: report.sort((a, b) => b.startingLeafCount - a.startingLeafCount),
  }
  writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2) + '\n')

  console.log(`Processed ${report.length} clusters`)
  console.log(`Created ${summary.totalSubclustersCreated} sub-clusters total`)
  console.log(`Updated ${GENRES_PATH}`)
  console.log(`Wrote ${REPORT_PATH}`)

  // Print top offenders still over the threshold after routing
  const stillLarge: { id: string; label: string; n: number }[] = []
  function scan(node: GenreNode, depth: number) {
    if (node.children.length > SPLIT_THRESHOLD && !node.id.startsWith('ANCHOR_')) {
      stillLarge.push({ id: node.id, label: node.label, n: node.children.length })
    }
    for (const child of node.children) scan(child, depth + 1)
  }
  for (const anchor of outNodes) scan(anchor, 0)
  stillLarge.sort((a, b) => b.n - a.n)
  if (stillLarge.length) {
    console.log(`\nNodes still over ${SPLIT_THRESHOLD} leaves after routing:`)
    for (const x of stillLarge.slice(0, 30)) {
      console.log(`  ${String(x.n).padStart(5)}  ${x.id}  (${x.label})`)
    }
  }
}

main()
