"use client"

import { memo, use, type CSSProperties } from "react"
import { Check } from "lucide-react"

export interface ChallengePayload {
  description: string
  progress: number
  target: number
  completed: boolean
}

/**
 * The weekly challenge as one line under the Feed header (mockup public/mockups/feed-merge.html §6,
 * option Q). Styles in feed.css, `.ev-chal*`: a light line beside Load more in the desktop queue header, a full-width line on phones and tablets.
 */
export const ChallengeStrip = memo(function ChallengeStrip({ description, progress, target, completed }: ChallengePayload) {
  const pct = Math.min(100, Math.round((progress / target) * 100))
  return (
    <section aria-label="Weekly challenge" className="ev-chal" data-done={completed || undefined}>
      <p className="ev-chal-text">
        {/* the hidden ":" keeps the lead and description apart for screen readers and copy */}
        <span className="ev-chal-title">Weekly challenge</span>
        <span className="sr-only">:</span>
        <span aria-hidden> · </span>
        {description}
      </p>
      <span className="ev-chal-n">
        {completed && <Check size={14} strokeWidth={2.5} aria-hidden />}
        {progress}/{target}
      </span>
      <div className="ev-chal-track" aria-hidden>
        <span style={{ "--p": pct / 100 } as CSSProperties} />
      </div>
    </section>
  )
})

/** Same box as the strip while the challenge streams in (Suspense fallback), so nothing shifts. */
export function ChallengeSkeleton() {
  return (
    <div className="ev-chal ev-chal-skel" aria-hidden>
      <span className="fs-skeleton ev-chal-skel-line" />
      <div className="ev-chal-track" />
    </div>
  )
}

/** Unwraps the page's unawaited challenge promise (React 19 `use`); null (none, or a failed load) renders nothing. */
export function ChallengeSlot({ challengePromise }: { challengePromise: Promise<ChallengePayload | null> }) {
  const challenge = use(challengePromise)
  return challenge ? <ChallengeStrip {...challenge} /> : null
}
