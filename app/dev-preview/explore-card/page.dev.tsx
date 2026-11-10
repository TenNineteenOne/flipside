"use client"

import { useState } from "react"
import { AnimatePresence } from "framer-motion"
import { ExploreArtistRow } from "@/components/explore/explore-artist-row"
import { previewArtists } from "@/lib/dev-preview/fixtures"

/** Explore's artist card in each state: expanded, liked + saved, no image, no tracks, passed, dismissed. */
const START: [number, string | null, boolean][] = [
  [0, null, false],
  [1, "thumbs_up", true],
  [3, null, false],
  [8, null, false],
  [2, "thumbs_down", false],
  [4, "skip", false],
]

export default function ExploreCardPreview() {
  const [signals, setSignals] = useState(() => new Map(START.map(([i, s]) => [previewArtists[i].id, s])))
  const [saved, setSaved] = useState(() => new Set(START.filter(([, , b]) => b).map(([i]) => previewArtists[i].id)))
  // Same toggle rule as Explore (useArtistFeedback): a repeat signal clears it.
  const onFeedback = (id: string, sig: string) => {
    console.info("[dev-preview] explore-card feedback", id, sig)
    setSignals((m) => new Map(m).set(id, m.get(id) === sig ? null : sig))
  }
  const onSave = (id: string) => {
    console.info("[dev-preview] explore-card save", id)
    setSaved((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
  }
  return (
    <div className="col gap-16" style={{ paddingBlock: 16 }}>
      <AnimatePresence initial={false}>
        {START.map(([i]) => {
          const a = previewArtists[i]
          return (
            <ExploreArtistRow
              key={a.id}
              artist={a}
              musicPlatform="spotify"
              isSaved={saved.has(a.id)}
              dismissSignal={signals.get(a.id) ?? null}
              onSave={onSave}
              onFeedback={onFeedback}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
}
