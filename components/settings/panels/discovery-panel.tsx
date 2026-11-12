"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { WanderSwitch } from "@/components/feed/wander-switch"
import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"
import { patchSettings } from "@/lib/settings/patch-settings"
import { FAME_LEVELS, MAX_FAME_LEVEL } from "@/lib/settings/fame"

/**
 * Writer for "How famous?" (users.fame_level). A value equal to the last requested one sends
 * nothing. Saves run one at a time in call order, so an older PATCH can never land after a newer
 * one. Only the newest save rolls back on failure, to the last stop the server confirmed.
 */
export function createFameWriter(initial: number, rollback: (stop: number) => void): (next: number) => Promise<void> {
  let requested = initial
  let confirmed = initial
  let latest = 0
  let chain: Promise<void> = Promise.resolve()
  return (next) => {
    if (next === requested) return chain
    requested = next
    const id = ++latest
    chain = chain.then(() => patchSettings({ fameLevel: next })).then(
      () => { confirmed = next },
      () => {
        if (id === latest) {
          requested = confirmed
          rollback(confirmed)
        }
        toast.error("Failed to save How famous?")
      },
    )
    return chain
  }
}

/** Quiet time after the last slider change before it is saved (drags, arrow-key runs, screen-reader swipes). */
export const FAME_SAVE_DEBOUNCE_MS = 400

/**
 * Discovery settings (#205, option I): "How famous?" (a 5-stop slider) and "How close to your taste?"
 * (the Wander farther switch, also on Feed). Both apply to the next batch only.
 */
export function DiscoveryPanel({ initialFameLevel, initialAdventurous }: { initialFameLevel: number; initialAdventurous: boolean }) {
  const [fame, setFame] = useState(initialFameLevel)
  const { adventurous, setAdventurous } = useAdventurousMode(initialAdventurous)
  const pct = (fame / MAX_FAME_LEVEL) * 100
  const [write] = useState(() => createFameWriter(initialFameLevel, setFame))
  // Saved from onChange (debounced), so every input method counts, including assistive tech that
  // changes the value without key or pointer events. Leaving the page sends a pending change at once.
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; value: number } | null>(null)
  const flush = () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    void write(p.value)
  }
  const change = (value: number) => {
    setFame(value)
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

        <div className="divider" />

        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>How close to your taste?</div>
          <WanderSwitch
            on={adventurous}
            onToggle={() => setAdventurous(!adventurous).catch(() => toast.error("Failed to save Wander farther"))}
            caption="About half of each batch comes from outside your usual genres."
          />
        </div>
      </div>
    </div>
  )
}
