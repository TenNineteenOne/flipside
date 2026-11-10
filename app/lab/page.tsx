import Link from "next/link"
import { LAB_OPTIONS } from "@/lib/lab/options"
import { SCALE_FINDINGS, PERF_FINDINGS, type Finding } from "@/lib/lab/findings"
import { Verdict, PickSummary } from "@/components/lab/picks"
import "./gallery.css"

const TODAY = [
  ["Nothing to see or hear", "The landing page is a headline and a button. A stranger has to sign up before learning what the product is."],
  ["A phone column on every screen", "The app is 520px wide even on a 27-inch monitor. Most of a desktop is empty."],
  ["Six stacked buttons per card", "Open, share, bookmark, less, dismiss, more: all full width, all the same weight."],
  ["Expensive to paint", "Every card has a 30px backdrop blur and a full-screen grain layer sits over the whole page."],
  ["Four font families", "Fraunces, Instrument Serif, JetBrains Mono and Inter all load on every page."],
]

function Findings({ items }: { items: Finding[] }) {
  if (!items.length) return <p className="pending">Not included in this branch. The audit is kept on the local-only branch design-lab-full.</p>
  return (
    <ol className="findings">
      {items.map((f) => (
        <li key={f.title}>
          <h4>
            {f.title} <span className="effort" data-e={f.effort}>{f.effort}</span>
          </h4>
          <p>{f.detail}</p>
          <p className="fix"><b>Fix:</b> {f.fix}</p>
          <code>{f.evidence}</code>
        </li>
      ))}
    </ol>
  )
}

export default function LabIndex() {
  return (
    <main className="lab-gallery">
      <header className="top">
        <p className="mark"><span aria-hidden /> flipside · design lab</p>
        <h1>Five ways Flipside could look and work.</h1>
        <p className="lede">
          Each one is a working prototype with real artwork and real 30-second previews: a landing page for strangers and
          the signed-in app. Nothing here touches the real app or its data. Click through, mark a verdict, tick the ideas
          you want, then copy your picks at the bottom.
        </p>
        <nav aria-label="Directions">
          {LAB_OPTIONS.map((o) => (
            <a key={o.slug} href={`#${o.slug}`}>{o.name}</a>
          ))}
          <a href="#picks">Your picks</a>
          <a href="#audit">Audit</a>
        </nav>
      </header>

      <section className="today" aria-labelledby="today-h">
        <div>
          <h2 id="today-h">Where it stands today</h2>
          <ul>
            {TODAY.map(([t, d]) => (
              <li key={t}><b>{t}.</b> {d}</li>
            ))}
          </ul>
        </div>
        <figure>
          <img src="/lab/shots/current-landing.png" alt="The current Flipside landing page: a headline on black with a purple glow" width={1440} height={900} />
          <figcaption>The current landing page</figcaption>
        </figure>
      </section>

      {LAB_OPTIONS.map((o, i) => (
        <section key={o.slug} id={o.slug} className="option" aria-labelledby={`${o.slug}-h`}>
          <div className="copy">
            <p className="count">{i + 1} of {LAB_OPTIONS.length}</p>
            <h2 id={`${o.slug}-h`}>{o.name}</h2>
            <p className="pitch">{o.pitch}</p>
            <dl>
              <dt>The idea</dt><dd>{o.idea}</dd>
              <dt>Look</dt><dd>{o.theme}</dd>
              <dt>Risk</dt><dd>{o.risk}</dd>
              {o.adopt && (<><dt>To build for real</dt><dd>{o.adopt}</dd></>)}
            </dl>
            <p className="links">
              <Link href={`/lab/${o.slug}`} className="primary">Open landing</Link>
              <Link href={`/lab/${o.slug}/app`}>Open app</Link>
            </p>
            <Verdict slug={o.slug} />
          </div>
          <div className="shots">
            <Link href={`/lab/${o.slug}`} className="shot wide">
              <img src={`/lab/shots/${o.slug}-landing.png`} alt={`${o.name}: landing page`} width={1440} height={900} loading="lazy" />
            </Link>
            <Link href={`/lab/${o.slug}/app`} className="shot wide">
              <img src={`/lab/shots/${o.slug}-app.png`} alt={`${o.name}: signed-in app`} width={1440} height={900} loading="lazy" />
            </Link>
            <Link href={`/lab/${o.slug}`} className="shot tall">
              <img src={`/lab/shots/${o.slug}-landing-m.png`} alt={`${o.name}: landing page on a phone`} width={390} height={844} loading="lazy" />
            </Link>
            <Link href={`/lab/${o.slug}/app`} className="shot tall">
              <img src={`/lab/shots/${o.slug}-app-m.png`} alt={`${o.name}: app on a phone`} width={390} height={844} loading="lazy" />
            </Link>
          </div>
        </section>
      ))}

      <section id="picks" className="block" aria-labelledby="picks-h">
        <h2 id="picks-h">Mix and match</h2>
        <p className="lede">
          The skins and the mechanics are separable. A daily drop works in any of these looks; the desktop layout works
          with any mechanic. Tick what you want regardless of which direction it came from.
        </p>
        <PickSummary />
      </section>

      <section id="audit" className="block" aria-labelledby="audit-h">
        <h2 id="audit-h">Before a few hundred thousand people arrive</h2>
        <p className="lede">Findings from reading the real code, ranked by what gives out first. Effort: S is hours, M is days, L is a week or more.</p>
        <h3>Will break at launch scale</h3>
        <Findings items={SCALE_FINDINGS} />
        <h3>Front-end speed</h3>
        <Findings items={PERF_FINDINGS} />
      </section>
    </main>
  )
}
