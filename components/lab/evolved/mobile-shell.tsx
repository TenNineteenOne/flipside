"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for mzstatic art under the CSP */

import { useEffect, useRef, useState, type ReactNode } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue, type PanInfo } from "framer-motion"
import {
  BarChart3, Bookmark, ChevronDown, Compass, ExternalLink, Heart, History, Keyboard, Layers, LogOut, Pause, Play,
  Settings, Share2, ThumbsDown, Undo2, X,
} from "lucide-react"
import { labArtists, type LabArtist } from "@/lib/lab/artists"
import type { Verdict } from "./discover"
import { Wordmark, artistVars, spotifyUrl } from "./shared"

export type MobileView = "card" | "snap" | "list" | "queue"

const TOTAL = labArtists.length
const EASE = [0.16, 1, 0.3, 1] as const
const THRESHOLD = 96 // px of horizontal drag that commits a verdict
const RING = 2 * Math.PI * 29

const TABS = [
  { label: "Feed", icon: Layers, active: true },
  { label: "Explore", icon: Compass },
  { label: "History", icon: History },
  { label: "Saved", icon: Bookmark },
  { label: "Stats", icon: BarChart3 },
] as const

const VIEW_LABELS: [MobileView, string][] = [["card", "Card"], ["snap", "Snap"], ["list", "List"], ["queue", "Queue"]]

type Props = {
  demo?: string
  view: MobileView
  lab: boolean
  at?: number
  selected: LabArtist | null
  verdicts: Record<string, Verdict>
  saved: Set<string>
  remaining: number
  endState: ReactNode
  mini: ReactNode
  miniAny: ReactNode
  nowTrackId: string | null
  isPlaying: boolean
  progress: number
  onView: (v: MobileView) => void
  onSelect: (a: LabArtist) => void
  onBecomeCurrent: (a: LabArtist) => void
  onTogglePlay: (a: LabArtist) => void
  onPlayTrack: (a: LabArtist, i: number) => void
  onJudge: (a: LabArtist, v: Verdict) => void
  onUndo: (a: LabArtist) => void
  onSave: (a: LabArtist) => void
  onShare: (a: LabArtist) => void
  onShortcuts: () => void
}

const owns = (a: LabArtist, trackId: string | null) => !!trackId && a.topTracks.some((t) => t.id === trackId)
const scrollBehavior = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth")

/** Under 900px: four presentations of one shared state. `card` is the default no-scroll swipe stack. */
export function MobileShell(p: Props) {
  const { selected, verdicts, view } = p
  const [heroVisible, setHeroVisible] = useState(true)
  const scroll = view === "list" || view === "queue"

  return (
    <div className="ev-m" data-view={view} data-scroll={scroll || undefined}>
      <div className="ev-m-head">
        <header className="ev-m-top">
          <div className="ev-m-top-row">
            <Wordmark />
            <span className="ev-m-count"><strong>{p.remaining}</strong> of {TOTAL} left</span>
            <button className="ev-m-avatar" popoverTarget="ev-m-menu" aria-label="Account and settings">L</button>
          </div>
          <ol className="ev-m-strip" aria-hidden>
            {labArtists.map((a) => (
              <li key={a.id} className="ev-seg" data-v={verdicts[a.id] ?? "none"} data-sel={(view !== "list" && a.id === selected?.id) || undefined} />
            ))}
          </ol>
        </header>
        {p.lab && (
          <div className="ev-m-views" role="group" aria-label="Lab: phone layout">
            <span className="ev-m-views-label">Layout</span>
            {VIEW_LABELS.map(([v, label]) => (
              <button key={v} className="ev-m-view" aria-pressed={view === v} onClick={() => p.onView(v)}>{label}</button>
            ))}
          </div>
        )}
        {view === "queue" && selected && !heroVisible && <PinnedBar {...p} a={selected} />}
      </div>

      <div id="ev-m-menu" popover="auto" className="ev-m-menu">
        <div className="ev-m-menu-who"><span className="ev-avatar" aria-hidden>L</span><span>lowtide</span></div>
        <a href="#" className="ev-m-menu-item"><Settings size={18} strokeWidth={1.75} aria-hidden />Settings</a>
        <button className="ev-m-menu-item" popoverTarget="ev-m-menu" popoverTargetAction="hide" onClick={p.onShortcuts}>
          <Keyboard size={18} strokeWidth={1.75} aria-hidden />Keyboard shortcuts
        </button>
        <a href="/lab/evolved" className="ev-m-menu-item"><LogOut size={18} strokeWidth={1.75} aria-hidden />Sign out</a>
      </div>

      {view === "card" && <CardView {...p} />}
      {view === "snap" && <SnapView {...p} />}
      {view === "list" && <ListView {...p} />}
      {view === "queue" && <QueueView {...p} onHeroVisible={setHeroVisible} />}

      {view === "list" ? p.miniAny : p.mini}

      {view !== "list" && selected && <TriageBar {...p} a={selected} />}

      <nav className="ev-m-tabs" aria-label="Main">
        {TABS.map(({ label, icon: Icon, ...rest }) => (
          <a key={label} href="#" className="ev-m-tab" aria-current={"active" in rest ? "page" : undefined}>
            <Icon size={22} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
            {label === "Saved" && p.saved.size > 0 && <span className="ev-m-tab-dot">{p.saved.size}</span>}
          </a>
        ))}
      </nav>
    </div>
  )
}

