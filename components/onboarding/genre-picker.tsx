"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import genreData from "@/data/genres.json"
import type { GenreNode } from "@/lib/types"

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

export interface GenrePickerProps {
  selected: GenreNode[]
  onToggle: (node: GenreNode) => void
  cap: number
}

export function GenrePicker({ selected, onToggle, cap }: GenrePickerProps) {
  const [openAnchors, setOpenAnchors] = useState<Set<string>>(new Set())
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set())

  const selectedIds = new Set(selected.map((g) => g.id))
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

  return (
    <div className="col gap-6">
      {ALL_GENRES.map((anchor) => (
        <GenreAnchor
          key={anchor.id}
          anchor={anchor}
          expanded={openAnchors.has(anchor.id)}
          onToggleExpand={() => toggleAnchor(anchor.id)}
          openClusters={openClusters}
          onToggleCluster={toggleCluster}
          selectedIds={selectedIds}
          atCap={atCap}
          onToggleSelect={onToggle}
        />
      ))}
    </div>
  )
}

function GenreAnchor({
  anchor,
  expanded,
  onToggleExpand,
  openClusters,
  onToggleCluster,
  selectedIds,
  atCap,
  onToggleSelect,
}: {
  anchor: GenreNode
  expanded: boolean
  onToggleExpand: () => void
  openClusters: Set<string>
  onToggleCluster: (id: string) => void
  selectedIds: Set<string>
  atCap: boolean
  onToggleSelect: (node: GenreNode) => void
}) {
  const anchorSelected = selectedIds.has(anchor.id)
  const totalSelected = countSelectedInTree(anchor, selectedIds)
  const totalLeaves = anchor.children.reduce((n, c) => n + countLeaves(c), 0)

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: expanded ? "rgba(255,255,255,0.02)" : "transparent",
        overflow: "hidden",
        transition: "background 0.15s",
      }}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 12px",
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {anchor.label}
            {totalSelected > 0 && (
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "rgba(139,92,246,0.2)",
                  color: "var(--accent)",
                }}
              >
                {totalSelected}
              </span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
            {anchor.children.length} groups · {totalLeaves} sub-genres
          </div>
        </div>
        <div style={{ color: "var(--text-faint)", flexShrink: 0 }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "6px 8px 10px", borderTop: "1px solid var(--border)" }}>
          <GenreRow
            label={`Select all of ${anchor.label}`}
            selected={anchorSelected}
            disabled={!anchorSelected && atCap}
            onClick={() => onToggleSelect(anchor)}
            emphasis
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {anchor.children.map((cluster) => (
              <GenreCluster
                key={cluster.id}
                cluster={cluster}
                expanded={openClusters.has(cluster.id)}
                onToggleExpand={() => onToggleCluster(cluster.id)}
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

function GenreCluster({
  cluster,
  expanded,
  onToggleExpand,
  selectedIds,
  atCap,
  onToggleSelect,
}: {
  cluster: GenreNode
  expanded: boolean
  onToggleExpand: () => void
  selectedIds: Set<string>
  atCap: boolean
  onToggleSelect: (node: GenreNode) => void
}) {
  const clusterSelected = selectedIds.has(cluster.id)
  const totalSelected = countSelectedInTree(cluster, selectedIds)

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: expanded ? "rgba(255,255,255,0.03)" : "transparent",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 10px",
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            {cluster.label}
            {totalSelected > 0 && (
              <span
                className="mono"
                style={{
                  fontSize: 9.5,
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
          <div className="mono" style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
            {cluster.children.length} sub-genres
          </div>
        </div>
        <div style={{ color: "var(--text-faint)", flexShrink: 0 }}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "4px 6px 8px", borderTop: "1px solid var(--border)" }}>
          <GenreRow
            label={`Select all of ${cluster.label}`}
            selected={clusterSelected}
            disabled={!clusterSelected && atCap}
            onClick={() => onToggleSelect(cluster)}
            emphasis
          />
          {cluster.children.map((leaf) => {
            const sel = selectedIds.has(leaf.id)
            return (
              <GenreRow
                key={leaf.id}
                label={leaf.label}
                selected={sel}
                disabled={!sel && atCap}
                onClick={() => onToggleSelect(leaf)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
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
