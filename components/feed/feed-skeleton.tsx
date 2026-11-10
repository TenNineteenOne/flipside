import "@/components/feed/feed.css"

const ROWS = Array.from({ length: 10 }, (_, i) => i)

/**
 * Feed skeleton (the route's loading.tsx, and FeedClient's fallback while a layout's code
 * loads), one tree per layout picked with CSS (feed.css); this file has no JS.
 * 900px and wider and at least 540px tall: the desktop queue + focus pane (same grid and
 * `shell-fill` opt-out). 640–899px and at least 680px tall: the tablet card, triage bar and
 * Up next list. Otherwise (below 640px, or short): one Snap page and the triage bar. Each uses the real view's frame, so
 * nothing shifts when the feed arrives. The cold-start hint depends on data, so
 * no space is reserved for it.
 */
export function FeedSkeleton() {
  return (
    <>
      <div className="ev-feed ev-app shell-fill ev-skel-wide" aria-hidden>
        <div className="ev-queue">
          <div className="ev-queue-head">
            <div>
              <h1 className="ev-queue-title">Today&rsquo;s flipside</h1>
              {/* inside the real subtitle's box, so the header (and the rows under it) keep their height */}
              <p className="ev-queue-sub"><span className="fs-skeleton ev-skel-line" style={{ display: "inline-block", width: 320, verticalAlign: "middle" }} /></p>
            </div>
            <span className="fs-skeleton" style={{ width: 220, height: 14 }} />
          </div>
          <QueueColumns />
          <div className="ev-rows">
            {ROWS.map((i) => (
              <div key={i} className="ev-row">
                <span className="fs-skeleton" style={{ width: 48, height: 48, borderRadius: 7 }} />
                <div className="ev-row-text">
                  <span className="fs-skeleton ev-skel-line" style={{ width: "40%" }} />
                  <span className="fs-skeleton ev-skel-line" style={{ width: "65%", marginTop: 6 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="ev-focus">
          <div className="ev-card ev-skel-card">
            <span className="fs-skeleton ev-card-art" />
            <span className="fs-skeleton" style={{ width: "60%", height: 32 }} />
            <span className="fs-skeleton ev-skel-line" style={{ width: "80%" }} />
            <span className="fs-skeleton" style={{ width: "100%", height: 50, borderRadius: 11 }} />
            <span className="fs-skeleton" style={{ width: "100%", height: 44, borderRadius: 9 }} />
          </div>
        </div>
      </div>

      {/* Phone (Snap) everywhere the desktop and tablet rules don't apply, and tablet 640–899px x ≥680px: the same fixed frame, card and triage bar
          as the real views (feed.css also reserves the top bar's count/strip row). */}
      <div className="ev-feed ev-snap ev-skel-m" aria-hidden>
        <div className="ev-m-snap"><div className="ev-m-page"><SnapCardSkeleton /></div></div>
        <TriageSkeleton />
      </div>
      <div className="ev-feed ev-snap ev-tablet ev-skel-m ev-skel-tablet" aria-hidden>
        <div className="ev-m-stage"><div className="ev-m-deck"><SnapCardSkeleton /></div></div>
        <TriageSkeleton />
        <div className="ev-m-rail-wrap">
          <h2 className="ev-m-rail-title">Up next</h2>
          <ol className="ev-m-rail">
            {ROWS.map((i) => (
              <li key={i} className="ev-m-thumb">
                <span className="fs-skeleton ev-m-thumb-img" />
                <span className="ev-m-thumb-text" style={{ flex: 1, gap: 6 }}>
                  <span className="fs-skeleton ev-skel-line" style={{ width: "70%" }} />
                  <span className="fs-skeleton ev-skel-line" style={{ width: "45%" }} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  )
}

/**
 * The desktop queue's column labels (feed.css .ev-cols: the rows' grid, sticky under the queue
 * header). Shared by FeedDesktop and the skeleton so the loaded feed doesn't shift. Rows carry
 * their own visually hidden "Genre:" / "Popularity:" prefixes; the hint is the only extra.
 */
export function QueueColumns() {
  const hint = "0–100. Lower means more obscure."
  return (
    <div className="ev-cols">
      <span>Artist</span>
      <span className="ev-col-genre">Genre</span>
      <span className="ev-col-pop" title={hint}>Popularity<span className="sr-only"> ({hint})</span></span>
    </div>
  )
}

/** The snap card's shape: artwork, name, genres + three 44px icon slots, why line, three chips. */
function SnapCardSkeleton() {
  return (
    <div className="ev-m-card ev-skel-mcard">
      <span className="fs-skeleton ev-m-art" />
      <div className="ev-m-info">
        <span className="fs-skeleton ev-m-name" style={{ width: "55%", height: "1.15em" }} />
        <div className="ev-m-meta" style={{ height: 44 }}>
          <span className="fs-skeleton ev-skel-line" style={{ width: "45%" }} />
        </div>
        <span className="fs-skeleton ev-skel-line" style={{ width: "75%", height: 14, margin: "3px 0" }} />
        <div className="ev-m-chips">
          {[0, 1, 2].map((i) => <span key={i} className="fs-skeleton ev-m-chip" />)}
        </div>
      </div>
    </div>
  )
}

function TriageSkeleton() {
  return (
    <div className="ev-m-triage">
      {[0, 1, 2].map((i) => <span key={i} className="fs-skeleton ev-m-tri" />)}
    </div>
  )
}
