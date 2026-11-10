"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { WanderNote, WanderSwitch } from "@/components/feed/wander-switch"
import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"
import { patchSettings } from "@/lib/settings/patch-settings"
import { FAME_LEVELS, MAX_FAME_LEVEL } from "@/lib/settings/fame"

/**
 * Save "How famous?" (users.fame_level) when `next` differs from the last saved stop, so a
 * click or key that didn't move the slider sends nothing. On failure the slider rolls back to
 * the last saved stop. Applies to the next batch; nothing on screen is rebuilt.
 */
export async function saveFameLevel(next: number, saved: { current: number }, rollback: (stop: number) => void): Promise<void> {
  const prev = saved.current
  if (next === prev) return
  saved.current = next
  try {
    await patchSettings({ fameLevel: next })
  } catch {
    // A newer save owns the slider now; only the latest one rolls back.
    if (saved.current === next) {
      saved.current = prev
      rollback(prev)
    }
    toast.error("Failed to save How famous?")
  }
}

/**
 * Discovery settings (#205, option I): "How famous?" (a 5-stop slider) and "How close to your taste?"
 * (the Wander farther switch, also on Feed). Both apply to the next batch only.
 */
export function DiscoveryPanel({ initialFameLevel, initialAdventurous }: { initialFameLevel: number; initialAdventurous: boolean }) {
  const [fame, setFame] = useState(initialFameLevel)
  const { adventurous, setAdventurous } = useAdventurousMode(initialAdventurous)
  const pct = (fame / MAX_FAME_LEVEL) * 100
  const saved = useRef(initialFameLevel)
  const save = () => void saveFameLevel(fame, saved, setFame)

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
            onChange={(e) => setFame(Number(e.target.value))}
            onPointerUp={save}
            onKeyUp={save}
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
            caption="About half of each new batch comes from outside your usual genres. Also on Feed."
          />
          <WanderNote on={adventurous} />
        </div>
      </div>
    </div>
  )
}
