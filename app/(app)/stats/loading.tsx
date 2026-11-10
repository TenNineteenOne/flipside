import "@/components/stats/stats.css"

/** Same boxes as StatsClient (components/stats/stats.css) so nothing moves when the page arrives. */
export default function StatsLoading() {
  return (
    <div className="st shell-wide" aria-busy="true">
      <header className="st-head">
        <h1 className="st-title">Stats</h1>
        <p className="st-sub">Your discovery journey</p>
      </header>

      <div className="st-body" aria-hidden>
        <div className="st-col">
          <dl className="st-counts">
            {["Discovered", "Saved", "Liked", "Passed"].map((label) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="st-n"><span className="fs-skeleton st-skel st-skel-line st-skel-num">&nbsp;</span></dd>
              </div>
            ))}
          </dl>
          <section>
            <div className="st-sec-head">
              <h2 className="st-h2">Top genres</h2>
            </div>
            <ol className="st-genres">
              {[70, 55, 62, 40, 48].map((w, i) => (
                <li key={i} className="st-genre">
                  <span className="st-genre-rank st-n">{i + 1}</span>
                  <span className="st-genre-name"><span className="fs-skeleton st-skel st-skel-line" style={{ width: `${w}%` }}>&nbsp;</span></span>
                  <span className="st-genre-count st-n">&nbsp;</span>
                  <span className="st-bar" />
                </li>
              ))}
            </ol>
          </section>
        </div>
        <section className="st-panel">
          <div className="st-sec-head">
            <h2 className="st-h2">Your taste profile</h2>
          </div>
          <div className="fs-skeleton st-skel st-skel-chart" />
        </section>
      </div>
    </div>
  )
}
