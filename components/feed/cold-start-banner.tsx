import { X } from "lucide-react"

interface ColdStartBannerProps {
  signalCount: number
  threshold?: number
  /** Phones: render as one compact line under the top bar with this dismiss action (styles in feed.css). */
  onDismiss?: () => void
}

const containerStyle: React.CSSProperties = {
  padding: "12px 16px",
  background: "var(--panel)",
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

export function ColdStartBanner({ signalCount, threshold = 5, onDismiss }: ColdStartBannerProps) {
  if (signalCount >= threshold) return null

  const pct = Math.min(100, Math.round((signalCount / threshold) * 100))
  const label = `Flipside signal · ${signalCount} of ${threshold}`
  const subtitle = "Keep exploring — recs get smarter."
  const bar = (
    <div
      style={{
        height: "100%",
        width: `${pct}%`,
        background: "var(--accent)",
        borderRadius: 999,
        transition: "width 0.6s var(--easing)",
      }}
    />
  )

  if (onDismiss) {
    return (
      <div className="ev-coldline">
        <span className="mono ev-coldline-label">{label}</span>
        <span className="ev-coldline-sub">{subtitle}</span>
        <button type="button" className="ev-coldline-x" onClick={onDismiss} aria-label="Hide signal hint">
          <X size={16} aria-hidden />
        </button>
        <div className="ev-coldline-track" aria-hidden>{bar}</div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span className="mono" style={labelStyle}>{label}</span>
        <span style={subtitleStyle}>{subtitle}</span>
      </div>
      <div style={trackStyle}>{bar}</div>
    </div>
  )
}
