interface ColdStartBannerProps {
  signalCount: number
  threshold?: number
}

const containerStyle: React.CSSProperties = {
  padding: "12px 16px",
  background: "rgba(15,15,15,0.65)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  display: "flex",
  flexDirection: "column",
  gap: 8,
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
}

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "var(--accent)",
  textTransform: "uppercase",
  letterSpacing: "0.18em",
  whiteSpace: "nowrap",
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  lineHeight: 1.3,
  textAlign: "right",
  minWidth: 0,
}

const trackStyle: React.CSSProperties = {
  height: 4,
  borderRadius: 999,
  background: "rgba(255,255,255,0.06)",
  overflow: "hidden",
}

export function ColdStartBanner({ signalCount, threshold = 5 }: ColdStartBannerProps) {
  if (signalCount >= threshold) return null

  const pct = Math.min(100, Math.round((signalCount / threshold) * 100))

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span className="mono" style={labelStyle}>
          Flipside signal · {signalCount} of {threshold}
        </span>
        <span style={subtitleStyle}>
          Keep exploring — recs get smarter.
        </span>
      </div>
      <div style={trackStyle}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--accent)",
            borderRadius: 999,
            transition: "width 0.6s var(--easing)",
          }}
        />
      </div>
    </div>
  )
}
