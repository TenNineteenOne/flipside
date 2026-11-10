"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for mzstatic art under the CSP */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { AnimatePresence, MotionConfig, motion } from "framer-motion"
import {
  Bookmark, BarChart3, Compass, ExternalLink, Heart, History, Keyboard, Layers, Pause, Play,
  Settings, Share2, ThumbsDown, Undo2, X,
} from "lucide-react"
import { labArtists, type LabArtist } from "@/lib/lab/artists"
import { useAudio } from "@/lib/audio-context"
import { MobileShell, type MobileView } from "./mobile-shell"
import { Kbd, Wordmark, artistVars, duration, popularityLabel, spotifyUrl, whyText } from "./shared"

export type Verdict = "liked" | "passed" | "dismissed"
type Toast = { id: number; text: string; undo?: () => void }

const EASE = [0.16, 1, 0.3, 1] as const
const TOTAL = labArtists.length
const byId = new Map(labArtists.map((a) => [a.id, a]))

const NAV = [
  { label: "Feed", icon: Layers, active: true },
  { label: "Explore", icon: Compass },
  { label: "History", icon: History },
  { label: "Saved", icon: Bookmark },
  { label: "Stats", icon: BarChart3 },
  { label: "Settings", icon: Settings },
] as const

const SHORTCUTS: [string[], string][] = [
  [["J", "↓"], "Next artist"],
  [["K", "↑"], "Previous artist"],
  [["Space"], "Play / pause"],
  [["1", "2", "3"], "Play track 1–3"],
  [["L"], "More like this"],
  [["X"], "Less like this"],
  [["D"], "Dismiss"],
  [["B"], "Save for later"],
  [["O"], "Open in Spotify"],
  [["S"], "Share"],
  [["Z"], "Undo"],
  [["?"], "This list"],
]

function demoState(demo?: string): Record<string, Verdict> {
  if (demo === "end") {
    return Object.fromEntries(labArtists.map((a, i) => [a.id, i % 4 === 0 ? "liked" : i % 3 === 0 ? "dismissed" : "passed"]))
  }
  if (demo === "early") return { yinyin: "liked", altıngun: "passed" }
  if (demo === "triaged") return { yinyin: "liked", altıngun: "passed", hermanosgutierrez: "dismissed", mdoumoctar: "liked" }
  return {}
}

// Lab-only: the alternative phone layouts apply under 640px; tablet always uses the card stage.
const WIDE = "(min-width: 640px)"
const subscribeWide = (cb: () => void) => { const m = matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb) }
const VIEWS: MobileView[] = ["card", "snap", "list", "queue"]

