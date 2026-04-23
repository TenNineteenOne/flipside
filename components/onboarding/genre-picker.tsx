"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Search, X } from "lucide-react"
import genreData from "@/data/genres.json"
import type { GenreNode } from "@/lib/types"
import { normalizeGenre } from "@/lib/genre/normalize"
import { adjacentGenres } from "@/lib/genre/adjacency"

export const ALL_GENRES: GenreNode[] = (genreData as { nodes: GenreNode[] }).nodes

function countSelectedInTree(node: GenreNode, selectedIds: Set<string>): number {
  let n = selectedIds.has(node.id) ? 1 : 0
  for (const child of node.children) n += countSelectedInTree(child, selectedIds)
  return n
}

function countLeaves(node: GenreNode): number {
  if (node.children.length === 0) return 1
  return node.children.reduce((n, c) => n + countLeaves(c), 0)
}

/**
 * Flat index walking the genre tree once: maps every node's lastfmTag
 * (normalized) → { node, anchorLabel } so search and adjacency chips can
 * resolve tags to selectable nodes without re-walking on every keystroke.
 *
 * Built once at module load; tree is static.
 */
interface FlatEntry {
  node: GenreNode
  anchorLabel: string
  anchorId: string
  isLeaf: boolean
}

const FLAT_INDEX: FlatEntry[] = (() => {
  const out: FlatEntry[] = []
  function walk(node: GenreNode, anchorLabel: string, anchorId: string) {
    const isLeaf = node.children.length === 0
    out.push({ node, anchorLabel, anchorId, isLeaf })
    for (const child of node.children) walk(child, anchorLabel, anchorId)
  }
  for (const anchor of ALL_GENRES) walk(anchor, anchor.label, anchor.id)
  return out
})()

const TAG_TO_ENTRY = new Map<string, FlatEntry>()
for (const e of FLAT_INDEX) {
  const key = normalizeGenre(e.node.lastfmTag)
  if (!key) continue // navigation-only sub-clusters have no lastfmTag
  if (!TAG_TO_ENTRY.has(key)) TAG_TO_ENTRY.set(key, e)
}

export interface GenrePickerProps {
  selected: GenreNode[]
  onToggle: (node: GenreNode) => void
  cap: number
}

