/** A placeholder in the Explore card's shape (explore.css `.ex-skel-*`): artwork, name, three tracks, actions. */
export function SkeletonCard() {
  return (
    <div className="ex-skel-card">
      <span className="fs-skeleton ex-skel-art" />
      <div className="ex-skel-body">
        <span className="fs-skeleton ex-skel-line ex-skel-name" />
        <span className="fs-skeleton ex-skel-line ex-skel-meta" />
        <span className="fs-skeleton ex-skel-tracks" />
        <div className="ex-skel-row">
          <span className="fs-skeleton" />
          <span className="fs-skeleton" />
          <span className="fs-skeleton" />
        </div>
      </div>
    </div>
  )
}
