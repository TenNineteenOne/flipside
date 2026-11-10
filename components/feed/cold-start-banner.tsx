import { X } from "lucide-react"

interface ColdStartBannerProps {
  signalCount: number
  threshold?: number
  /** Phones and tablets: render as one compact line under the top bar with this dismiss action. */
  onDismiss?: () => void
}

/** The cold-start hint (styles in components/feed/feed.css, `.ev-cold*`; always rendered inside `.ev-feed`). */
export function ColdStartBanner({ signalCount, threshold = 5, onDismiss }: ColdStartBannerProps) {
  if (signalCount >= threshold) return null

  const pct = Math.min(100, Math.round((signalCount / threshold) * 100))
  const label = (
    <span className="ev-cold-label">
      Flipside signal · <span className="ev-cold-n">{`${signalCount} of ${threshold}`}</span>
    </span>
  )
  const subtitle = <span className="ev-cold-sub">Keep exploring — recs get smarter.</span>
  const bar = (
    <div className="ev-cold-track" aria-hidden>
      <span style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  )

  if (onDismiss) {
    return (
      <div className="ev-coldline">
        {label}
        {subtitle}
        <button type="button" className="ev-coldline-x" onClick={onDismiss} aria-label="Hide signal hint">
          <X size={16} aria-hidden />
        </button>
        {bar}
      </div>
    )
  }

  return (
    <div className="ev-cold">
      <div className="ev-cold-row">
        {label}
        {subtitle}
      </div>
      {bar}
    </div>
  )
}
