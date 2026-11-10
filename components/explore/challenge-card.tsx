import { memo, type CSSProperties } from "react"
import { Check } from "lucide-react"

export interface ChallengeCardProps {
  title: string
  description: string
  progress: number
  target: number
  completed: boolean
  /** Kept for callers; the card no longer changes colour with Adventurous mode. */
  adventurous?: boolean
}

/** The weekly challenge (styles in explore.css, `.ex-challenge*`; rendered inside `.ev-explore`). */
export const ChallengeCard = memo(function ChallengeCard({
  title,
  description,
  progress,
  target,
  completed,
}: ChallengeCardProps) {
  const pct = Math.min(100, Math.round((progress / target) * 100))

  return (
    <section aria-label="Weekly challenge" className="ex-challenge" data-done={completed || undefined}>
      <div className="ex-challenge-row">
        <p className="ex-challenge-text">
          {/* the separator keeps the title and description apart for screen readers and copy */}
          <span className="ex-challenge-title">{title}</span>
          <span className="sr-only">:</span> {description}
        </p>
        <span className="ex-challenge-n">
          {completed && <Check size={14} strokeWidth={2.5} aria-hidden />}
          {progress}/{target}
        </span>
      </div>
      <div className="ex-challenge-track" aria-hidden>
        <span style={{ "--p": pct / 100 } as CSSProperties} />
      </div>
    </section>
  )
})

/** Same box as the card while the challenge streams in (Suspense fallback), so nothing shifts. */
export function ChallengeSkeleton() {
  return (
    <div className="ex-challenge ex-challenge-skel" aria-hidden>
      <div className="ex-challenge-row">
        <span className="fs-skeleton ex-skel-line ex-skel-challenge" />
        <span className="fs-skeleton ex-skel-line ex-skel-wrap" />
      </div>
      <div className="ex-challenge-track" />
    </div>
  )
}
