import Link from "next/link"
import { Crate } from "@/components/lab/bside/crate"
import { Wall } from "@/components/lab/bside/wall"

export const metadata = { title: "Flipside: the good stuff is on the flipside" }

export default async function BsideLanding({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo = "" } = await searchParams
  return (
    <div className="bs-landing">
      <header className="bs-topbar">
        <Link href="/lab/bside" className="bs-wordmark">
          Flipside
        </Link>
        <nav aria-label="Account">
          <Link href="/sign-in" className="bs-text">
            Sign in
          </Link>
          <Link href="/sign-in?mode=new" className="bs-btn bs-btn-line">
            Start your crate
          </Link>
        </nav>
      </header>

      <section className="bs-hero" aria-labelledby="bs-hero-h">
        <div className="bs-hero-copy">
          <h1 id="bs-hero-h">The good stuff is on the flipside.</h1>
          <p className="bs-lede">
            A crate of artists you&rsquo;ve probably never heard. Flick through, flip a sleeve to read why it&rsquo;s here, drop the needle for
            thirty seconds. Nothing to sign.
          </p>
          <p className="bs-howto">
            <span>
              <kbd>F</kbd> flip it
            </span>
            <span>
              <kbd>Space</kbd> play
            </span>
            <span>
              <kbd>K</kbd> keep
            </span>
            <span>
              <kbd>P</kbd> pass
            </span>
            <span>
              <kbd>←</kbd>
              <kbd>→</kbd> flick
            </span>
          </p>
        </div>
        <Crate variant="hero" demo={demo} />
      </section>

      <section className="bs-rules" aria-labelledby="bs-rules-h">
        <h2 id="bs-rules-h">
          <span>No email.</span>
          <span>No password.</span>
          <span>No listening history.</span>
        </h2>
        <div className="bs-rules-body">
          <p>
            Pick a name at the counter and that&rsquo;s your crate. We don&rsquo;t want your inbox, we&rsquo;d only lose the password, and we
            don&rsquo;t need receipts for what you played last Tuesday.
          </p>
          <p>
            Keep something and we pull more like it from the back. Pass and we stop bringing it out. That&rsquo;s the whole arrangement.
          </p>
          <Link href="/sign-in?mode=new" className="bs-btn bs-btn-solid">
            Pick a name, start digging
          </Link>
        </div>
      </section>

      <section className="bs-arrivals" aria-labelledby="bs-arrivals-h">
        <div className="bs-arrivals-head">
          <h2 id="bs-arrivals-h">New in this week</h2>
          <p>Nineteen records, none of them on the radio. Tap a sleeve to hear side A.</p>
        </div>
        <Wall />
      </section>

      <footer className="bs-foot">
        <span className="bs-wordmark">Flipside</span>
        <span>Music discovery, without the strings.</span>
        <span>Previews courtesy of Apple Music. Thirty seconds each.</span>
      </footer>
    </div>
  )
}
