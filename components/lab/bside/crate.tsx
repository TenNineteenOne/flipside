"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for CSP-allowed mzstatic art */

import { useEffect, useEffectEvent, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "framer-motion"
import { ChevronLeft, ChevronRight, ExternalLink, Pause, Play, Share2, Bookmark, BookmarkCheck, Undo2, FlipHorizontal2 } from "lucide-react"
import { labArtists, type LabArtist } from "@/lib/lab/artists"
import { themeVars } from "./color"
import { Sleeve, catNo, spotifyUrl, useDeck } from "./sleeve"

type Exit = "keep" | "pass" | "back" | "next" | "prev"
type PileKind = "keep" | "pass"

const byId = new Map(labArtists.map((a) => [a.id, a]))
const get = (id: string) => byId.get(id)!
const similar = (a: LabArtist, b: LabArtist) =>
  a.why.sourceArtists.some((s) => b.why.sourceArtists.includes(s)) || a.genres.some((g) => b.genres.includes(g))
/** Deterministic tilt per record so piles look tossed, not stacked by a robot. */
const hash = (id: string) => [...id].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0
const tilt = (id: string) => (hash(id) % 19) - 9
const nudge = (id: string, salt: number) => `${((hash(id) >> salt) % 11) - 5}%`

const NAV = ["Feed", "Explore", "History", "Saved", "Stats", "Settings"] as const

export function Crate({ variant, demo = "" }: { variant: "hero" | "app"; demo?: string }) {
  const piles = demo.includes("piles")
  const [crate, setCrate] = useState(() =>
    labArtists.map((a) => a.id).filter((id) => !piles || !["altıngun", "kokoroko", "crumb", "pachyman", "surprisechef"].includes(id)),
  )
  const [cursor, setCursor] = useState(0)
  const [kept, setKept] = useState<string[]>(piles ? ["altıngun", "kokoroko", "crumb"] : [])
  const [passed, setPassed] = useState<string[]>(piles ? ["pachyman", "surprisechef"] : [])
  const [backed, setBacked] = useState<string[]>([])
  const [held, setHeld] = useState<string[]>(piles ? [labArtists[0].id] : [])
  const [flipped, setFlipped] = useState(demo.includes("flip"))
  const [exit, setExit] = useState<Exit>("next")
  const [openPile, setOpenPile] = useState<PileKind | null>(null)
  const [toast, setToast] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const deck = useDeck()

  const current = crate.length ? get(crate[cursor % crate.length]) : null
  const behind = crate.length > 1 ? [1, 2, 3].filter((k) => k < crate.length).map((k) => get(crate[(cursor + k) % crate.length])) : []

  // Drench: the whole page takes the colour of the record in your hands.
  useEffect(() => {
    const root = rootRef.current?.closest<HTMLElement>(".lab-bside")
    if (!root || !current) return
    for (const [k, v] of Object.entries(themeVars(current))) root.style.setProperty(k, String(v))
  }, [current])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 2800)
    return () => clearTimeout(t)
  }, [toast])

  const flick = (d: 1 | -1) => {
    if (crate.length < 2) return
    setExit(d > 0 ? "next" : "prev")
    setFlipped(false)
    setCursor((c) => (c + d + crate.length) % crate.length)
  }

  const triage = (kind: "keep" | "pass" | "back") => {
    if (!current) return
    const at = cursor % crate.length
    let rest = crate.filter((id) => id !== current.id)
    let note = ""
    if (kind === "keep") {
      // "More like this": pull the closest cousin to the front of the crate.
      const order = [...rest.slice(at), ...rest.slice(0, at)]
      const cousin = order.find((id) => similar(get(id), current))
      if (cousin) {
        rest = rest.filter((id) => id !== cousin)
        rest.splice(Math.min(at, rest.length), 0, cousin)
        note = `Kept. Pulled ${get(cousin).name} from the back for you.`
      } else note = `Kept ${current.name}.`
      setKept((k) => [...k, current.id])
    } else if (kind === "pass") {
      // "Less like this": its cousins sink to the bottom of the crate.
      const near = rest.filter((id) => similar(get(id), current))
      rest = [...rest.filter((id) => !near.includes(id)), ...near]
      note = near.length ? `Passed. Moved ${near.length} like it to the bottom.` : `Passed on ${current.name}.`
      setPassed((p) => [...p, current.id])
    } else {
      setBacked((b) => [...b, current.id])
      note = `${current.name} went back in the crate. Find it in History.`
    }
    setExit(kind)
    setFlipped(false)
    setCrate(rest)
    setCursor(rest.length ? at % rest.length : 0)
    setToast(note)
  }

  const pullOut = (id: string, from: PileKind) => {
    ;(from === "keep" ? setKept : setPassed)((p) => p.filter((x) => x !== id))
    const at = crate.length ? cursor % crate.length : 0
    setCrate((c) => [...c.slice(0, at), id, ...c.slice(at)])
    setCursor(at)
    setExit("prev")
    setFlipped(false)
    setOpenPile(null)
  }

  const hold = (a: LabArtist) => {
    const on = held.includes(a.id)
    setHeld((h) => (on ? h.filter((x) => x !== a.id) : [...h, a.id]))
    setToast(on ? `Took ${a.name} off hold.` : `${a.name} is behind the counter for you. It's in Saved.`)
  }

  const share = async (a: LabArtist) => {
    const url = `${location.origin}/lab/bside?record=${encodeURIComponent(a.id)}`
    try {
      if (navigator.share) await navigator.share({ title: `${a.name} on Flipside`, url })
      else {
        await navigator.clipboard.writeText(url)
        setToast("Link copied. Pass it on.")
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  const refill = () => {
    setCrate(labArtists.map((a) => a.id).filter((id) => !kept.includes(id)))
    setPassed([])
    setBacked([])
    setCursor(0)
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target instanceof Element ? e.target : document.body
    if (t.closest("input, textarea, select, [contenteditable]")) return
    const k = e.key.toLowerCase()
    const run: Record<string, () => void> = {
      arrowright: () => flick(1),
      arrowleft: () => flick(-1),
      f: () => setFlipped((f) => !f),
      k: () => triage("keep"),
      p: () => triage("pass"),
      b: () => triage("back"),
      h: () => current && hold(current),
    }
    if (k === " " && current && !t.closest("button, a")) run[" "] = () => deck.toggle(current)
    if (!run[k] || (!current && k !== "arrowright" && k !== "arrowleft")) return
    e.preventDefault()
    run[k]()
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [])

  const playingArtist = deck.currentTrack ? labArtists.find((a) => deck.owns(a)) : undefined
  const elsewhere = playingArtist && playingArtist.id !== current?.id
  const curPlaying = !!current && deck.owns(current) && deck.isPlaying

  const stage = (
    <div className="bs-stage">
      {behind
        .slice()
        .reverse()
        .map((a) => (
          <div key={a.id} className="bs-behind" style={{ "--k": behind.indexOf(a) + 1 } as React.CSSProperties} aria-hidden="true">
            <img src={a.imageUrl} alt="" width={600} height={600} loading="lazy" />
          </div>
        ))}
      <AnimatePresence initial={false} custom={exit}>
        {current ? (
          <TopSleeve
            key={current.id}
            artist={current}
            exit={exit}
            dragAxis={variant === "hero" ? "x" : true}
            flipped={flipped}
            onFlip={() => setFlipped((f) => !f)}
            held={held.includes(current.id)}
            onHold={() => hold(current)}
            onShare={() => share(current)}
            onKeep={() => triage("keep")}
            onPass={() => triage("pass")}
            onFlick={flick}
            demoSpin={demo.includes("spin")}
          />
        ) : (
          <div key="empty" className="bs-empty">
            <p>That&rsquo;s the whole crate.</p>
            <p className="bs-empty-sub">Everything you didn&rsquo;t keep can go back in for another dig.</p>
            <button type="button" className="bs-btn bs-btn-solid" onClick={refill}>
              Tip it back out
            </button>
          </div>
        )}
      </AnimatePresence>
    </div>
  )

  const deckUi = current && (
    <div className="bs-deck">
      <div className="bs-nowhead">
        <h2 className="bs-name">{current.name}</h2>
        <p className="bs-why">
          <span className="bs-cat-inline">{catNo(current)}</span> Similar to {current.why.sourceArtists.join(" & ")} · {current.genres[0]}
        </p>
      </div>
      <div className="bs-row bs-row-main" role="group" aria-label="Triage this record">
        <button type="button" className="bs-round" onClick={() => flick(-1)} aria-label="Previous record (Left arrow)" disabled={crate.length < 2}>
          <ChevronLeft size={22} aria-hidden />
        </button>
        <button type="button" className="bs-btn bs-btn-line" onClick={() => triage("pass")} aria-keyshortcuts="P">
          Pass <kbd>P</kbd>
        </button>
        <button type="button" className="bs-btn bs-btn-solid bs-play" onClick={() => deck.toggle(current)} aria-pressed={curPlaying}>
          {curPlaying ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
          {curPlaying ? "Pause" : "Play A1"}
        </button>
        <button type="button" className="bs-btn bs-btn-line" onClick={() => triage("keep")} aria-keyshortcuts="K">
          Keep <kbd>K</kbd>
        </button>
        <button type="button" className="bs-round" onClick={() => flick(1)} aria-label="Next record (Right arrow)" disabled={crate.length < 2}>
          <ChevronRight size={22} aria-hidden />
        </button>
      </div>
      <div className="bs-row bs-row-sub">
        <button type="button" className="bs-text" onClick={() => setFlipped((f) => !f)} aria-keyshortcuts="F">
          <FlipHorizontal2 size={15} aria-hidden /> {flipped ? "Show cover" : "Flip it"}
        </button>
        <button type="button" className="bs-text" onClick={() => triage("back")} aria-keyshortcuts="B">
          <Undo2 size={15} aria-hidden /> Back in the crate
        </button>
        <button type="button" className="bs-text" onClick={() => hold(current)} aria-pressed={held.includes(current.id)} aria-keyshortcuts="H">
          {held.includes(current.id) ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
          {held.includes(current.id) ? "On hold" : "Put on hold"}
        </button>
        <a className="bs-text" href={spotifyUrl(current)} target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden /> Spotify
        </a>
        <button type="button" className="bs-text" onClick={() => share(current)}>
          <Share2 size={15} aria-hidden /> Share
        </button>
      </div>
      <p className="bs-toast" role="status" aria-live="polite">
        {toast}
      </p>
      {elsewhere && playingArtist && (
        <div className="bs-spinning">
          <span>
            On the turntable: <strong>{deck.currentTrack!.name}</strong> by {playingArtist.name}
          </span>
          <button type="button" className="bs-text" onClick={() => (deck.isPlaying ? deck.pause() : deck.resume())}>
            {deck.isPlaying ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
            {deck.isPlaying ? "Pause" : "Resume"}
          </button>
        </div>
      )}
    </div>
  )

  const pile = (kind: PileKind) => (
    <Pile
      kind={kind}
      ids={kind === "keep" ? kept : passed}
      open={openPile === kind}
      onToggle={() => setOpenPile((o) => (o === kind ? null : kind))}
      onPull={(id) => pullOut(id, kind)}
    />
  )

  if (variant === "hero") {
    return (
      <div ref={rootRef} className="bs-crate bs-crate-hero">
        <div className="bs-hero-stage">{stage}</div>
        {deckUi}
        <div className="bs-hero-piles">
          {pile("pass")}
          {pile("keep")}
        </div>
        {kept.length >= 2 && (
          <div className="bs-cta" role="status">
            <p>
              <strong>{kept.length} in your keep pile.</strong> Want them to stay put? Pick a name at the counter and the crate is yours.
            </p>
            <Link className="bs-btn bs-btn-solid" href="/sign-in?mode=new">
              Start your own crate
            </Link>
          </div>
        )}
      </div>
    )
  }

  const history = kept.length + passed.length + backed.length
  return (
    <div ref={rootRef} className="bs-crate bs-crate-app">
      <header className="bs-appbar">
        <Link href="/lab/bside" className="bs-wordmark">
          Flipside
        </Link>
        <nav aria-label="Sections" className="bs-dividers">
          {NAV.map((n) => (
            <a key={n} href="#" aria-current={n === "Feed" ? "page" : undefined}>
              {n}
              {n === "Saved" && held.length > 0 && <span className="bs-count">{held.length}</span>}
              {n === "History" && history > 0 && <span className="bs-count">{history}</span>}
            </a>
          ))}
        </nav>
        <span className="bs-handle" aria-label="Signed in as saturday_digger">
          @saturday_digger
        </span>
      </header>
      <main className="bs-floor">
        <div className="bs-col bs-col-pass">{pile("pass")}</div>
        <div className="bs-col bs-col-crate">
          {stage}
          {deckUi}
        </div>
        <div className="bs-col bs-col-keep">{pile("keep")}</div>
      </main>
      <p className="bs-keys" aria-hidden="true">
        <kbd>←</kbd>
        <kbd>→</kbd> flick · <kbd>F</kbd> flip · <kbd>Space</kbd> play · <kbd>K</kbd> keep · <kbd>P</kbd> pass · <kbd>B</kbd> back in the crate · <kbd>H</kbd> hold
      </p>
    </div>
  )
}

interface TopProps {
  artist: LabArtist
  exit: Exit
  dragAxis: "x" | true
  flipped: boolean
  onFlip: () => void
  held: boolean
  onHold: () => void
  onShare: () => void
  onKeep: () => void
  onPass: () => void
  onFlick: (d: 1 | -1) => void
  demoSpin: boolean
}

const EXITS: Record<Exit, object> = {
  keep: { x: "120%", y: 40, rotate: 16, opacity: 0 },
  pass: { x: "-120%", y: 40, rotate: -16, opacity: 0 },
  back: { y: "45%", scale: 0.86, opacity: 0 },
  next: { y: "40%", scale: 1.04, opacity: 0 },
  prev: { y: "-6%", scale: 0.94, opacity: 0 },
}

function TopSleeve({ artist, dragAxis, onKeep, onPass, onFlick, ...rest }: TopProps) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-320, 320], [-14, 14])
  const keepInk = useTransform(x, [30, 140], [0, 1])
  const passInk = useTransform(x, [-140, -30], [1, 0])
  const ease = [0.16, 1, 0.3, 1] as const

  const variants = {
    enter: (e: Exit) => (reduce ? { opacity: 0 } : e === "prev" ? { y: "18%", opacity: 0 } : { y: "-6.5%", scale: 0.95 }),
    center: { x: 0, y: 0, scale: 1, opacity: 1, transition: { duration: reduce ? 0.15 : 0.45, ease } },
    exit: (e: Exit) => (reduce ? { opacity: 0, transition: { duration: 0.15 } } : { ...EXITS[e], transition: { duration: 0.42, ease } }),
  }

  const onDragEnd = (_: unknown, i: PanInfo) => {
    const { x: dx, y: dy } = i.offset
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 110 || i.velocity.x > 700) onKeep()
      else if (dx < -110 || i.velocity.x < -700) onPass()
    } else if (dragAxis === true) {
      if (dy < -90) onFlick(1)
      else if (dy > 90) onFlick(-1)
    }
  }

  return (
    <motion.div
      className="bs-top"
      custom={rest.exit}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      drag={dragAxis}
      dragSnapToOrigin
      dragElastic={0.55}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      onTap={(e) => {
        if (!(e.target as HTMLElement).closest("button, a")) rest.onFlip()
      }}
      style={{ x, rotate, touchAction: dragAxis === "x" ? "pan-y" : "none" }}
    >
      <motion.span className="bs-stamp bs-stamp-keep" style={{ opacity: keepInk }} aria-hidden>
        Keep
      </motion.span>
      <motion.span className="bs-stamp bs-stamp-pass" style={{ opacity: passInk }} aria-hidden>
        Pass
      </motion.span>
      <Sleeve artist={artist} priority {...rest} />
    </motion.div>
  )
}

