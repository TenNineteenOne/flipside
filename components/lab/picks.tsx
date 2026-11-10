"use client"

import { useEffect, useState } from "react"
import { LAB_OPTIONS } from "@/lib/lab/options"
import { LAB_FEATURES } from "@/lib/lab/features"

const KEY = "flipside-lab-picks"
const VERDICTS = ["Build", "Maybe", "No"] as const
type Picks = { verdict: Record<string, string>; features: string[]; notes: string }
const empty: Picks = { verdict: {}, features: [], notes: "" }

function usePicks() {
  const [picks, setPicks] = useState<Picks>(empty)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from localStorage
      if (saved) setPicks({ ...empty, ...JSON.parse(saved) })
    } catch {}
    const sync = (e: StorageEvent) => e.key === KEY && e.newValue && setPicks(JSON.parse(e.newValue))
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [])
  const update = (next: Picks) => {
    setPicks(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      // same-tab listeners (the verdict buttons and the summary are separate islands)
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: JSON.stringify(next) }))
    } catch {}
  }
  return [picks, update] as const
}

export function Verdict({ slug }: { slug: string }) {
  const [picks, update] = usePicks()
  return (
    <div className="verdict" role="group" aria-label="Your verdict">
      {VERDICTS.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={picks.verdict[slug] === v}
          data-v={v}
          onClick={() => update({ ...picks, verdict: { ...picks.verdict, [slug]: picks.verdict[slug] === v ? "" : v } })}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

export function PickSummary() {
  const [picks, update] = usePicks()
  const [copied, setCopied] = useState(false)
  const text = [
    "Flipside lab picks",
    ...LAB_OPTIONS.map((o) => `- ${o.name}: ${picks.verdict[o.slug] || "undecided"}`),
    "Features I want:",
    ...(picks.features.length ? LAB_FEATURES.filter((f) => picks.features.includes(f.id)).map((f) => `- ${f.label}`) : ["- (none ticked)"]),
    ...(picks.notes.trim() ? ["Notes:", picks.notes.trim()] : []),
  ].join("\n")

  return (
    <div className="picks">
      <ul className="features">
        {LAB_FEATURES.map((f) => {
          const on = picks.features.includes(f.id)
          return (
            <li key={f.id}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => update({ ...picks, features: on ? picks.features.filter((x) => x !== f.id) : [...picks.features, f.id] })}
                />
                <span>{f.label}</span>
                <small>{f.from}</small>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="picks-side">
        <label className="notes">
          Notes for the build
          <textarea value={picks.notes} onChange={(e) => update({ ...picks, notes: e.target.value })} rows={5} placeholder="e.g. Evolved layout, but with the Daily Drop as the home screen" />
        </label>
        <pre aria-label="Summary">{text}</pre>
        <button
          type="button"
          className="copy"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          }}
        >
          {copied ? "Copied — paste it in the chat" : "Copy my picks"}
        </button>
      </div>
    </div>
  )
}
