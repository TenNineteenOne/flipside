import "@/components/feed/feed.css"

const ROWS = Array.from({ length: 10 }, (_, i) => i)

/**
 * Feed skeleton. 900px and wider: the desktop feed's queue + focus pane (same
 * grid and `shell-fill` opt-out, so nothing shifts when it arrives). Below: the
 * card-list skeleton. Picked with CSS (feed.css); this file has no JS.
 */
export default function FeedLoading() {
  return (
    <>
      <div className="ev-feed ev-app shell-fill ev-skel-wide" aria-hidden>
        <div className="ev-queue">
          <div className="ev-queue-head">
            <div>
              <h1 className="ev-queue-title">Today&rsquo;s flipside</h1>
              <span className="fs-skeleton ev-skel-line" style={{ width: 320, marginTop: 8 }} />
            </div>
            <span className="fs-skeleton" style={{ width: 220, height: 14 }} />
          </div>
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

      <div className="ev-skel-narrow">
        <div className="page-head">
          <h1>Today&apos;s feed</h1>
          <span className="sub" aria-hidden>
            <span className="fs-skeleton" style={{ display: "inline-block", width: 72, height: 14 }} />
          </span>
        </div>
        <div className="col" style={{ gap: 24, marginTop: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fs-skeleton" style={{ width: "100%", height: 540, borderRadius: 20 }} />
          ))}
        </div>
      </div>
    </>
  )
}
