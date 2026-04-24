export default function StatsLoading() {
  return (
    <div>
      <div className="page-head">
        <h1>Stats</h1>
        <span className="sub" aria-hidden>
          <span
            className="fs-skeleton"
            style={{ display: "inline-block", width: 96, height: 14 }}
          />
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 12,
          marginTop: 12,
          marginBottom: 20,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="fs-skeleton"
            style={{ width: "100%", height: 92, borderRadius: 14 }}
          />
        ))}
      </div>

      <div className="col" style={{ gap: 14 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="fs-skeleton"
            style={{ width: "100%", height: 220, borderRadius: 18 }}
          />
        ))}
      </div>
    </div>
  )
}
