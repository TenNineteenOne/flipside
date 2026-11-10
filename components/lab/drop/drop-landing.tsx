"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Undo2 } from "lucide-react"
import { Deck } from "./deck"
import { crateFor, dayLabel, demoStore, dropDay, edition, inkOf, shareText, VERDICT_WORD, type Verdict } from "./drop-core"
import { InkDefs } from "./ink"
import { Countdown, SharePoster, useOrigin } from "./result"

export function DropLanding() {
  const [day] = useState(() => dropDay())
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const origin = useOrigin()
  const crate = crateFor(day)
  const first = crate[0]
  const sample = demoStore(day).history.filter((e) => e.day === day)
  const url = `${origin}/lab/drop`

  return (
    <div className="d-land">
      <InkDefs />
      <header className="d-mast is-land">
        <span className="d-logo">Flipside</span>
        <p className="d-edition">Drop Nº {edition(day)} <span>· {dayLabel(day)}</span></p>
        <Link className="d-mast-cta" href="/sign-in?mode=new">Get tomorrow&rsquo;s drop</Link>
      </header>

      <section className="d-hero" aria-labelledby="d-hero-h">
        <div className="d-hero-copy">
          <h1 id="d-hero-h" className="d-hero-h">
            Five artists you&rsquo;ve never heard. <em>Every morning.</em> Then go outside.
          </h1>
          <p className="d-hero-sub">
            Today&rsquo;s drop is already on the wall. Tap the poster to hear artist one, then swipe it: right to keep, left to pass, up to pin it to your wall.
          </p>
          <Link className="d-btn is-keep d-cta" href="/sign-in?mode=new">
            Get tomorrow&rsquo;s drop <ArrowRight aria-hidden="true" />
          </Link>
          <p className="d-smallprint">
            Doors 8:00am daily · Admission free · Just pick a username · No email · No password · No listening history · All ages
          </p>
        </div>

        <div className="d-hero-wall">
          <ol className="d-teasers" aria-label="The other four artists in today's drop">
            {crate.slice(1, 5).map((a, i) => (
              <li key={a.id} style={{ ["--ink" as string]: inkOf(a), ["--i" as string]: i }}>
                <span className="d-teaser-no">{i + 2}</span>
                <span className="d-teaser-g">{a.genres[0]}</span>
                <span className="d-teaser-strip">Members only</span>
              </li>
            ))}
          </ol>
          {verdict ? (
            <div className="d-hero-after" aria-live="polite">
              <p className="d-hero-stamp" data-v={verdict}>{VERDICT_WORD[verdict]}</p>
              <p className="d-hero-after-h">One down. Four still on the wall.</p>
              <p>They stay hidden until you&rsquo;re in. Takes a username and about four seconds.</p>
              <Link className="d-btn is-keep" href="/sign-in?mode=new">Open the other four <ArrowRight aria-hidden="true" /></Link>
              <button type="button" className="d-link" onClick={() => setVerdict(null)}><Undo2 aria-hidden="true" /> Change my mind</button>
            </div>
          ) : (
            <Deck artist={first} slot={`Nº ${edition(day)} · 1 of 5`} onDecide={setVerdict} />
          )}
        </div>
      </section>

      <section className="d-post" aria-labelledby="d-post-h">
        <div className="d-post-copy">
          <h2 id="d-post-h" className="d-section-h">Five decisions. One little poster.</h2>
          <p>
            Everyone gets the same five on the same morning, so your result is something to compare. Kept, passed, pinned: it prints as five blocks of
            colour you can paste into the group chat without spoiling a single name.
          </p>
          <pre className="d-grid-text" aria-label="Example copied result">{shareText(day, sample, 9, url || "flipside")}</pre>
          <p className="d-small">Next drop in <Countdown /></p>
        </div>
        <SharePoster day={day} entries={sample} streak={9} url={url || "flipside"} />
      </section>

      <section className="d-rules" aria-labelledby="d-rules-h">
        <h2 id="d-rules-h" className="d-section-h">House rules</h2>
        <ul>
          <li><span className="d-stamp-inline is-keep">Keep</span> Swipe right. You get more like it tomorrow.</li>
          <li><span className="d-stamp-inline is-pass">Pass</span> Swipe left. Fewer like it. No hard feelings.</li>
          <li><span className="d-stamp-inline is-save">Wall</span> Swipe up. Pinned to your wall to play again whenever.</li>
        </ul>
        <Link className="d-btn is-keep d-cta" href="/sign-in?mode=new">Get tomorrow&rsquo;s drop <ArrowRight aria-hidden="true" /></Link>
      </section>
    </div>
  )
}