function Pile({ kind, ids, open, onToggle, onPull }: { kind: PileKind; ids: string[]; open: boolean; onToggle: () => void; onPull: (id: string) => void }) {
  const deck = useDeck()
  const label = kind === "keep" ? "Keep pile" : "Pass pile"
  const hint = kind === "keep" ? "More like these" : "Less like these"
  const from = kind === "keep" ? -1 : 1
  const listId = `bs-pile-${kind}`
  return (
    <section className={`bs-pile bs-pile-${kind}`} aria-label={label}>
      <button type="button" className="bs-pile-stack" onClick={onToggle} aria-expanded={open} aria-controls={listId} disabled={!ids.length}>
        {ids.length === 0 && <span className="bs-pile-empty">{kind === "keep" ? "Swipe right or press K to keep" : "Swipe left or press P to pass"}</span>}
        {ids.slice(-6).map((id) => {
          const a = get(id)
          return (
            <motion.img
              key={id}
              src={a.imageUrl}
              alt=""
              width={600}
              height={600}
              loading="lazy"
              initial={{ x: `${from * 160}%`, y: "-30%", rotate: from * 30, scale: 1.3 }}
              animate={{ x: nudge(id, 3), y: nudge(id, 7), rotate: tilt(id), scale: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            />
          )
        })}
      </button>
      <p className="bs-pile-label">
        <strong>
          {label} · {ids.length}
        </strong>
        <span>{ids.length ? (open ? "Close the pile" : `${hint}. Open the pile`) : hint}</span>
      </p>
      {open && ids.length > 0 && (
        <ul className="bs-pile-list" id={listId}>
          {ids
            .slice()
            .reverse()
            .map((id) => {
              const a = get(id)
              const on = deck.owns(a) && deck.isPlaying
              return (
                <li key={id} style={themeVars(a)}>
                  <img src={a.imageUrl} alt="" width={48} height={48} loading="lazy" />
                  <span className="bs-pl-name">
                    <strong>{a.name}</strong>
                    <span>{a.genres[0]}</span>
                  </span>
                  <button type="button" className="bs-round bs-round-sm" onClick={() => deck.toggle(a)} aria-label={`${on ? "Pause" : "Play"} ${a.name}`}>
                    {on ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
                  </button>
                  <button type="button" className="bs-text" onClick={() => onPull(id)}>
                    Pull out
                  </button>
                </li>
              )
            })}
        </ul>
      )}
    </section>
  )
}
