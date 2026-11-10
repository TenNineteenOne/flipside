"use client"

import "./feed.css"
import { useEffect, useRef } from "react"
import { Heart, X } from "lucide-react"
import { Art, artistVar, EndState, LoadMore } from "@/components/feed/feed-desktop"
import { ColdLine, PlayerBar, TopBarProgress, TriageBar } from "@/components/feed/feed-snap"
import { SnapCard } from "@/components/feed/snap-card"
import { artworkFor } from "@/lib/feed/artwork"
import { nextUndecided } from "@/lib/feed/triage-queue"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"

const VERDICT: Record<string, "liked" | "passed" | "dismissed"> = { thumbs_up: "liked", thumbs_down: "passed", skip: "dismissed" }
const MARK = { liked: ", liked", passed: ", less like this", dismissed: ", dismissed" } as const

interface FeedTabletProps {
  triage: FeedTriage
  /** Cold-start hint input (the same dismissible line as on phones). */
  signalCount: number
  /** "Load more artists" in the end state, and its in-flight state. */
  onLoadMore: () => void
  generating: boolean
}

/**
 * Tablet feed, 640–899px (PRD #182 "Breakpoints"; the prototype's `card` view):
 * the selected artist's card (swipeable, not in a scroller) with the triage bar
 * under it, beside a 280px "Up next" list of every loaded artist in feed order.
 * The end state takes the card's place when nothing is left. Presentation only.
 */
export function FeedTablet({ triage, signalCount, onLoadMore, generating }: FeedTabletProps) {
  const { selected, selectedId, signals } = triage
  const next = selectedId ? triage.byId.get(nextUndecided(triage.ids, signals, selectedId) ?? "") : undefined
  const listRef = useRef<HTMLOListElement>(null)

  // Keep the selected row centred in the list (the list only; the page never scrolls).
  useEffect(() => {
    const list = listRef.current
    const row = selectedId && list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)
    if (!list || !row) return
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches
    // Row and list offsets are both from the fixed frame (.ev-tablet), so their difference is the row's place in the list.
    const top = row.offsetTop - list.offsetTop
    list.scrollTo({ top: top - list.clientHeight / 2 + row.clientHeight / 2, behavior: smooth ? "smooth" : "auto" })
  }, [selectedId])

  return (
    <div className="ev-feed ev-snap ev-tablet">
      <TopBarProgress triage={triage} />
      <div className="ev-t-cold"><ColdLine signalCount={signalCount} /></div>

      <main className="ev-m-stage" aria-label="Selected artist">
        {selected ? (
          <div className="ev-m-deck">
            {next && (
              <div className="ev-m-ghost" style={artistVar(next)} aria-hidden>
                <Art a={next} src={artworkFor(next)} size={600} className="ev-m-ghost-img" eager />
              </div>
            )}
            <SnapCard key={selected.id} a={selected} triage={triage} eager enter />
          </div>
        ) : (
          <EndState triage={triage} onLoadMore={onLoadMore} generating={generating} />
        )}
      </main>

      <PlayerBar triage={triage} />
      <TriageBar triage={triage} />

      <nav className="ev-m-rail-wrap" aria-labelledby="ev-upnext">
        <h2 id="ev-upnext" className="ev-m-rail-title">Up next</h2>
        <ol className="ev-m-rail" ref={listRef}>
          {triage.ids.map((id) => {
            const a = triage.byId.get(id)!
            const v = VERDICT[signals.get(id) ?? ""]
            return (
              <li key={id} data-id={id}>
                <button
                  type="button"
                  className="ev-m-thumb"
                  data-v={v}
                  aria-current={id === selectedId || undefined}
                  aria-label={`${a.name}${v ? MARK[v] : ""}`}
                  onClick={() => triage.select(id)}
                  style={artistVar(a)}
                >
                  <Art a={a} src={artworkFor(a)} size={44} className="ev-m-thumb-img" />
                  {v === "liked" && <span className="ev-m-thumb-badge" aria-hidden><Heart size={10} fill="currentColor" strokeWidth={0} /></span>}
                  {(v === "passed" || v === "dismissed") && <span className="ev-m-thumb-x" aria-hidden><X size={14} strokeWidth={2.5} /></span>}
                  <span className="ev-m-thumb-text" aria-hidden><strong>{a.name}</strong><span>{a.genres[0]}</span></span>
                </button>
              </li>
            )
          })}
          <li className="ev-m-rail-more"><LoadMore onLoadMore={onLoadMore} generating={generating} /></li>
        </ol>
      </nav>
    </div>
  )
}
