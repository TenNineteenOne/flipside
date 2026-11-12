export default function HistoryLoading() {
  return (
    <div>
      <div className="page-head">
        <h1>History</h1>
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {[88, 96, 104, 80].map((w, i) => (
          <span
            key={i}
            className="fs-skeleton"
            style={{ width: w, height: 32, borderRadius: 999 }}
          />
        ))}
      </div>

      <div className="col" style={{ gap: 14 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="fs-skeleton"
            style={{ width: "100%", height: 72, borderRadius: 12 }}
          />
        ))}
      </div>
    </div>
  )
}
