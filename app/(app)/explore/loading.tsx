import "@/components/explore/explore.css"
import { ChallengeSkeleton } from "@/components/explore/challenge-card"
import { SkeletonCard } from "@/components/explore/skeleton-card"

/** Explore's loading state: the page's own header, control row, challenge, tabs and grid boxes (explore.css). */
export default function ExploreLoading() {
  return (
    <div className="ev-explore shell-wide" aria-busy="true">
      <header className="ex-head">
        <div>
          <h1 className="ex-title">Explore</h1>
          <p className="ex-lede">Artists further out from your usual, in rails you can shuffle whenever you like.</p>
        </div>
        <span className="fs-skeleton ex-skel-line ex-skel-tally" aria-hidden />
      </header>

      <div className="ex-controls" aria-hidden>
        <div className="ex-adv">
          <span className="ex-switch" />
          <span className="ex-adv-text">
            <span className="ex-adv-label">Adventurous mode</span>
            <span className="fs-skeleton ex-skel-line ex-skel-hint" />
            <span className="fs-skeleton ex-skel-line ex-skel-hint ex-skel-wrap" />
          </span>
        </div>
        <div className="ex-actions">
          <span className="fs-skeleton ex-skel-btn" />
        </div>
      </div>

      <ChallengeSkeleton />

      <div className="ex-tabs" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="fs-skeleton ex-skel-tab" />
        ))}
      </div>

      <div className="ex-rail-head" aria-hidden>
        <span className="fs-skeleton ex-skel-line ex-skel-title" />
        <span className="fs-skeleton ex-skel-line ex-skel-sub" />
        <span className="fs-skeleton ex-skel-line ex-skel-sub ex-skel-wrap" />
      </div>

      <div className="ex-grid" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  )
}
