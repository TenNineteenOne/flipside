"use client"

import { Disc3, Bookmark, ThumbsUp, ThumbsDown, Music, ArrowUpDown } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"

interface SavedArtist {
  name: string
  popularity: number
}

interface StatsClientProps {
  totalDiscovered: number
  totalSaves: number
  totalLikes: number
  totalDislikes: number
  topGenres: { genre: string; count: number }[]
  savedArtists: SavedArtist[]
  likedArtists: SavedArtist[]
}

type TasteKind = "saved" | "liked"
const KIND_COLOR: Record<TasteKind, string> = {
  saved: "var(--accent)",
  liked: "#22c55e",
}

function StatCard({
  icon,
  label,
  value,
  accentColor,
}: {
  icon: ReactNode
  label: string
  value: number
  accentColor?: string
}) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "24px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: accentColor ?? "var(--text-secondary)" }}>
        {icon}
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{label}</span>
      </div>
      <span
        className="mono"
        style={{ fontSize: 36, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1 }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  )
}

function GenreCard({ genres }: { genres: { genre: string; count: number }[] }) {
  const maxCount = genres.length > 0 ? genres[0].count : 1

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "24px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Music size={16} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Top Genres</span>
      </div>

      {genres.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
          Like some artists to see your top genres
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {genres.map(({ genre, count }) => (
            <div key={genre} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", textTransform: "capitalize" }}>
                  {genre}
                </span>
                <span className="mono" style={{ fontSize: 13, color: "var(--text-secondary)" }}>{count}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(count / maxCount) * 100}%`,
                    borderRadius: 2,
                    background: "var(--accent)",
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function popularityTier(pop: number): string {
  if (pop < 20) return "Obscure"
  if (pop < 40) return "Niche"
  if (pop < 60) return "Emerging"
  if (pop < 80) return "Popular"
  return "Mainstream"
}

function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  )
}

function KindBadge({ kind }: { kind: TasteKind }) {
  const color = KIND_COLOR[kind]
  const label = kind === "saved" ? "Saved" : "Liked"
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color,
        border: `1px solid ${color}`,
        opacity: 0.9,
      }}
    >
      {label}
    </span>
  )
}

type TasteItem = { name: string; popularity: number; kind: TasteKind }

function TasteProfileView({
  savedArtists,
  likedArtists,
}: {
  savedArtists: SavedArtist[]
  likedArtists: SavedArtist[]
}) {
  const [sortDesc, setSortDesc] = useState(false)

  const items = useMemo<TasteItem[]>(() => {
    const savedNames = new Set(savedArtists.map((a) => a.name))
    const out: TasteItem[] = savedArtists.map((a) => ({ ...a, kind: "saved" as const }))
    for (const a of likedArtists) {
      if (savedNames.has(a.name)) continue
      out.push({ ...a, kind: "liked" })
    }
    return out
  }, [savedArtists, likedArtists])

  const sorted = useMemo(
    () => [...items].sort((a, b) => (sortDesc ? b.popularity - a.popularity : a.popularity - b.popularity)),
    [items, sortDesc]
  )

  const svgHeight = 110
  const svgPad = { left: 20, right: 20, top: 20, bottom: 30 }
  const plotW = 400 - svgPad.left - svgPad.right
  const plotH = svgHeight - svgPad.top - svgPad.bottom

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "24px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bookmark size={16} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
            Your taste profile
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LegendSwatch color={KIND_COLOR.saved} label="Saved" />
          <LegendSwatch color={KIND_COLOR.liked} label="Liked" />
        </div>
      </div>

      {items.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
          Save or like some artists to see where they fall on the popularity scale.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 400 ${svgHeight}`}
            width="100%"
            style={{ display: "block" }}
            aria-label="Taste profile popularity distribution"
          >
            <line
              x1={svgPad.left}
              y1={svgHeight - svgPad.bottom}
              x2={400 - svgPad.right}
              y2={svgHeight - svgPad.bottom}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />

            {[0, 20, 40, 60, 80, 100].map((tick) => {
              const x = svgPad.left + (tick / 100) * plotW
              return (
                <g key={tick}>
                  <line
                    x1={x}
                    y1={svgHeight - svgPad.bottom}
                    x2={x}
                    y2={svgHeight - svgPad.bottom + 4}
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={svgHeight - svgPad.bottom + 16}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    fontSize="10"
                    className="mono"
                  >
                    {tick}
                  </text>
                </g>
              )
            })}

            {items.map((a) => {
              const cx = svgPad.left + (a.popularity / 100) * plotW
              const jitter = hashSeed(a.name)
              const cy = svgPad.top + jitter * plotH
              return (
                <circle
                  key={`${a.kind}-${a.name}`}
                  cx={cx}
                  cy={cy}
                  r="4"
                  fill={KIND_COLOR[a.kind]}
                  fillOpacity="0.7"
                  stroke="var(--bg-card)"
                  strokeWidth="1"
                >
                  <title>{`${a.name} · popularity ${a.popularity} · ${a.kind}`}</title>
                </circle>
              )
            })}
          </svg>

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <button
              type="button"
              onClick={() => setSortDesc((v) => !v)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 72px 90px",
                gap: 8,
                padding: "8px 0",
                background: "transparent",
                border: 0,
                borderBottom: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span>Artist</span>
              <span style={{ textAlign: "right" }}>Kind</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                Popularity
                <ArrowUpDown size={11} />
              </span>
            </button>

            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {sorted.map((a) => (
                <div
                  key={`${a.kind}-${a.name}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 72px 90px",
                    gap: 8,
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={a.name}
                  >
                    {a.name}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <KindBadge kind={a.kind} />
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}
                    title={popularityTier(a.popularity)}
                  >
                    {a.popularity}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function StatsClient({
  totalDiscovered,
  totalSaves,
  totalLikes,
  totalDislikes,
  topGenres,
  savedArtists,
  likedArtists,
}: StatsClientProps) {
  return (
    <div>
      <div className="page-head">
        <h1>Stats</h1>
        <span className="sub">your discovery journey</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <StatCard icon={<Disc3 size={16} />} label="Discovered" value={totalDiscovered} accentColor="var(--accent)" />
        <StatCard icon={<Bookmark size={16} />} label="Saved" value={totalSaves} accentColor="#a78bfa" />
        <StatCard icon={<ThumbsUp size={16} />} label="Liked" value={totalLikes} accentColor="#22c55e" />
        <StatCard icon={<ThumbsDown size={16} />} label="Passed" value={totalDislikes} accentColor="#ff4b4b" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <GenreCard genres={topGenres} />
        <TasteProfileView savedArtists={savedArtists} likedArtists={likedArtists} />
      </div>
    </div>
  )
}
