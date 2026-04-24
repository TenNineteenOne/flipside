export default function FeedLoading() {
  return (
    <div>
      <div className="page-head">
        <h1>Today&apos;s feed</h1>
        <span className="sub" aria-hidden>
          <span
            className="fs-skeleton"
            style={{ display: "inline-block", width: 72, height: 14 }}
          />
        </span>
      </div>

      <div className="col" style={{ gap: 24, marginTop: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="fs-skeleton"
            style={{ width: "100%", height: 540, borderRadius: 20 }}
          />
        ))}
      </div>
    </div>
  )
}
