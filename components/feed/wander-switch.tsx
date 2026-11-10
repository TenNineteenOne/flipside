"use client"

import "./wander.css"
import { useId } from "react"

/**
 * "Wander farther" (users.adventurous, #205): a switch that only saves the setting. It shapes the
 * next batch; it never rebuilds the cards on screen. Feed shows it beside every Load more, Settings
 * under "How close to your taste?". Its own stylesheet, so Settings doesn't load feed.css.
 */
export function WanderSwitch({ on, onToggle, caption, compact = false }: {
  on: boolean
  onToggle: () => void
  /** Second line under the label (Settings). */
  caption?: string
  /** Phone top bar: "Wander" only below 400px wide (the accessible name stays "Wander farther"). */
  compact?: boolean
}) {
  const captionId = useId()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Wander farther"
      aria-describedby={caption ? captionId : undefined}
      className="wander-sw"
      data-compact={compact || undefined}
      onClick={onToggle}
    >
      <span className="wander-track" aria-hidden />
      <span className="wander-label">
        Wander<span className="wander-far"> farther</span>
        {caption && <small id={captionId}>{caption}</small>}
      </span>
    </button>
  )
}

/** The line under a Wander farther control while it is on (hidden while off). */
export function WanderNote({ on }: { on: boolean }) {
  return (
    <p className="wander-note">
      {on && <>Your <b>next batch</b> goes farther afield.</>}
    </p>
  )
}

/** Class for a Load more button that should wear the rainbow while Wander farther is on. */
export const wanderButton = (on: boolean) => (on ? " wander-btn-on" : "")
