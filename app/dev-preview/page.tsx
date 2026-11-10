import Link from "next/link"

const PAGES = [
  { href: "/dev-preview/shell", label: "Shell", note: "Rail, top bar, tab bar and avatar menu around tall filler content" },
  { href: "/dev-preview/legacy-feed", label: "Legacy feed", note: "Current production FeedClient with fixture artists inside the shell" },
]

export default function DevPreviewIndex() {
  return (
    <>
      <div className="page-head">
        <h1>Dev preview</h1>
      </div>
      <ul style={{ display: "grid", gap: 12, padding: 0, listStyle: "none" }}>
        {PAGES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} style={{ fontWeight: 600 }}>{p.label}</Link>
            <div className="muted" style={{ fontSize: 14 }}>{p.note}</div>
          </li>
        ))}
      </ul>
    </>
  )
}