export function GenrePicker({ selected, onToggle, cap }: GenrePickerProps) {
  const [openAnchors, setOpenAnchors] = useState<Set<string>>(new Set())
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set())
  const [rawQuery, setRawQuery] = useState("")
  const [query, setQuery] = useState("")
  const [lastLeaf, setLastLeaf] = useState<GenreNode | null>(null)

  // Debounce search input by 150ms so each keystroke doesn't re-walk the tree.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery.trim()), 150)
    return () => clearTimeout(t)
  }, [rawQuery])

  const selectedIds = useMemo(() => new Set(selected.map((g) => g.id)), [selected])
  const atCap = selected.length >= cap

  const toggleAnchor = (id: string) => {
    setOpenAnchors((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCluster = (id: string) => {
    setOpenClusters((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Wrap the caller's onToggle so leaf selections drive the "Related" chips. */
  const handleToggle = (node: GenreNode) => {
    onToggle(node)
    const entry = TAG_TO_ENTRY.get(normalizeGenre(node.lastfmTag))
    if (entry?.isLeaf && !selectedIds.has(node.id)) {
      // We ran onToggle above; selectedIds is stale by one tick. A leaf is
      // being freshly selected here, so surface chips.
      setLastLeaf(node)
    }
  }

  // Related-genre chips: compute once per lastLeaf change.
  const relatedChips = useMemo(() => {
    if (!lastLeaf) return []
    const adjacents = adjacentGenres(lastLeaf.lastfmTag, "close")
    const chips: GenreNode[] = []
    for (const tag of adjacents) {
      const entry = TAG_TO_ENTRY.get(normalizeGenre(tag))
      if (!entry) continue
      if (selectedIds.has(entry.node.id)) continue
      chips.push(entry.node)
      if (chips.length >= 5) break
    }
    return chips
  }, [lastLeaf, selectedIds])

  const searchMatches = useMemo(() => {
    if (!query) return null
    const nq = normalizeGenre(query)
    const out: FlatEntry[] = []
    for (const entry of FLAT_INDEX) {
      // Skip navigation-only sub-clusters — they have no lastfmTag and
      // can't be selected anyway.
      if (!entry.node.lastfmTag) continue
      const hay = `${normalizeGenre(entry.node.label)} ${normalizeGenre(entry.node.lastfmTag)}`
      if (hay.includes(nq)) out.push(entry)
      if (out.length >= 100) break
    }
    return out
  }, [query])

  return (
    <div className="col gap-10">
      {/* Search bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <Search size={14} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
        <input
          type="text"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search genres — post-rock, lo-fi, dream pop…"
          style={{
            flex: 1,
            border: 0,
            background: "transparent",
            color: "var(--text-primary)",
            fontSize: 13,
            outline: "none",
          }}
        />
        {rawQuery && (
          <button
            type="button"
            onClick={() => setRawQuery("")}
            aria-label="Clear search"
            style={{
              background: "none",
              border: 0,
              cursor: "pointer",
              color: "var(--text-faint)",
              padding: 2,
              display: "flex",
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Related-genre chips — shown after the user just selected a leaf. */}
      {relatedChips.length > 0 && !searchMatches && (
        <div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--text-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 6,
            }}
          >
            Related to {lastLeaf?.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {relatedChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleToggle(chip)}
                disabled={atCap}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--border-strong)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  cursor: atCap ? "not-allowed" : "pointer",
                  opacity: atCap ? 0.5 : 1,
                }}
              >
                + {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {searchMatches ? (
        <SearchResults
          matches={searchMatches}
          selectedIds={selectedIds}
          atCap={atCap}
          onToggle={handleToggle}
        />
      ) : (
        <div className="col gap-6">
          {ALL_GENRES.map((anchor) => (
            <GenreBranch
              key={anchor.id}
              node={anchor}
              depth={0}
              openAnchors={openAnchors}
              openClusters={openClusters}
              onToggleAnchor={toggleAnchor}
              onToggleCluster={toggleCluster}
              selectedIds={selectedIds}
              atCap={atCap}
              onToggleSelect={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Sub-clusters are navigation-only — no lastfmTag, no checkbox. */
function isNavigationOnly(node: GenreNode): boolean {
  return node.id.startsWith("SUBCLUSTER_") || node.lastfmTag === ""
}

function SearchResults({
  matches,
  selectedIds,
  atCap,
  onToggle,
}: {
  matches: FlatEntry[]
  selectedIds: Set<string>
  atCap: boolean
  onToggle: (node: GenreNode) => void
}) {
  if (matches.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 12.5, padding: "10px 4px", textAlign: "center" }}>
        No genres match. Try a broader term.
      </div>
    )
  }
  // Group by anchor so results have context.
  const byAnchor = new Map<string, { anchorLabel: string; items: FlatEntry[] }>()
  for (const m of matches) {
    const g = byAnchor.get(m.anchorId)
    if (g) g.items.push(m)
    else byAnchor.set(m.anchorId, { anchorLabel: m.anchorLabel, items: [m] })
  }
  return (
    <div className="col gap-10">
      {[...byAnchor.values()].map((group) => (
        <div key={group.anchorLabel}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--text-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            {group.anchorLabel}
          </div>
          <div className="col gap-2">
            {group.items.map((entry) => {
              const sel = selectedIds.has(entry.node.id)
              return (
                <GenreRow
                  key={entry.node.id}
                  label={entry.node.label}
                  selected={sel}
                  disabled={!sel && atCap}
                  onClick={() => onToggle(entry.node)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Recursive branch renderer. Handles any depth of the genre tree:
 *   depth 0 — anchors ("Rock", "Pop"…): selectable, outer card
 *   depth 1 — clusters ("Indie & Alternative", "House"…): selectable, inner card
 *   depth 2+ — sub-clusters ("Dream Pop & Shoegaze", "A"…): navigation-only
 *              unless its lastfmTag is set (defensive — real tags stay selectable)
 *
 * Leaves render via GenreRow from within this component — no separate leaf
 * handler needed.
 */
function GenreBranch({
  node,
  depth,
  openAnchors,
  openClusters,
  onToggleAnchor,
  onToggleCluster,
  selectedIds,
  atCap,
  onToggleSelect,
}: {
  node: GenreNode
  depth: number
  openAnchors: Set<string>
  openClusters: Set<string>
  onToggleAnchor: (id: string) => void
  onToggleCluster: (id: string) => void
  selectedIds: Set<string>
  atCap: boolean
  onToggleSelect: (node: GenreNode) => void
}) {
  const isLeaf = node.children.length === 0
  if (isLeaf) {
    const sel = selectedIds.has(node.id)
    return (
      <GenreRow
        label={node.label}
        selected={sel}
        disabled={!sel && atCap}
        onClick={() => onToggleSelect(node)}
      />
    )
  }

  // Use openAnchors for depth 0 so the user can keep several anchors open
  // at once; use openClusters for every deeper non-leaf node.
  const expanded =
    depth === 0 ? openAnchors.has(node.id) : openClusters.has(node.id)
  const onToggleExpand =
    depth === 0 ? () => onToggleAnchor(node.id) : () => onToggleCluster(node.id)

  const selfSelected = selectedIds.has(node.id)
  const totalSelected = countSelectedInTree(node, selectedIds)
  const totalLeaves = countLeaves(node)
  const navOnly = isNavigationOnly(node)

  // Visual style tiers: anchor > cluster > sub-cluster > deep
  const style = branchStyle(depth, expanded)

  return (
    <div style={style.wrapper}>
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: style.gap,
          width: "100%",
          padding: style.padding,
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: style.labelSize,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: navOnly ? "var(--text-secondary)" : "var(--text-primary)",
            }}
          >
            {node.label}
            {totalSelected > 0 && (
              <span
                className="mono"
                style={{
                  fontSize: style.badgeSize,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(139,92,246,0.2)",
                  color: "var(--accent)",
                }}
              >
                {totalSelected}
              </span>
            )}
          </div>
          <div
            className="mono"
            style={{ fontSize: style.subSize, color: "var(--text-muted)", marginTop: 1 }}
          >
            {depth === 0
              ? `${node.children.length} groups · ${totalLeaves} sub-genres`
              : `${totalLeaves} sub-genre${totalLeaves === 1 ? "" : "s"}`}
          </div>
        </div>
        <div style={{ color: "var(--text-faint)", flexShrink: 0 }}>
          {expanded ? <ChevronUp size={style.chevronSize} /> : <ChevronDown size={style.chevronSize} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: style.innerPadding, borderTop: "1px solid var(--border)" }}>
          {!navOnly && (
            <GenreRow
              label={`Select all of ${node.label}`}
              selected={selfSelected}
              disabled={!selfSelected && atCap}
              onClick={() => onToggleSelect(node)}
              emphasis
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: navOnly ? 0 : 6 }}>
            {node.children.map((child) => (
              <GenreBranch
                key={child.id}
                node={child}
                depth={depth + 1}
                openAnchors={openAnchors}
                openClusters={openClusters}
                onToggleAnchor={onToggleAnchor}
                onToggleCluster={onToggleCluster}
                selectedIds={selectedIds}
                atCap={atCap}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Depth-scaled visual tiers so the tree reads at any drill-down level. */
function branchStyle(depth: number, expanded: boolean) {
  if (depth === 0) {
    return {
      wrapper: {
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: expanded ? "rgba(255,255,255,0.02)" : "transparent",
        overflow: "hidden",
        transition: "background 0.15s",
      } as React.CSSProperties,
      padding: "10px 12px",
      innerPadding: "6px 8px 10px",
      labelSize: 13.5,
      subSize: 10.5,
      badgeSize: 10,
      chevronSize: 14,
      gap: 10,
    }
  }
  if (depth === 1) {
    return {
      wrapper: {
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: expanded ? "rgba(255,255,255,0.03)" : "transparent",
        overflow: "hidden",
      } as React.CSSProperties,
      padding: "8px 10px",
      innerPadding: "4px 6px 8px",
      labelSize: 12.5,
      subSize: 10,
      badgeSize: 9.5,
      chevronSize: 12,
      gap: 8,
    }
  }
  // depth ≥ 2 — sub-clusters, no card background
  return {
    wrapper: {
      borderRadius: 6,
      border: 0,
      background: "transparent",
      overflow: "hidden",
      borderLeft: expanded ? "2px solid rgba(139,92,246,0.25)" : "2px solid transparent",
      marginLeft: 2,
    } as React.CSSProperties,
    padding: "6px 8px",
    innerPadding: "2px 0 4px 8px",
    labelSize: 12,
    subSize: 9.5,
    badgeSize: 9,
    chevronSize: 12,
    gap: 6,
  }
}

function GenreRow({
  label,
  selected,
  disabled,
  onClick,
  emphasis,
}: {
  label: string
  selected: boolean
  disabled?: boolean
  onClick: () => void
  emphasis?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        background: selected ? "var(--accent-soft)" : "transparent",
        border: 0,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        color: disabled ? "var(--text-faint)" : "var(--text-primary)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
          background: selected ? "var(--accent)" : "transparent",
          flexShrink: 0,
          boxShadow: selected ? "0 0 8px var(--accent-glow)" : "none",
          transition: "all 0.12s",
        }}
      />
      <span style={{ fontSize: 13, fontWeight: emphasis ? 600 : 500 }}>{label}</span>
    </button>
  )
}
