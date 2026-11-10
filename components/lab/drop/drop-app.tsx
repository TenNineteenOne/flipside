"use client"

import { useCallback, useEffect, useState } from "react"
import { useAudio } from "@/lib/audio-context"
import { Deck } from "./deck"
import {
  crateFor, dayLabel, demoStore, dropDay, edition, emptyStore, inkOf, loadStore, saveStore, shareText, streakOf, todayEntries,
  type DropStore, type Verdict,
} from "./drop-core"
import { Art, InkDefs } from "./ink"
import { Countdown, SharePoster, ShareActions, StreakCalendar, Wall, useOrigin } from "./result"

const STAMP: Record<Verdict, string> = { keep: "Keep", pass: "Pass", save: "Wall", skip: "Not today" }
const NAV = [
  { label: "Today's drop", href: "#drop" },
  { label: "Explore", href: "#" },
  { label: "History", href: "#" },
  { label: "The wall", href: "#wall" },
  { label: "Streaks", href: "#streak" },
  { label: "Settings", href: "#" },
]

export function DropApp({ demo }: { demo?: string }) {
  const audio = useAudio()
  const [day] = useState(() => dropDay())
  const [store, setStore] = useState<DropStore>(emptyStore)
  const [ready, setReady] = useState(false)
  const [bonus, setBonus] = useState(false)
  const origin = useOrigin()
  const url = `${origin}/lab/drop`

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from localStorage
    setStore(demo === "result" || demo === "mid" ? demoStore(day, demo === "mid") : loadStore())
    setReady(true)
  }, [demo, day])
  useEffect(() => {
    if (ready && !demo) saveStore(store)
  }, [store, ready, demo])

  const crate = crateFor(day)
  const drop = crate.slice(0, 5)
  const today = todayEntries(store, day)
  const bonusDone = store.history.filter((e) => e.day === day && e.bonus)
  const finished = today.length >= 5
  const inBonus = finished && bonus
  const bonusQueue = crate.slice(5)
  const current = !finished ? drop[today.length] : inBonus ? bonusQueue[bonusDone.length] : undefined
  const streak = streakOf(store.done, day)

  const decide = useCallback(
    (verdict: Verdict) => {
      if (!current) return
      const wasPlaying = audio.isPlaying
      setStore((s) => {
        const history = [...s.history, { id: current.id, day, verdict, ...(inBonus ? { bonus: true } : {}) }]
        const n = history.filter((e) => e.day === day && !e.bonus).length
        return { history, done: n >= 5 && !s.done.includes(day) ? [...s.done, day] : s.done }
      })
      const next = !finished ? (today.length + 1 < 5 ? drop[today.length + 1] : undefined) : bonusQueue[bonusDone.length + 1]
      if (wasPlaying && next?.topTracks[0]) audio.play(next.topTracks[0], next.name, next.imageUrl, next.color)
      else if (wasPlaying) audio.pause()
    },
    [audio, current, day, inBonus, finished, today.length, drop, bonusQueue, bonusDone.length],
  )

  const undo = useCallback(() => {
    setStore((s) => {
      const i = s.history.findLastIndex((e) => e.day === day && !!e.bonus === inBonus)
      if (i < 0) return s
      const history = s.history.filter((_, j) => j !== i)
      const n = history.filter((e) => e.day === day && !e.bonus).length
      return { history, done: n < 5 ? s.done.filter((d) => d !== day) : s.done }
    })
  }, [day, inBonus])

  const canUndo = inBonus ? bonusDone.length > 0 : today.length > 0

  return (
    <div className="d-app">
      <InkDefs />
      <header className="d-mast">
        <a className="d-logo" href="/lab/drop">Flipside</a>
        <p className="d-edition">
          Drop Nº {edition(day)} <span>· {dayLabel(day)}</span>
        </p>
        <nav className="d-nav" aria-label="Sections">
          {NAV.map((n, i) => (
            <a key={n.label} href={n.href} aria-current={i === 0 ? "page" : undefined}>{n.label}</a>
          ))}
        </nav>
      </header>

      <main className="d-stage">
        <section id="drop" className="d-main" aria-label="Today's drop">
          {current ? (
            <Deck
              key={current.id + (inBonus ? "-b" : "")}
              artist={current}
              slot={inBonus ? `Bonus · ${bonusDone.length + 1} of ${bonusQueue.length}` : `Nº ${edition(day)} · ${today.length + 1} of 5`}
              onDecide={decide}
              onUndo={undo}
              canUndo={canUndo}
            />
          ) : inBonus ? (
            <div className="d-done">
              <h1 className="d-done-h">That&rsquo;s the whole crate.</h1>
              <p>Nothing left to dig through today. The next drop lands at 8:00.</p>
              <p className="d-done-count">Next drop in <Countdown /></p>
              <button type="button" className="d-btn is-pass" onClick={() => setBonus(false)}>Back to today&rsquo;s result</button>
            </div>
          ) : (
            <div className="d-done">
              <h1 className="d-done-h">That&rsquo;s the drop. Go outside.</h1>
              <SharePoster day={day} entries={today} streak={streak} url={url} />
              <ShareActions text={shareText(day, today, streak, url)} />
              <p className="d-done-count">Next drop in <Countdown /></p>
              <div className="d-done-more">
                <button type="button" className="d-link" onClick={() => setBonus(true)}>
                  Still hungry? Bonus round: {bonusQueue.length - bonusDone.length} more from the crate
                </button>
                {canUndo && <button type="button" className="d-link" onClick={undo}>Undo last decision</button>}
              </div>
            </div>
          )}
        </section>

        <aside className="d-queue" aria-label="Today's five">
          <h2 className="d-h">Today&rsquo;s five</h2>
          <ol>
            {drop.map((a, i) => {
              const e = today[i]
              const isNow = !finished && i === today.length
              return (
                <li key={a.id} className={`d-q${isNow ? " is-now" : ""}${e ? " is-done" : ""}`} style={{ ["--ink" as string]: inkOf(a) }}>
                  {e ? <Art artist={a} /> : <span className="d-q-face" aria-hidden="true" />}
                  <span className="d-q-no">{i + 1}</span>
                  <span className="d-q-label">{e || isNow ? a.name : a.genres[0]}</span>
                  {e && <span className={`d-q-stamp is-${e.verdict}`}>{STAMP[e.verdict]}</span>}
                </li>
              )
            })}
          </ol>
        </aside>

        <aside className="d-side">
          <section id="streak" className="d-panel">
            <h2 className="d-h">Streak</h2>
            <p className="d-streak"><b>{streak}</b> {streak === 1 ? "day" : "days"} running</p>
            <StreakCalendar today={day} done={store.done} />
            {!finished && <p className="d-small">Next drop in <Countdown /></p>}
          </section>
          <section id="wall" className="d-panel">
            <h2 className="d-h">The wall</h2>
            <Wall entries={store.history} limit={8} />
          </section>
          <p className="d-keys">
            <kbd>←</kbd> pass <kbd>→</kbd> keep <kbd>↑</kbd> wall <kbd>Space</kbd> play <kbd>Z</kbd> undo
          </p>
        </aside>
      </main>
    </div>
  )
}
