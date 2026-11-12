"use client"

import "./feed.css"
import { useCallback, useEffect, useRef } from "react"
import { RefreshCw } from "lucide-react"
import { EndState } from "@/components/feed/feed-parts"
import { SnapCard } from "@/components/feed/snap-card"
import { MiniPlayer, useSuppressFloatingPlayer } from "@/components/player/mini-player"
import { ShellSlot } from "@/components/shell/shell-context"
import { useAudio } from "@/lib/audio-context"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"

const VERDICT: Record<string, string> = { thumbs_up: "liked", thumbs_down: "passed", skip: "dismissed" }
/** Fallback for browsers without `scrollend` (Safari): longest smooth scroll we expect. */
const SCROLL_GUARD_MS = 900
/** data-id of the end-of-queue page (artist ids are UUIDs). */
const END = "__end"

/**
 * Phone feed ("Snap", PRD #182; below 640px, and any viewport too short for the tablet or
 * desktop layout, see feed-client.tsx): a vertical scroller with one
 * full-height page per loaded artist (decided ones included, in feed order; each
 * card carries its own actions), and the segment strip in the shell top bar.
 * The page at least 60% in view is the selected artist; any other selection
 * change (a decision's advance, J/K, undo, an append after the end) scrolls
 * its page into view. When nothing is left, a final page holds the end state.
 */
interface FeedSnapProps {
  triage: FeedTriage
  /** "Load more artists" on the end page, and its in-flight state. */
  onLoadMore: () => void
  generating: boolean
  /** The weekly challenge strip (FeedClient's Suspense slot), shown under the header. */
  challenge?: React.ReactNode
  /** Called once this layout is mounted (FeedClient enables the keyboard shortcuts then). */
  onShown?: (layout: "phone" | "tablet" | "desktop") => void
}

export function FeedSnap({ triage, onLoadMore, generating, challenge, onShown }: FeedSnapProps) {
  useEffect(() => onShown?.("phone"), [onShown])
  const { ids, selectedId } = triage
  /** The page that should be in view: the selected artist, else the end page (always last, so Load more is always reachable). */
  const key = selectedId ?? END
  const scrollerRef = useRef<HTMLElement>(null)
  const ioRef = useRef<IntersectionObserver | null>(null)
  /** Selection the observer just reported (no scroll needed for it). */
  const fromScroll = useRef<string | null>(null)
  /** Target of the programmatic scroll in flight: the observer ignores every other page meanwhile. */
  const target = useRef<string | null>(null)
  const first = useRef(true)
  const becomeCurrent = useRef(triage.becomeCurrent)
  const keyRef = useRef(key)
  useEffect(() => {
    becomeCurrent.current = triage.becomeCurrent
    keyRef.current = key
  })

  /**
   * Put the selected page exactly in view, instantly. Browsers don't re-snap a scroller whose
   * size changed during or after a smooth scroll (the player bar showing for a moment while
   * playback hands over after J/K), which left it stuck between pages. Skipped while a
   * programmatic scroll is in flight (its end calls this). The observer then only reports the
   * selected page again, which changes nothing.
   */
  const align = useCallback(() => {
    const root = scrollerRef.current
    const k = keyRef.current
    if (!root || !k || target.current) return
    const el = root.querySelector<HTMLElement>(`[data-id="${CSS.escape(k)}"]`)
    if (!el) return
    const top = el.offsetTop - root.offsetTop
    if (Math.abs(root.scrollTop - top) >= 1) root.scrollTo({ top, behavior: "instant" })
  }, [])

  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return
    const ro = new ResizeObserver(() => align())
    ro.observe(root)
    return () => ro.disconnect()
  }, [align])

  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.id
        if (!e.isIntersecting || !id || (target.current && id !== target.current)) continue
        fromScroll.current = id
        becomeCurrent.current(id === END ? null : id)
      }
    }, { root, threshold: 0.6 })
    ioRef.current = io
    return () => io.disconnect()
  }, [])

  // Observe every page, including appended ones and the end page (observing a page twice is a no-op).
  useEffect(() => {
    scrollerRef.current?.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => ioRef.current?.observe(el))
  }, [ids])

  useEffect(() => {
    const root = scrollerRef.current
    const came = fromScroll.current === key
    fromScroll.current = null
    if (!root || !key || came) return
    const el = root.querySelector<HTMLElement>(`[data-id="${CSS.escape(key)}"]`)
    if (!el) return
    const smooth = !first.current && !matchMedia("(prefers-reduced-motion: reduce)").matches
    first.current = false
    target.current = key
    let timer = 0
    const done = () => {
      root.removeEventListener("scrollend", done)
      clearTimeout(timer)
      target.current = null
      // If the user scrolled elsewhere meanwhile, the page now in view wins.
      const page = root.children[Math.round(root.scrollTop / root.clientHeight)] as HTMLElement | undefined
      const id = page?.dataset.id
      if (id && id !== key) {
        fromScroll.current = id
        becomeCurrent.current(id === END ? null : id)
      } else align()
    }
    root.addEventListener("scrollend", done)
    timer = window.setTimeout(done, smooth ? SCROLL_GUARD_MS : 100)
    // Both offsets are from .ev-snap (the fixed frame), so the challenge line above the scroller cancels out.
    root.scrollTo({ top: el.offsetTop - root.offsetTop, behavior: smooth ? "smooth" : "auto" })
    return () => {
      root.removeEventListener("scrollend", done)
      clearTimeout(timer)
    }
  }, [key, align])

  return (
    <div className="ev-feed ev-snap">
      <TopBarProgress triage={triage} onLoadMore={onLoadMore} generating={generating} phone />
      {challenge}

      <section className="ev-m-snap" ref={scrollerRef} aria-label="Artists">
        {ids.map((id, i) => {
          const a = triage.byId.get(id)!
          return (
            <section key={id} className="ev-m-page" data-id={id} aria-label={a.name}>
              <SnapCard a={a} triage={triage} eager={i === 0} />
            </section>
          )
        })}
        <section className="ev-m-page" data-id={END} aria-label="End of today's artists">
          <EndState triage={triage} onLoadMore={onLoadMore} generating={generating} />
        </section>
      </section>

      <PlayerBar triage={triage} />
    </div>
  )
}

