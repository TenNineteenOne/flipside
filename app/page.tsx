// Static by design: no session, cookies or headers here. The proxy redirects signed-in visitors to /feed.
import Image from "next/image"
import Link from "next/link"
import { Heart, ThumbsDown, X } from "lucide-react"
import { AudioProvider } from "@/lib/audio-context"
import { whyText } from "@/lib/feed/card-copy"
import { artworkAt } from "@/lib/feed/artwork"
import { artistVars, landingSample } from "@/lib/landing/sample"
import { HeroStack } from "@/components/landing/hero-stack"
import "./landing.css"

const SIGN_UP = "/sign-in?mode=new"

function Wordmark() {
  return (
    <span className="ev-wordmark" aria-label="flipside">
      flipside<span className="ev-dot" aria-hidden />
    </span>
  )
}

export default function LandingPage() {
  return (
    <div className="ev-landing">
      <header className="ev-site-head">
        <Link href="/" aria-label="flipside home">
          <Wordmark />
        </Link>
        <nav className="ev-site-nav">
          <Link href="/sign-in" className="ev-link">Sign in</Link>
          <Link href={SIGN_UP} className="ev-btn ev-btn-primary ev-btn-sm">Pick a name</Link>
        </nav>
      </header>

      <section className="ev-hero">
        <div className="ev-hero-copy">
          <h1 className="ev-hero-title">Somebody great you&rsquo;ve never&nbsp;heard.</h1>
          <p className="ev-hero-lede">
            Flipside plays 30-second previews of artists outside your usual rotation.
          </p>
          <div className="ev-hero-cta">
            <Link href={SIGN_UP} className="ev-btn ev-btn-primary ev-btn-lg">
              Pick a name
            </Link>
          </div>
        </div>
        <AudioProvider>
          <HeroStack />
        </AudioProvider>
      </section>

      <section className="ev-how" aria-label="How it works">
        <div className="ev-step">
          <div className="ev-step-copy">
            <h3><span className="ev-step-n">1</span>Pick a name.</h3>
          </div>
          <div className="ev-frag ev-frag-name" role="img" aria-label="A sign-up box with a single name field filled in as lowtide">
            <span className="ev-frag-label">Your name on flipside</span>
            <div className="ev-frag-field">
              <span>lowtide</span><span className="ev-caret" />
              <span className="ev-frag-ok">available</span>
            </div>
            <span className="ev-frag-btn">Start listening</span>
          </div>
        </div>

        <div className="ev-step">
          <div className="ev-step-copy">
            <h3><span className="ev-step-n">2</span>Say what you love, or don&rsquo;t.</h3>
          </div>
          <div className="ev-frag ev-frag-tune" role="img" aria-label="Triage buttons, with the genres flipside will lean toward and away from">
            <div className="ev-frag-tri">
              <span className="ev-tri"><ThumbsDown size={15} aria-hidden />Less like this</span>
              <span className="ev-tri"><X size={15} aria-hidden />Dismiss</span>
              <span className="ev-tri ev-tri-like" data-on><Heart size={15} fill="currentColor" aria-hidden />Liked</span>
            </div>
            <div className="ev-frag-tunerows">
              <div><span className="ev-tune-label">More</span><span className="ev-chip ev-chip-more">desert blues</span><span className="ev-chip ev-chip-more">thai funk</span><span className="ev-chip ev-chip-more">spiritual jazz</span></div>
              <div><span className="ev-tune-label">Less</span><span className="ev-chip">dream pop</span></div>
            </div>
          </div>
        </div>

        <div className="ev-step">
          <div className="ev-step-copy">
            <h3><span className="ev-step-n">3</span>Hear artists you&rsquo;ve never played.</h3>
          </div>
          <ul className="ev-frag ev-frag-queue" aria-label="A sample of the queue">
            {landingSample.queue.map((a) => (
              <li key={a.id} style={artistVars(a)}>
                <Image src={artworkAt(a.imageUrl, 44)} alt="" width={44} height={44} decoding="async" />
                <span className="ev-frag-q-text"><strong>{a.name}</strong><span>{whyText(a.why)}</span></span>
                <span className="ev-frag-q-genre">{a.genres[0]}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ev-promise" aria-labelledby="ev-promise-title">
        <div className="ev-promise-copy">
          <h2 id="ev-promise-title" className="ev-section-title">The sign-up form we didn&rsquo;t build.</h2>
        </div>
        <div className="ev-form" role="img" aria-label="A sign-up form where email, password, birthday and connect-your-streaming fields are crossed out, leaving only a name field">
          {["Email address", "Password", "Date of birth", "Connect your streaming account"].map((f) => (
            <div key={f} className="ev-form-row ev-form-row-off"><span>{f}</span><span className="ev-form-tag">not asked</span></div>
          ))}
          <div className="ev-form-row ev-form-row-on"><span>Name</span><span className="ev-form-val">lowtide</span></div>
        </div>
      </section>

      <footer className="ev-site-foot">
        <Wordmark />
      </footer>
    </div>
  )
}
