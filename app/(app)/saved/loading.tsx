export default function SavedLoading() {
  return (
    <div>
      <div className="page-head">
        <h1>Saved</h1>
        <span className="sub" aria-hidden>
          <span
            className="fs-skeleton"
            style={{ display: "inline-block", width: 64, height: 14 }}
          />
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="fs-skeleton"
            style={{ width: "100%", aspectRatio: "1 / 1.4", borderRadius: 18 }}
          />
        ))}
      </div>
    </div>
  )
}