/* ---- pieces shared by the phone (Snap) and tablet feeds ---- */

/**
 * The segment strip and Load more in the shell top bar. Phones: wordmark, strip, Load more, avatar in
 * one row. Tablets: Regenerate in the bar, the strip as its second row. Load more is a regenerate icon
 * below 600px wide ("Regenerate" text from 600px); aria-disabled (focus stays) while generating, like
 * LoadMore, with the icon spinning.
 */
export function TopBarProgress({ triage, onLoadMore, generating, phone = false }: {
  triage: FeedTriage; onLoadMore: () => void; generating: boolean; phone?: boolean
}) {
  const strip = (
    <ol className="ev-feed ev-m-strip" aria-hidden>
      {triage.ids.map((id) => (
        <li key={id} className="ev-seg" data-v={VERDICT[triage.signals.get(id) ?? ""] ?? "none"} data-sel={id === triage.selectedId || undefined} />
      ))}
    </ol>
  )
  const more = (
    <button
      type="button"
      className="ev-btn ev-regen ev-m-more"
      onClick={generating ? undefined : onLoadMore}
      aria-disabled={generating || undefined}
      aria-label={generating ? "Generating…" : "Regenerate"}
    >
      <RefreshCw size={18} strokeWidth={2} aria-hidden />
      <span className="ev-m-more-text" aria-hidden>{generating ? "Generating…" : "Regenerate"}</span>
    </button>
  )
  if (phone) return <ShellSlot name="top"><span className="ev-feed ev-m-topbar" data-phone>{strip}{more}</span></ShellSlot>
  return (
    <>
      <ShellSlot name="top"><span className="ev-feed ev-m-topbar">{more}</span></ShellSlot>
      <ShellSlot name="topSub">{strip}</ShellSlot>
    </>
  )
}

/**
 * The small player bar, shown only while the loaded track (playing or paused) is not the
 * selected artist's; the floating pill stays hidden while these feeds are mounted.
 */
export function PlayerBar({ triage }: { triage: FeedTriage }) {
  useSuppressFloatingPlayer()
  const show = !!useAudio().currentTrack && triage.nowPlayingArtist?.id !== triage.selectedId
  return show ? <div className="ev-m-mini"><MiniPlayer docked /></div> : null
}