/* ---------------- card (default): no-scroll swipe stack ---------------- */
function CardView(p: Props) {
  const { selected, verdicts } = p
  const railRef = useRef<HTMLOListElement>(null)
  const next = selected ? nextAfter(selected.id, verdicts) : null

  // Keep the current artist centred in the Up next rail (rail only; never scroll the page).
  useEffect(() => {
    const rail = railRef.current
    const el = selected && rail?.querySelector<HTMLElement>(`[data-id="${selected.id}"]`)
    if (!rail || !el) return
    const vertical = rail.scrollHeight > rail.clientHeight + 4
    if (vertical) rail.scrollTo({ top: el.offsetTop - rail.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" })
    else rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" })
  }, [selected])

  return (
    <>
      <nav className="ev-m-rail-wrap" aria-label="Up next">
        <span className="ev-m-rail-title">Up next</span>
        <ol className="ev-m-rail" ref={railRef}>
          {labArtists.map((a) => {
            const v = verdicts[a.id]
            const cur = a.id === selected?.id
            return (
              <li key={a.id} data-id={a.id}>
                <button
                  className="ev-m-thumb"
                  data-v={v}
                  aria-current={cur || undefined}
                  onClick={() => p.onSelect(a)}
                  aria-label={`${a.name}${v === "liked" ? ", liked" : v ? `, ${v}` : ""}`}
                  style={artistVars(a)}
                >
                  <img src={a.imageUrl} alt="" width={44} height={44} loading="lazy" />
                  {v === "liked" && <span className="ev-m-thumb-badge" aria-hidden><Heart size={10} fill="currentColor" strokeWidth={0} /></span>}
                  {(v === "passed" || v === "dismissed") && <span className="ev-m-thumb-x" aria-hidden><X size={14} strokeWidth={2.5} /></span>}
                  <span className="ev-m-thumb-text"><strong>{a.name}</strong><span>{a.genres[0]}</span></span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <main className="ev-m-stage">
        {selected ? (
          <div className="ev-m-deck">
            {next && (
              <div className="ev-m-ghost" style={artistVars(next)} aria-hidden>
                <img src={next.imageUrl} alt="" width={600} height={600} loading="lazy" />
              </div>
            )}
            <SwipeCard key={selected.id} {...p} a={selected} demoX={p.demo === "swipe" ? THRESHOLD + 34 : 0} />
          </div>
        ) : (
          <div className="ev-end ev-m-end">{p.endState}</div>
        )}
      </main>
    </>
  )
}

/* ---------------- snap: vertical full-height feed ---------------- */
function SnapView(p: Props) {
  const { selected } = p
  const selIndex = selected ? labArtists.indexOf(selected) : TOTAL
  const scrollerRef = useRef<HTMLDivElement>(null)
  const fromScroll = useRef<string | null>(null) // selection that came from the user scrolling
  const programmatic = useRef(false)
  const first = useRef(true)
  const becomeCurrent = useRef(p.onBecomeCurrent)
  useEffect(() => { becomeCurrent.current = p.onBecomeCurrent })

  // The card most in view becomes current.
  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return
    const io = new IntersectionObserver((entries) => {
      if (programmatic.current) return
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const a = labArtists.find((x) => x.id === (e.target as HTMLElement).dataset.id)
        if (a) { fromScroll.current = a.id; becomeCurrent.current(a) }
      }
    }, { root, threshold: 0.6 })
    root.querySelectorAll("[data-id]").forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // Selection changed elsewhere (triage, keyboard, undo, deep link): bring that card into view.
  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return
    const id = selected?.id ?? "end"
    if (fromScroll.current === id) return
    const el = root.querySelector<HTMLElement>(`[data-id="${id}"]`)
    if (!el) return
    programmatic.current = true
    root.scrollTo({ top: el.offsetTop, behavior: first.current ? "auto" : scrollBehavior() })
    first.current = false
    const t = setTimeout(() => { programmatic.current = false; fromScroll.current = id }, 700)
    return () => clearTimeout(t)
  }, [selected])

  return (
    <main className="ev-m-snap" ref={scrollerRef} aria-label="Artists">
      {labArtists.map((a, i) => (
        <section key={a.id} className="ev-m-page" data-id={a.id} aria-label={a.name}>
          <SwipeCard {...p} a={a} stay demoX={0} eager={Math.abs(i - selIndex) <= 2} />
        </section>
      ))}
      {p.remaining === 0 && (
        <section className="ev-m-page" data-id="end"><div className="ev-end ev-m-end">{p.endState}</div></section>
      )}
    </main>
  )
}

/* ---------------- list: continuous feed of medium cards ---------------- */
function ListView(p: Props) {
  return (
    <main className="ev-l" aria-label="Artists">
      {labArtists.map((a) => <ListCard key={a.id} {...p} a={a} />)}
      {p.remaining === 0 && <div className="ev-end ev-m-end ev-l-end">{p.endState}</div>}
    </main>
  )
}

function ListCard(p: Props & { a: LabArtist }) {
  const { a } = p
  const v = p.verdicts[a.id]
  const [open, setOpen] = useState(false)
  const sw = useSwipe(a, p.onJudge, 0, true)
  const mine = owns(a, p.nowTrackId)
  const playing = mine && p.isPlaying

  if (v === "passed" || v === "dismissed") {
    return (
      <div className="ev-l-slim" style={artistVars(a)}>
        <img src={a.imageUrl} alt="" width={36} height={36} loading="lazy" />
        <span className="ev-l-slim-text"><strong>{a.name}</strong><span>{v === "passed" ? "Less like this" : "Dismissed"}</span></span>
        <button className="ev-l-undo" onClick={() => p.onUndo(a)}><Undo2 size={15} aria-hidden />Undo</button>
      </div>
    )
  }

  return (
    <motion.article
      className="ev-l-card"
      style={{ ...artistVars(a), x: sw.x, rotate: sw.rotate, touchAction: "pan-y" }}
      drag="x"
      dragMomentum={false}
      dragDirectionLock
      onDragEnd={sw.onDragEnd}
      aria-label={`${a.name}. Swipe right for more like this, left for less.`}
    >
      <div className="ev-l-art">
        <img src={a.imageUrl} alt={`${a.topTracks[0]?.albumName ?? a.name} cover art`} width={600} height={600} loading="lazy" draggable={false} />
        <Verdicts more={sw.moreOpacity} less={sw.lessOpacity} />
        <PlayRing a={a} playing={playing} progress={mine ? p.progress : 0} onClick={() => p.onTogglePlay(a)} />
        {v === "liked" && <span className="ev-m-liked"><Heart size={13} fill="currentColor" strokeWidth={0} aria-hidden />Liked</span>}
      </div>
      <div className="ev-l-body">
        <h2 className="ev-l-name">{a.name}</h2>
        <p className="ev-m-genres">{a.genres.join(" · ")}</p>
        <Why a={a} />
        <div className="ev-l-tri" role="group" aria-label={`Tell flipside what you think of ${a.name}`}>
          <TriButtons {...p} a={a} icon={18} />
        </div>
        <div className="ev-l-row">
          <button className="ev-l-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={16} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined }} />3 previews
          </button>
          <SecondaryIcons {...p} a={a} />
        </div>
        {open && <TrackChips {...p} a={a} />}
      </div>
    </motion.article>
  )
}

/* ---------------- queue: hero card + vertical Up next ---------------- */
function QueueView(p: Props & { onHeroVisible: (v: boolean) => void }) {
  const { selected, verdicts } = p
  const heroRef = useRef<HTMLDivElement>(null)
  const report = useRef(p.onHeroVisible)
  useEffect(() => { report.current = p.onHeroVisible })

  useEffect(() => {
    const el = heroRef.current
    if (!el) return
    // Pinned bar appears once most of the hero card has scrolled under the header.
    const io = new IntersectionObserver(([e]) => report.current(e.isIntersecting), { rootMargin: "-120px 0px 0px 0px", threshold: 0.25 })
    io.observe(el)
    return () => { io.disconnect(); report.current(true) }
  }, [])

  const pick = (a: LabArtist) => {
    p.onSelect(a)
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
  }

  return (
    <main className="ev-q">
      <div className="ev-q-hero" ref={heroRef}>
        {selected ? <SwipeCard key={selected.id} {...p} a={selected} demoX={0} /> : <div className="ev-end ev-m-end">{p.endState}</div>}
      </div>
      <section className="ev-q-list" aria-labelledby="ev-q-title">
        <h2 id="ev-q-title" className="ev-q-title">Up next</h2>
        <ol>
          {labArtists.filter((a) => a.id !== selected?.id).map((a) => {
            const v = verdicts[a.id]
            return (
              <li key={a.id} className="ev-q-row" data-v={v} style={artistVars(a)}>
                <button className="ev-q-pick" onClick={() => pick(a)}>
                  <img src={a.imageUrl} alt="" width={52} height={52} />
                  <span className="ev-q-text">
                    <strong>{a.name}</strong>
                    <span>{v === "liked" ? "Liked" : v === "passed" ? "Less like this" : v === "dismissed" ? "Dismissed" : `Because you like ${a.why.sourceArtists[0]}`}</span>
                  </span>
                </button>
                {v === "passed" || v === "dismissed" ? (
                  <button className="ev-q-quick ev-q-undo" onClick={() => p.onUndo(a)} aria-label={`Undo ${a.name}`}><Undo2 size={18} aria-hidden /></button>
                ) : (
                  <>
                    <button className="ev-q-quick" onClick={() => p.onJudge(a, "passed")} aria-label={`Less like ${a.name}`}><ThumbsDown size={18} strokeWidth={1.75} aria-hidden /></button>
                    <button className="ev-q-quick ev-q-like" aria-pressed={v === "liked"} onClick={() => p.onJudge(a, "liked")} aria-label={`More like ${a.name}`}>
                      <Heart size={18} strokeWidth={1.75} fill={v === "liked" ? "currentColor" : "none"} aria-hidden />
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    </main>
  )
}

function PinnedBar(p: Props & { a: LabArtist }) {
  const { a } = p
  const playing = owns(a, p.nowTrackId) && p.isPlaying
  return (
    <motion.div className="ev-q-pin" style={artistVars(a)} initial={{ y: -8 }} animate={{ y: 0 }} transition={{ duration: 0.18, ease: EASE }}>
      <button className="ev-q-pin-id" onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })} aria-label={`Back to ${a.name}`}>
        <img src={a.imageUrl} alt="" width={36} height={36} />
        <strong>{a.name}</strong>
      </button>
      <button className="ev-q-quick" onClick={() => p.onTogglePlay(a)} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={18} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden />}
      </button>
      <button className="ev-q-quick" onClick={() => p.onJudge(a, "passed")} aria-label="Less like this"><ThumbsDown size={18} strokeWidth={1.75} aria-hidden /></button>
      <button className="ev-q-quick ev-q-like" onClick={() => p.onJudge(a, "liked")} aria-label="More like this"><Heart size={18} strokeWidth={1.75} aria-hidden /></button>
    </motion.div>
  )
}

/* ---------------- shared pieces ---------------- */
function useSwipe(a: LabArtist, onJudge: (a: LabArtist, v: Verdict) => void, demoX: number, stay: boolean) {
  const reduce = useReducedMotion()
  const x = useMotionValue(demoX)
  const rotate = useTransform(x, [-240, 240], [-7, 7])
  const moreOpacity = useTransform(x, [24, THRESHOLD], [0, 1])
  const lessOpacity = useTransform(x, [-24, -THRESHOLD], [0, 1])
  const committed = useRef(false) // a flung card ignores further drags while it leaves

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (committed.current) return
    const dx = info.offset.x, vx = info.velocity.x
    const verdict: Verdict | null =
      dx > THRESHOLD || (dx > 40 && vx > 650) ? "liked" : dx < -THRESHOLD || (dx < -40 && vx < -650) ? "passed" : null
    if (!verdict) {
      animate(x, 0, reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 })
      return
    }
    committed.current = true
    // Cards that stay in a scrolling feed come straight back; the card stage swaps to a new card.
    const done = () => { onJudge(a, verdict); if (stay) { x.set(0); committed.current = false } }
    if (reduce) { done(); return }
    animate(x, verdict === "liked" ? 520 : -520, { duration: 0.22, ease: EASE }).then(done)
  }
  return { x, rotate, moreOpacity, lessOpacity, onDragEnd }
}

function SwipeCard(p: Props & { a: LabArtist; demoX: number; stay?: boolean; eager?: boolean }) {
  const { a } = p
  const sw = useSwipe(a, p.onJudge, p.demoX, !!p.stay)
  const v = p.verdicts[a.id]
  const mine = owns(a, p.nowTrackId)
  const playing = mine && p.isPlaying
  const currentTrackId = mine ? p.nowTrackId : null

  return (
    <motion.article
      className="ev-m-card"
      data-v={v}
      style={{ ...artistVars(a), x: sw.x, rotate: sw.rotate, touchAction: "pan-y" }}
      drag="x"
      dragMomentum={false}
      dragDirectionLock
      onDragEnd={sw.onDragEnd}
      initial={p.stay ? false : { scale: 0.96 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.24, ease: EASE }}
      aria-label={`${a.name}. Swipe right for more like this, left for less.`}
    >
      <div className="ev-m-art">
        <img src={a.imageUrl} alt={`${a.topTracks[0]?.albumName ?? a.name} cover art`} width={600} height={600} draggable={false} loading={p.stay && !p.eager ? "lazy" : undefined} />
        <Verdicts more={sw.moreOpacity} less={sw.lessOpacity} />
        <PlayRing a={a} playing={playing} progress={mine ? p.progress : 0} onClick={() => p.onTogglePlay(a)} />
        {v === "liked" && <span className="ev-m-liked"><Heart size={13} fill="currentColor" strokeWidth={0} aria-hidden />Liked</span>}
        {(v === "passed" || v === "dismissed") && (
          <span className="ev-m-judged">{v === "passed" ? <ThumbsDown size={13} aria-hidden /> : <X size={13} aria-hidden />}{v === "passed" ? "Less like this" : "Dismissed"}</span>
        )}
      </div>

      <div className="ev-m-info">
        <h2 className="ev-m-name">{a.name}</h2>
        <div className="ev-m-meta">
          <p className="ev-m-genres">{a.genres.join(" · ")}</p>
          <div className="ev-m-sec"><SecondaryIcons {...p} a={a} /></div>
        </div>
        <Why a={a} />
        <TrackChips {...p} a={a} currentTrackId={currentTrackId} />
      </div>
    </motion.article>
  )
}

function Verdicts({ more, less }: { more: MotionValue<number>; less: MotionValue<number> }) {
  return (
    <>
      <motion.div className="ev-m-verdict ev-m-verdict-more" style={{ opacity: more }} aria-hidden>
        <span><Heart size={18} fill="currentColor" strokeWidth={0} />More like this</span>
      </motion.div>
      <motion.div className="ev-m-verdict ev-m-verdict-less" style={{ opacity: less }} aria-hidden>
        <span><ThumbsDown size={18} strokeWidth={2} />Less like this</span>
      </motion.div>
    </>
  )
}

function PlayRing({ a, playing, progress, onClick }: { a: LabArtist; playing: boolean; progress: number; onClick: () => void }) {
  return (
    <button className="ev-m-play" onClick={onClick} aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}>
      <svg className="ev-m-ring-svg" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="29" className="ev-m-ring-bg" />
        <circle cx="32" cy="32" r="29" className="ev-m-ring" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
      </svg>
      {playing ? <Pause size={24} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={24} fill="currentColor" strokeWidth={0} aria-hidden />}
    </button>
  )
}

function Why({ a }: { a: LabArtist }) {
  return (
    <p className="ev-m-why">
      Because you like{" "}
      {a.why.sourceArtists.map((s, i) => (
        <span key={s}>{i > 0 && (i === a.why.sourceArtists.length - 1 ? " and " : ", ")}<strong>{s}</strong></span>
      ))}
    </p>
  )
}

function SecondaryIcons(p: Props & { a: LabArtist }) {
  const { a } = p
  const isSaved = p.saved.has(a.id)
  return (
    <>
      <button className="ev-m-icon" onClick={() => p.onSave(a)} aria-pressed={isSaved} aria-label={isSaved ? "Remove from Saved" : "Save for later"}>
        <Bookmark size={19} strokeWidth={1.75} fill={isSaved ? "currentColor" : "none"} aria-hidden />
      </button>
      <a className="ev-m-icon" href={spotifyUrl(a)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${a.name} in Spotify`}>
        <ExternalLink size={19} strokeWidth={1.75} aria-hidden />
      </a>
      <button className="ev-m-icon" onClick={() => p.onShare(a)} aria-label={`Share ${a.name}`}>
        <Share2 size={19} strokeWidth={1.75} aria-hidden />
      </button>
    </>
  )
}

function TrackChips(p: Props & { a: LabArtist; currentTrackId?: string | null }) {
  const { a } = p
  const current = p.currentTrackId !== undefined ? p.currentTrackId : owns(a, p.nowTrackId) ? p.nowTrackId : null
  return (
    <div className="ev-m-chips" role="group" aria-label="Previews">
      {a.topTracks.map((t, i) => {
        const cur = current === t.id
        const on = cur && p.isPlaying
        return (
          <button key={t.id} className="ev-m-chip" data-current={cur || undefined} aria-pressed={on} onClick={() => p.onPlayTrack(a, i)}>
            {on ? <Pause size={11} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={11} fill="currentColor" strokeWidth={0} aria-hidden />}
            <span>{t.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function TriButtons(p: Props & { a: LabArtist; icon?: number }) {
  const { a } = p
  const size = p.icon ?? 22
  const liked = p.verdicts[a.id] === "liked"
  return (
    <>
      <button className="ev-m-tri" onClick={() => p.onJudge(a, "passed")}>
        <ThumbsDown size={size} strokeWidth={1.75} aria-hidden /><span>Less like this</span>
      </button>
      <button className="ev-m-tri" onClick={() => p.onJudge(a, "dismissed")}>
        <X size={size} strokeWidth={1.75} aria-hidden /><span>Dismiss</span>
      </button>
      <button className="ev-m-tri ev-m-tri-like" onClick={() => p.onJudge(a, "liked")} aria-pressed={liked}>
        <Heart size={size} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden />
        <span>{liked ? "Liked" : "More like this"}</span>
      </button>
    </>
  )
}

function TriageBar(p: Props & { a: LabArtist }) {
  return (
    <div className="ev-m-triage" role="group" aria-label="Tell flipside what you think">
      <TriButtons {...p} />
    </div>
  )
}

function nextAfter(id: string, v: Record<string, Verdict>) {
  const i = labArtists.findIndex((a) => a.id === id)
  for (let k = 1; k < TOTAL; k++) {
    const a = labArtists[(i + k) % TOTAL]
    if (!v[a.id]) return a
  }
  return null
}
