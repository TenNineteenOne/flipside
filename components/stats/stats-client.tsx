"use client"

import { Disc3, Bookmark, ThumbsUp, ThumbsDown, Music } from "lucide-react"
import type { ReactNode } from "react"

interface StatsClientProps {
  totalDiscovered: number
  totalSaves: number
  totalLikes: number
  totalDislikes: number
  topGenres: { genre: string; count: number }[]
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

export function StatsClient({
  totalDiscovered,
  totalSaves,
  totalLikes,
  totalDislikes,
  topGenres,
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

      <GenreCard genres={topGenres} />
    </div>
  )
}
