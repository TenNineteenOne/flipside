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
          <Link href={SIGN_UP} className="ev-btn ev-btn-primary ev-btn-sm">Start listening</Link>
        </nav>
      </header>

      <section className="ev-hero">
        <div className="ev-hero-copy">
          <h1 className="ev-hero-title">Great music is waiting to find&nbsp;you.</h1>
          <div className="ev-hero-cta">
            <Link href={SIGN_UP} className="ev-btn ev-btn-primary ev-btn-lg">
              Start listening
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
            <h3><span className="ev-step-n">1</span>Username</h3>
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
            <h3><span className="ev-step-n">2</span>Say what you like</h3>
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
            <h3><span className="ev-step-n">3</span>Hear more artists</h3>
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

      <footer className="ev-site-foot">
        <Wordmark />
      </footer>
    </div>
  )
}
