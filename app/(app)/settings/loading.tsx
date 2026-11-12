/** Same header as SettingsForm, with panel-sized placeholders below it. */
export default function SettingsLoading() {
  return (
    <div aria-busy="true">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="col gap-16" style={{ marginTop: 8 }} aria-hidden>
        {[120, 280, 220, 160].map((h, i) => (
          <div key={i} className="fs-skeleton" style={{ width: "100%", height: h, borderRadius: 18 }} />
        ))}
      </div>
    </div>
  )
}
