"use client"

export interface SixDegreesChainProps {
  chain: Array<{ name: string; match: number }> | null | undefined
}

/**
 * Renders the similarity walk from the source artist (liked) to the surfaced
 * artist. Each hop is Last.fm's match score between adjacent pairs.
 *
 * - null / empty / single-node chain → renders nothing (no layout break).
 * - Hops are separated with "→".
 * - Match percentage is shown only between hops (not on the source node,
 *   which is implicitly 1.0).
 */
export function SixDegreesChain({ chain }: SixDegreesChainProps) {
  if (!chain || chain.length < 2) return null
  return (
    <div
      className="muted"
      style={{
        fontSize: 10,
        lineHeight: 1.4,
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
      }}
      aria-label="Similarity chain"
    >
      {chain.map((hop, i) => (
        <span key={`${i}-${hop.name}`} style={{ whiteSpace: "nowrap" }}>
          {i > 0 && <span aria-hidden> → </span>}
          {hop.name}
        </span>
      ))}
    </div>
  )
}
