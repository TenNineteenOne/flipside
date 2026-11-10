"use client"

import "./feed.css"
import { useEffect, useRef } from "react"
import { Heart, ThumbsDown, X } from "lucide-react"
import { SnapCard } from "@/components/feed/snap-card"
import { ShellSlot } from "@/components/shell/shell-context"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"

const VERDICT: Record<string, string> = { thumbs_up: "liked", thumbs_down: "passed", skip: "dismissed" }
/** Fallback for browsers without `scrollend` (Safari): longest smooth scroll we expect. */
const SCROLL_GUARD_MS = 900

/**
 * Phone feed below 640px ("Snap", PRD #182): a vertical scroller with one
 * full-height page per loaded artist (decided ones included, in feed order),
 * the three-button triage bar, and "N of M left" + strip in the shell top bar.
 * The page at least 60% in view is the selected artist; any other selection
 * change (a decision's advance, J/K, undo) scrolls its page into view.
 */
export function FeedSnap({ triage }: { triage: FeedTriage }) {
  const { ids, selected, selectedId } = triage
  const scrollerRef = useRef<HTMLDivElement>(null)
  const ioRef = useRef<IntersectionObserver | null>(null)
  /** Selection the observer just reported (no scroll needed for it). */
  const fromScroll = useRef<string | null>(null)
  /** Target of the programmatic scroll in flight: the observer ignores every other page meanwhile. */
  const target = useRef<string | null>(null)
  const first = useRef(true)
  const becomeCurrent = useRef(triage.becomeCurrent)
  useEffect(() => { becomeCurrent.current = triage.becomeCurrent })

  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.id
        if (!e.isIntersecting || !id || (target.current && id !== target.current)) continue
        fromScroll.current = id
        becomeCurrent.current(id)
      }
    }, { root, threshold: 0.6 })
    ioRef.current = io
    return () => io.disconnect()
  }, [])

  // Observe every page, including appended ones (observing a page twice is a no-op).
  useEffect(() => {
    scrollerRef.current?.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => ioRef.current?.observe(el))
  }, [ids])

  useEffect(() => {
    const root = scrollerRef.current
    const came = fromScroll.current === selectedId
    fromScroll.current = null
    // No selection (end of queue, #192): the scroller stays where it is.
    if (!root || !selectedId || came) return
    const el = root.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)
    if (!el) return
    const smooth = !first.current && !matchMedia("(prefers-reduced-motion: reduce)").matches
    first.current = false
    target.current = selectedId
    let timer = 0
    const done = () => {
      root.removeEventListener("scrollend", done)
      clearTimeout(timer)
      target.current = null
      // If the user scrolled elsewhere meanwhile, the page now in view wins.
      const page = root.children[Math.round(root.scrollTop / root.clientHeight)] as HTMLElement | undefined
      const id = page?.dataset.id
      if (id && id !== selectedId) {
        fromScroll.current = id
        becomeCurrent.current(id)
      }
    }
    root.addEventListener("scrollend", done)
    timer = window.setTimeout(done, smooth ? SCROLL_GUARD_MS : 100)
    root.scrollTo({ top: el.offsetTop, behavior: smooth ? "smooth" : "auto" })
    return () => {
      root.removeEventListener("scrollend", done)
      clearTimeout(timer)
    }
  }, [selectedId])

  const liked = !!selected && triage.signals.get(selected.id) === "thumbs_up"
  const judge = (signal: "thumbs_up" | "thumbs_down" | "skip") => {
    if (selected) triage.judge(selected.id, signal, { toggle: true, advance: true })
  }

  return (
    <div className="ev-feed ev-snap">
      <ShellSlot name="top"><SnapCount triage={triage} /></ShellSlot>
      <ShellSlot name="topSub">
        <ol className="ev-feed ev-m-strip" aria-hidden>
          {ids.map((id) => (
            <li key={id} className="ev-seg" data-v={VERDICT[triage.signals.get(id) ?? ""] ?? "none"} data-sel={id === selectedId || undefined} />
          ))}
        </ol>
      </ShellSlot>

      <main className="ev-m-snap" ref={scrollerRef} aria-label="Artists">
        {triage.ids.map((id, i) => {
          const a = triage.byId.get(id)!
          return (
            <section key={id} className="ev-m-page" data-id={id} aria-label={a.name}>
              <SnapCard a={a} triage={triage} eager={i === 0} />
            </section>
          )
        })}
      </main>

      {selected && (
        <div className="ev-m-triage" role="group" aria-label={`Tell flipside what you think of ${selected.name}`}>
          <button type="button" className="ev-m-tri" onClick={() => judge("thumbs_down")}>
            <ThumbsDown size={22} strokeWidth={1.75} aria-hidden /><span>Less like this</span>
          </button>
          <button type="button" className="ev-m-tri" onClick={() => judge("skip")}>
            <X size={22} strokeWidth={1.75} aria-hidden /><span>Dismiss</span>
          </button>
          <button type="button" className="ev-m-tri ev-m-tri-like" onClick={() => judge("thumbs_up")} aria-pressed={liked}>
            <Heart size={22} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden />
            <span>{liked ? "Liked" : "More like this"}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** "N of M left" for the phone top bar. */
export function SnapCount({ triage }: { triage: Pick<FeedTriage, "remaining" | "total"> }) {
  return (
    <span className="ev-feed ev-m-count">
      <strong>{triage.remaining}</strong> of {triage.total} left
    </span>
  )
}