export function Discover({ demo, view: initialView, at }: { demo?: string; view?: string; at?: number }) {
  const audio = useAudio()
  const [view, setView] = useState<MobileView>(VIEWS.includes(initialView as MobileView) ? (initialView as MobileView) : "card")
  const wide = useSyncExternalStore(subscribeWide, () => matchMedia(WIDE).matches, () => false)
  const mobileView: MobileView = wide ? "card" : view
  const changeView = (v: MobileView) => {
    setView(v)
    const url = new URL(location.href)
    if (v === "card") url.searchParams.delete("view"); else url.searchParams.set("view", v)
    url.searchParams.delete("at")
    history.replaceState(history.state, "", url)
    window.scrollTo({ top: 0 })
  }
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(() => demoState(demo))
  const [saved, setSaved] = useState<Set<string>>(() => new Set(demo === "triaged" ? ["glassbeams"] : []))
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    demo === "end" ? null : at !== undefined && labArtists[at] ? labArtists[at].id : labArtists.find((a) => !demoState(demo)[a.id])?.id ?? null,
  )
  const [toast, setToast] = useState<Toast | null>(() =>
    demo === "triaged" ? { id: 0, text: "Dismissed Hermanos Gutiérrez", undo: () => {} } : null,
  )
  const [sheetOpen, setSheetOpen] = useState(demo === "keys")
  const sheetRef = useRef<HTMLDialogElement>(null)

  // Passed and dismissed artists leave the queue; liked ones stay, marked.
  const visible = useMemo(() => labArtists.filter((a) => verdicts[a.id] !== "passed" && verdicts[a.id] !== "dismissed"), [verdicts])
  const remaining = labArtists.filter((a) => !verdicts[a.id]).length
  const selected = selectedId ? byId.get(selectedId) ?? null : null

  const counts = useMemo(() => {
    const c = { liked: 0, passed: 0, dismissed: 0 }
    for (const v of Object.values(verdicts)) c[v]++
    return c
  }, [verdicts])

  const tuning = useMemo(() => {
    const more = new Set<string>(), less = new Set<string>()
    for (const a of labArtists) {
      if (verdicts[a.id] === "liked") a.genres.forEach((g) => more.add(g))
      if (verdicts[a.id] === "passed") a.genres.forEach((g) => less.add(g))
    }
    return { more: [...more].slice(0, 6), less: [...less].slice(0, 4) }
  }, [verdicts])

  const isArtistPlaying = (a: LabArtist) => audio.isPlaying && !!audio.currentTrack && a.topTracks.some((t) => t.id === audio.currentTrack!.id)
  const ownsCurrent = (a: LabArtist) => !!audio.currentTrack && a.topTracks.some((t) => t.id === audio.currentTrack!.id)

  const playArtist = useCallback((a: LabArtist, track = 0) => {
    const t = a.topTracks[track]
    if (t) audio.play(t, a.name, a.imageUrl, a.color)
  }, [audio])

  const togglePlay = useCallback((a: LabArtist) => {
    if (ownsCurrent(a)) { if (audio.isPlaying) audio.pause(); else audio.resume() }
    else playArtist(a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, playArtist])

  const showToast = useCallback((text: string, undo?: () => void) => setToast({ id: Date.now(), text, undo }), [])

  useEffect(() => {
    if (!toast || demo === "triaged") return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast, demo])

  const nextUntriaged = (fromId: string, v: Record<string, Verdict>) => {
    const i = labArtists.findIndex((a) => a.id === fromId)
    for (let k = 1; k < TOTAL; k++) {
      const a = labArtists[(i + k) % TOTAL]
      if (!v[a.id]) return a
    }
    return null
  }

  /** toggle: L on a liked artist un-likes. advance: move selection on (only when judging the current artist). */
  const judge = useCallback((a: LabArtist, verdict: Verdict, toggle = true, advance = true) => {
    const prev = verdicts[a.id]
    if (toggle && verdict === "liked" && prev === "liked") {
      // L on a liked artist un-likes it, in place.
      setVerdicts((v) => { const n = { ...v }; delete n[a.id]; return n })
      showToast(`Removed like from ${a.name}`)
      return
    }
    const nextV = { ...verdicts, [a.id]: verdict }
    const next = nextUntriaged(a.id, nextV)
    const wasListening = isArtistPlaying(a)
    setVerdicts(nextV)
    if (advance) {
      setSelectedId(next?.id ?? null)
      // Keep the music going: triaging while listening rolls straight into the next artist.
      if (wasListening) { if (next) playArtist(next); else audio.pause() }
    }
    const text = verdict === "liked" ? `More like ${a.name}` : verdict === "passed" ? `Less like ${a.name}` : `Dismissed ${a.name}`
    showToast(text, () => {
      setVerdicts((v) => { const n = { ...v }; if (prev) n[a.id] = prev; else delete n[a.id]; return n })
      setSelectedId(a.id)
      setToast(null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdicts, audio, playArtist, showToast])

  const toggleSave = useCallback((a: LabArtist) => {
    setSaved((s) => {
      const n = new Set(s)
      if (n.has(a.id)) n.delete(a.id); else n.add(a.id)
      return n
    })
    showToast(saved.has(a.id) ? `Removed ${a.name} from Saved` : `Saved ${a.name}`)
  }, [saved, showToast])

  const share = useCallback(async (a: LabArtist) => {
    const url = `${location.origin}/artist/${a.id}`
    const data = { title: `${a.name} on flipside`, text: `${whyText(a)}. Have a listen:`, url }
    try {
      if (navigator.share) { await navigator.share(data); return }
      await navigator.clipboard.writeText(url)
      showToast(`Link to ${a.name} copied`)
    } catch { /* share sheet dismissed */ }
  }, [showToast])

  const move = useCallback((dir: 1 | -1) => {
    if (visible.length === 0) return
    const i = visible.findIndex((a) => a.id === selectedId)
    const n = visible[i < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, i + dir))]
    setSelectedId(n.id)
    // Keep the selected row in view when moving with the keyboard.
    document.getElementById(`ev-row-${n.id}`)?.scrollIntoView({ block: "nearest" })
  }, [visible, selectedId])


  useEffect(() => {
    const d = sheetRef.current
    if (!d) return
    if (sheetOpen && !d.open) d.showModal()
    if (!sheetOpen && d.open) d.close()
  }, [sheetOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target instanceof HTMLElement ? e.target : document.body
      if (el.closest("input, textarea, select, [contenteditable]")) return
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); setSheetOpen((o) => !o); return }
      if (sheetOpen) return
      const k = e.key.toLowerCase()
      if (k === "j" || k === "arrowdown") { e.preventDefault(); move(1); return }
      if (k === "k" || k === "arrowup") { e.preventDefault(); move(-1); return }
      if (k === "z") { toast?.undo?.(); return }
      if (!selected) return
      // Space on a focused button should press that button, not double-fire.
      if (k === " " && el.tagName !== "BUTTON" && el.tagName !== "A") { e.preventDefault(); togglePlay(selected); return }
      if (k === "1" || k === "2" || k === "3") { playArtist(selected, Number(k) - 1); return }
      if (k === "l") judge(selected, "liked")
      else if (k === "x") judge(selected, "passed")
      else if (k === "d") judge(selected, "dismissed")
      else if (k === "b") toggleSave(selected)
      else if (k === "o") window.open(spotifyUrl(selected), "_blank", "noopener")
      else if (k === "s") share(selected)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [move, selected, sheetOpen, toast, togglePlay, playArtist, judge, toggleSave, share])

  const selectFromList = (a: LabArtist) => {
    setSelectedId(a.id)
  }

  const restart = () => {
    setVerdicts({})
    setSelectedId(labArtists[0].id)
    showToast("New batch loaded, tuned to your likes")
  }

  const nowArtist = audio.currentTrack ? labArtists.find((a) => ownsCurrent(a)) ?? null : null

  const endState = (
    <>
                  <div className="ev-end-art" aria-hidden>
                    {labArtists.filter((a) => verdicts[a.id] === "liked").slice(0, 4).map((a) => (
                      <img key={a.id} src={a.imageUrl} alt="" width={96} height={96} loading="lazy" />
                    ))}
                  </div>
                  <h2 className="ev-end-title">You&rsquo;ve heard all {TOTAL}.</h2>
                  <p className="ev-end-body">
                    {counts.liked} liked, {counts.passed} less like this, {counts.dismissed} dismissed.
                    {tuning.more.length > 0 && <> Tomorrow&rsquo;s batch leans toward <strong>{tuning.more.slice(0, 2).join(" and ")}</strong>.</>}
                  </p>
                  <div className="ev-end-actions">
                    <button className="ev-btn ev-btn-primary" onClick={restart}>Start a new batch</button>
                    <a className="ev-btn ev-btn-ghost" href="#">Review saved</a>
                  </div>
    </>
  )

  return (
    <MotionConfig reducedMotion="user">
      <div className="ev-app" data-view={mobileView}>
        {/* Desktop/tablet rail */}
        <aside className="ev-rail" aria-label="Main">
          <a href="/lab/evolved" className="ev-rail-brand"><Wordmark /></a>
          <nav className="ev-nav">
            {NAV.map(({ label, icon: Icon, ...rest }) => (
              <a key={label} href="#" className="ev-nav-item" aria-current={"active" in rest ? "page" : undefined} title={label}>
                <Icon size={18} strokeWidth={1.75} aria-hidden />
                <span className="ev-nav-label">{label}</span>
                {label === "Feed" && <span className="ev-nav-count">{remaining}</span>}
                {label === "Saved" && saved.size > 0 && <span className="ev-nav-count">{saved.size}</span>}
              </a>
            ))}
          </nav>

          <section className="ev-tuning" aria-label="What flipside has learned this session">
            <h2 className="ev-rail-heading">Tuning</h2>
            {tuning.more.length + tuning.less.length === 0 ? (
              <p className="ev-tuning-empty">Like or pass on a few artists and the next batch bends toward you.</p>
            ) : (
              <>
                {tuning.more.length > 0 && (
                  <div className="ev-tune-group">
                    <span className="ev-tune-label">More</span>
                    <ul className="ev-chips">{tuning.more.map((g) => <li key={g} className="ev-chip ev-chip-more">{g}</li>)}</ul>
                  </div>
                )}
                {tuning.less.length > 0 && (
                  <div className="ev-tune-group">
                    <span className="ev-tune-label">Less</span>
                    <ul className="ev-chips">{tuning.less.map((g) => <li key={g} className="ev-chip">{g}</li>)}</ul>
                  </div>
                )}
              </>
            )}
          </section>

          <div className="ev-rail-foot">
            <button className="ev-rail-keys" onClick={() => setSheetOpen(true)}>
              <Keyboard size={16} strokeWidth={1.75} aria-hidden />
              <span className="ev-nav-label">Shortcuts</span>
              <Kbd>?</Kbd>
            </button>
            <div className="ev-user ev-nav-label">
              <span className="ev-avatar" aria-hidden>l</span>
              <span>lowtide</span>
            </div>
          </div>
        </aside>

        {/* Queue */}
        <main className="ev-queue" aria-labelledby="ev-queue-title">
          <header className="ev-queue-head">
            <div>
              <h1 id="ev-queue-title" className="ev-queue-title">Today&rsquo;s flipside</h1>
              <p className="ev-queue-sub">Nineteen artists you&rsquo;ve never played, picked from what you told us.</p>
            </div>
            <div className="ev-progress" aria-label={`${remaining} of ${TOTAL} left`}>
              <span className="ev-progress-text"><strong>{remaining}</strong> of {TOTAL} left</span>
              <ol className="ev-strip" aria-hidden>
                {labArtists.map((a) => (
                  <li key={a.id} className="ev-seg" data-v={verdicts[a.id] ?? "none"} data-sel={a.id === selectedId || undefined} />
                ))}
              </ol>
            </div>
          </header>

          <ul className="ev-rows" aria-label="Artist queue">
            <AnimatePresence initial={false}>
              {visible.map((a) => {
                const v = verdicts[a.id]
                const sel = a.id === selectedId
                const playing = isArtistPlaying(a)
                return (
                  <motion.li
                    key={a.id}
                    id={`ev-row-${a.id}`}
                    layout="position"
                    className="ev-row"
                    data-sel={sel || undefined}
                    data-liked={v === "liked" || undefined}
                    style={artistVars(a)}
                    exit={{ opacity: 0, x: -32, transition: { duration: 0.18, ease: EASE } }}
                    transition={{ layout: { duration: 0.24, ease: EASE } }}
                  >
                    <button className="ev-row-select" onClick={() => selectFromList(a)} aria-label={`Select ${a.name}`} aria-current={sel || undefined} />
                    <button
                      className="ev-row-art"
                      onClick={() => { setSelectedId(a.id); togglePlay(a) }}
                      aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}
                      data-playing={playing || undefined}
                    >
                      <img src={a.imageUrl} alt="" width={48} height={48} loading="lazy" />
                      <span className="ev-row-art-icon" aria-hidden>
                        {playing ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" strokeWidth={0} />}
                      </span>
                    </button>
                    <div className="ev-row-text">
                      <span className="ev-row-name">
                        {a.name}
                        {playing && <span className="ev-eq" aria-label="Playing"><i /><i /><i /></span>}
                      </span>
                      <span className="ev-row-why">{whyText(a)}</span>
                    </div>
                    <span className="ev-row-genre">{a.genres[0]}</span>
                    <span className="ev-row-pop" title={`Popularity ${a.popularity}/100`}>
                      <span className="ev-meter" aria-hidden><span style={{ width: `${a.popularity}%` }} /></span>
                      <span className="ev-row-pop-n">{a.popularity}</span>
                    </span>
                    <span className="ev-row-state">
                      {v === "liked" ? (
                        <span className="ev-liked-tag"><Heart size={13} fill="currentColor" strokeWidth={0} aria-hidden />Liked</span>
                      ) : saved.has(a.id) ? (
                        <span className="ev-saved-tag"><Bookmark size={13} fill="currentColor" strokeWidth={0} aria-hidden />Saved</span>
                      ) : null}
                    </span>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
          {visible.length > 0 && remaining === 0 && (
            <p className="ev-queue-foot">Queue clear. These are the ones you kept.</p>
          )}
        </main>

        {/* Focus pane */}
        <section className="ev-focus" aria-live="polite" aria-label="Selected artist">
          <div className="ev-focus-scroll">
            <AnimatePresence mode="popLayout" initial={false}>
              {selected ? (
                <motion.article
                  key={selected.id}
                  className="ev-card"
                  style={artistVars(selected)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  <FocusCard
                    a={selected}
                    verdict={verdicts[selected.id]}
                    saved={saved.has(selected.id)}
                    playing={isArtistPlaying(selected)}
                    currentTrackId={ownsCurrent(selected) ? audio.currentTrack!.id : null}
                    onTogglePlay={() => togglePlay(selected)}
                    onPlayTrack={(i) => {
                      const t = selected.topTracks[i]
                      if (audio.currentTrack?.id === t.id) { if (audio.isPlaying) audio.pause(); else audio.resume() }
                      else playArtist(selected, i)
                    }}
                    onJudge={(v) => judge(selected, v)}
                    onSave={() => toggleSave(selected)}
                    onShare={() => share(selected)}
                  />
                </motion.article>
              ) : (
                <motion.div key="end" className="ev-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{endState}</motion.div>
              )}
            </AnimatePresence>
          </div>
          <Player artist={nowArtist} className="ev-dock" />
        </section>

        <MobileShell
          demo={demo}
          selected={selected}
          verdicts={verdicts}
          saved={saved}
          remaining={remaining}
          endState={endState}
          view={mobileView}
          lab={!wide}
          onView={changeView}
          at={at}
          mini={nowArtist && nowArtist.id !== selectedId ? <Player artist={nowArtist} className="ev-m-mini" /> : null}
          miniAny={nowArtist ? <Player artist={nowArtist} className="ev-m-mini ev-m-mini-fixed" /> : null}
          nowTrackId={audio.currentTrack?.id ?? null}
          isPlaying={audio.isPlaying}
          progress={audio.progress}
          onSelect={(a) => setSelectedId(a.id)}
          onBecomeCurrent={(a) => {
            if (a.id === selectedId) return
            setSelectedId(a.id)
            // Snap feed: a new card snapping in takes over the preview if something was playing.
            if (audio.isPlaying && !ownsCurrent(a)) playArtist(a)
          }}
          onUndo={(a) => setVerdicts((v) => { const n = { ...v }; delete n[a.id]; return n })}
          onTogglePlay={(a) => togglePlay(a)}
          onPlayTrack={(a, i) => {
            const t = a.topTracks[i]
            if (audio.currentTrack?.id === t.id) { if (audio.isPlaying) audio.pause(); else audio.resume() }
            else playArtist(a, i)
          }}
          onJudge={(a, v) => judge(a, v, false, a.id === selectedId)}
          onSave={toggleSave}
          onShare={share}
          onShortcuts={() => setSheetOpen(true)}
        />

        <div className="ev-toast-region" role="status" aria-live="polite">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                className="ev-toast"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8, transition: { duration: 0.14 } }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <span>{toast.text}</span>
                {toast.undo && (
                  <button className="ev-toast-undo" onClick={toast.undo}>
                    <Undo2 size={14} aria-hidden />Undo<Kbd>Z</Kbd>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <dialog ref={sheetRef} className="ev-sheet" onClose={() => setSheetOpen(false)} onClick={(e) => e.target === e.currentTarget && setSheetOpen(false)} aria-labelledby="ev-sheet-title">
          <div className="ev-sheet-inner">
            <header className="ev-sheet-head">
              <h2 id="ev-sheet-title">Keyboard shortcuts</h2>
              <button className="ev-icon-btn" onClick={() => setSheetOpen(false)} aria-label="Close"><X size={16} aria-hidden /></button>
            </header>
            <dl className="ev-sheet-list">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={label} className="ev-sheet-row">
                  <dt>{label}</dt>
                  <dd>{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd>
                </div>
              ))}
            </dl>
            <p className="ev-sheet-note">Triage moves you to the next artist. If music is playing, it keeps playing.</p>
          </div>
        </dialog>
      </div>
    </MotionConfig>
  )
}

function FocusCard(props: {
  a: LabArtist
  verdict?: Verdict
  saved: boolean
  playing: boolean
  currentTrackId: string | null
  onTogglePlay: () => void
  onPlayTrack: (i: number) => void
  onJudge: (v: Verdict) => void
  onSave: () => void
  onShare: () => void
}) {
  const { a, verdict, saved, playing, currentTrackId } = props
  const liked = verdict === "liked"
  return (
    <>
      <div className="ev-card-hero">
        <img className="ev-card-art" src={a.imageUrl} alt={`${a.topTracks[0]?.albumName ?? a.name} cover art`} width={600} height={600} />
        <div className="ev-card-id">
          <h2 className="ev-card-name">{a.name}</h2>
          <p className="ev-card-genres">{a.genres.join(" · ")}</p>
          <p className="ev-card-why">
            Because you like{" "}
            {a.why.sourceArtists.map((s, i) => (
              <span key={s}>{i > 0 && (i === a.why.sourceArtists.length - 1 ? " and " : ", ")}<strong>{s}</strong></span>
            ))}
          </p>
          <p className="ev-card-pop">
            <span className="ev-meter" aria-hidden><span style={{ width: `${a.popularity}%` }} /></span>
            {popularityLabel(a.popularity)} · popularity {a.popularity}
          </p>
        </div>
      </div>

      <div className="ev-card-actions">
        <button className="ev-btn ev-btn-play" onClick={props.onTogglePlay} aria-pressed={playing}>
          {playing ? <Pause size={18} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden />}
          {playing ? "Pause" : "Play preview"}
          <Kbd>Space</Kbd>
        </button>

        <div className="ev-triage" role="group" aria-label="Tell flipside what you think">
          <button className="ev-tri" onClick={() => props.onJudge("passed")}>
            <ThumbsDown size={16} strokeWidth={1.75} aria-hidden /><span>Less like this</span>
          </button>
          <button className="ev-tri" onClick={() => props.onJudge("dismissed")}>
            <X size={16} strokeWidth={1.75} aria-hidden /><span>Dismiss</span>
          </button>
          <button className="ev-tri ev-tri-like" onClick={() => props.onJudge("liked")} aria-pressed={liked}>
            <Heart size={16} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden />
            <span>{liked ? "Liked" : "More like this"}</span>
          </button>
        </div>

        <p className="ev-hints" aria-hidden>
          <span><Kbd>X</Kbd>less</span><span><Kbd>D</Kbd>dismiss</span><span><Kbd>L</Kbd>more</span>
          <span><Kbd>B</Kbd>save</span><span><Kbd>O</Kbd>open</span><span><Kbd>J</Kbd><Kbd>K</Kbd>move</span>
        </p>

        <div className="ev-secondary">
          <button className="ev-sec" onClick={props.onSave} aria-pressed={saved} title="Save for later (B)">
            <Bookmark size={16} strokeWidth={1.75} fill={saved ? "currentColor" : "none"} aria-hidden />
            <span>{saved ? "Saved" : "Save"}</span>
          </button>
          <a className="ev-sec" href={spotifyUrl(a)} target="_blank" rel="noopener noreferrer" title="Open in Spotify (O)">
            <ExternalLink size={16} strokeWidth={1.75} aria-hidden /><span>Spotify</span>
          </a>
          <button className="ev-sec" onClick={props.onShare} title="Share (S)">
            <Share2 size={16} strokeWidth={1.75} aria-hidden /><span>Share</span>
          </button>
        </div>
      </div>

      <section className="ev-tracks" aria-label="Previews">
        <h3 className="ev-tracks-title">Previews <span>30 seconds each</span></h3>
        <ol>
          {a.topTracks.map((t, i) => {
            const current = currentTrackId === t.id
            return (
              <li key={t.id}>
                <button className="ev-track" data-current={current || undefined} onClick={() => props.onPlayTrack(i)} aria-label={`${current && playing ? "Pause" : "Play"} ${t.name}`}>
                  <span className="ev-track-n" aria-hidden>
                    {current && playing ? <Pause size={13} fill="currentColor" strokeWidth={0} /> : <span className="ev-track-i">{i + 1}</span>}
                    {!(current && playing) && <Play className="ev-track-hover" size={13} fill="currentColor" strokeWidth={0} />}
                  </span>
                  <span className="ev-track-name">{t.name}<span className="ev-track-album">{t.albumName}</span></span>
                  <span className="ev-track-dur">{duration(t.durationMs)}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>
    </>
  )
}

function Player({ artist, className }: { artist: LabArtist | null; className: string }) {
  const audio = useAudio()
  const t = audio.currentTrack
  if (!t || !artist) {
    return (
      <div className={`ev-player ${className}`} data-idle>
        <span className="ev-player-idle">Nothing playing. Press <Kbd>Space</Kbd> to hear the selected artist.</span>
      </div>
    )
  }
  return (
    <div className={`ev-player ${className}`} style={artistVars(artist)}>
      <img src={artist.imageUrl} alt="" width={40} height={40} />
      <div className="ev-player-text">
        <span className="ev-player-track">{t.name}</span>
        <span className="ev-player-artist">{artist.name}</span>
      </div>
      <button className="ev-icon-btn ev-player-btn" onClick={() => (audio.isPlaying ? audio.pause() : audio.resume())} aria-label={audio.isPlaying ? "Pause" : "Play"}>
        {audio.isPlaying ? <Pause size={18} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden />}
      </button>
      <span className="ev-player-bar" aria-hidden><span style={{ transform: `scaleX(${audio.progress})` }} /></span>
    </div>
  )
}
