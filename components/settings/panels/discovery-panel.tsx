"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { patchSettings } from "@/lib/settings/patch-settings"
import { FAME_LEVELS, MAX_FAME_LEVEL } from "@/lib/settings/fame"

/**
 * Writer for "How famous?" (users.fame_level). A value equal to the last requested one sends
 * nothing. Saves run one at a time in call order, so an older PATCH can never land after a newer
 * one. Only the newest save rolls back on failure, to the last stop the server confirmed; `supersede()`
 * marks a newer change still waiting to be sent, so an older failure leaves the slider alone.
 */
export function createFameWriter(
  initial: number,
  rollback: (stop: number) => void,
): ((next: number) => Promise<void>) & { supersede: () => void } {
  let requested = initial
  let confirmed = initial
  let latest = 0
  let chain: Promise<void> = Promise.resolve()
  const write = (next: number) => {
    if (next === requested) return chain
    requested = next
    const id = ++latest
    chain = chain.then(() => patchSettings({ fameLevel: next })).then(
      () => { confirmed = next },
      () => {
        // Always forget the failed request, so re-sending the same value isn't deduped away.
        requested = confirmed
        if (id === latest) rollback(confirmed)
        toast.error("Failed to save How famous?")
      },
    )
    return chain
  }
  /** A newer change is coming (debounced): saves already in flight must not roll the slider back. */
  const supersede = () => { latest++ }
  return Object.assign(write, { supersede })
}

/** Quiet time after the last slider change before it is saved (drags, arrow-key runs, screen-reader swipes). */
export const FAME_SAVE_DEBOUNCE_MS = 400

/**
 * Discovery settings (#205, option I): "How famous?", a 5-stop slider. Applies to the next batch only.
 * Wander farther is always on, so it has no switch.
 */
export function DiscoveryPanel({ initialFameLevel }: { initialFameLevel: number }) {
  const [fame, setFame] = useState(initialFameLevel)
  const pct = (fame / MAX_FAME_LEVEL) * 100
  const [write] = useState(() => createFameWriter(initialFameLevel, setFame))
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: number } | null>(null)
  // Saved from onChange (debounced), so every input method counts, including assistive tech that
  // changes the value without key or pointer events. Leaving the page sends a pending change at once.
  const flush = () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    void write(p.value)
  }
  const change = (value: number) => {
    setFame(value)
    write.supersede()
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { value, timer: setTimeout(flush, FAME_SAVE_DEBOUNCE_MS) }
  }
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush })
  useEffect(() => () => flushRef.current(), [])

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Discovery</div>
      <div className="fs-card col gap-16">
        <div>
          <label htmlFor="fame-level" style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>How famous?</label>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 12 }}>{FAME_LEVELS[fame]}</div>
          <input
            id="fame-level"
            type="range"
            className="obs-slider"
            min={0}
            max={MAX_FAME_LEVEL}
            step={1}
            value={fame}
            aria-valuetext={FAME_LEVELS[fame]}
            onChange={(e) => change(Number(e.target.value))}
            onBlur={flush}
            style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.10) ${pct}%)` }}
          />
          <div
            aria-hidden
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            <span>underground</span>
            <span>anything</span>
          </div>
        </div>
      </div>
    </div>
  )
}
