"use client"

import { useMemo } from "react"

export interface CurvePreviewProps {
  /** Base `k` of the scoring curve k^popularity. Range 0.90–1.00. */
  popularityCurve: number
  /** When true, overlays the ((100-pop)/100)^2 extra-obscurity penalty. */
  undergroundMode: boolean
  /**
   * Distinct example artists at anchor popularity values. Render order matches
   * input order. Artist may be null when the user's cache has no good match
   * near that anchor.
   */
  exampleArtists: { popularity: number; artist: { name: string; popularity: number } | null }[]
}

const ANCHORS = [0, 30, 70, 100]

const svgX = (pop: number) => 20 + (pop / 100) * 360
const svgY = (score: number) => 170 - score * 160

export function CurvePreview({ popularityCurve, undergroundMode, exampleArtists }: CurvePreviewProps) {
  const { defaultPath, defaultFill, undergroundPath } = useMemo(() => {
    const defaultPoints = Array.from({ length: 51 }, (_, i) => {
      const p = i * 2
      const y = Math.pow(popularityCurve, p)
      return `${svgX(p)},${svgY(y)}`
    })

    const undergroundPoints = Array.from({ length: 51 }, (_, i) => {
      const p = i * 2
      const y = Math.pow(popularityCurve, p) * Math.pow((100 - p) / 100, 2)
      return `${svgX(p)},${svgY(y)}`
    })

    const defaultPath = `M ${defaultPoints.join(" L ")}`
    const undergroundPath = `M ${undergroundPoints.join(" L ")}`
    const defaultFill = `${defaultPath} L ${svgX(100)} ${svgY(0)} L ${svgX(0)} ${svgY(0)} Z`

    return { defaultPath, defaultFill, undergroundPath }
  }, [popularityCurve])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ position: "relative", width: "100%" }}>
        <svg
          viewBox="0 0 400 210"
          width="100%"
          style={{ display: "block" }}
          aria-label="Popularity scoring curve"
        >
          <defs>
            <linearGradient id="curvePreviewFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <line x1="20" y1="170" x2="380" y2="170" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

          {[0, 20, 40, 60, 80, 100].map((tick) => (
            <g key={tick}>
              <line x1={svgX(tick)} y1="170" x2={svgX(tick)} y2="174" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              <text x={svgX(tick)} y="188" textAnchor="middle" fill="var(--text-muted)" fontSize="10" className="mono">
                {tick}
              </text>
            </g>
          ))}
          <text x="200" y="205" textAnchor="middle" fill="var(--text-muted)" fontSize="10">
            popularity
          </text>

          <path d={defaultFill} fill="url(#curvePreviewFill)" style={{ transition: "d 0.15s ease" }} />
          <path
            d={defaultPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            style={{ transition: "d 0.15s ease" }}
          />

          <path
            d={undergroundPath}
            fill="none"
            stroke="#a78bfa"
            strokeWidth="2"
            strokeDasharray="4 4"
            strokeLinejoin="round"
            style={{
              opacity: undergroundMode ? 1 : 0,
              transition: "opacity 0.4s ease, d 0.15s ease",
            }}
          />

          {ANCHORS.map((a) => {
            const y = Math.pow(popularityCurve, a)
            return (
              <circle
                key={a}
                cx={svgX(a)}
                cy={svgY(y)}
                r="4"
                fill="var(--accent)"
                stroke="var(--bg-card)"
                strokeWidth="2"
                style={{ transition: "cy 0.15s ease" }}
              />
            )
          })}
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {exampleArtists.map(({ popularity, artist }) => (
          <div key={popularity} style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", minWidth: 0 }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
              pop. {popularity}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-primary)",
                textAlign: "center",
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
              title={artist?.name ?? undefined}
            >
              {artist?.name ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
