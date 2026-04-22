export default function ExploreLoading() {
  return (
    <div>
      <div className="page-head">
        <h1>Explore</h1>
        <span className="sub" aria-hidden>
          <span
            className="fs-skeleton"
            style={{ display: "inline-block", width: 96, height: 14 }}
          />
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 16,
          marginBottom: 14,
        }}
      >
        {[104, 112, 120, 92].map((w, i) => (
          <span
            key={i}
            className="fs-skeleton"
            style={{ width: w, height: 32, borderRadius: 999 }}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span
          className="fs-skeleton"
          style={{ width: 240, height: 14 }}
        />
        <span
          className="fs-skeleton"
          style={{ width: 96, height: 34, borderRadius: 8 }}
        />
      </div>

      <div className="col gap-16">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="fs-skeleton"
            style={{
              width: "100%",
              height: 500,
              borderRadius: 20,
            }}
          />
        ))}
      </div>
    </div>
  )
}
