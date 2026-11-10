import Link from "next/link"

const PAGES = [
  { href: "/dev-preview/shell", label: "Shell", note: "Rail, top bar, tab bar and avatar menu around tall filler content" },
  { href: "/dev-preview/feed", label: "Feed", note: "Production FeedClient with the 19 fixture artists: desktop feed at 900px and wider, card list below" },
  { href: "/dev-preview/feed?start=3", label: "Feed, 3 to start", note: "Starts with 3 artists; the mount top-up and each Load more append the next 6 through the real fill hook" },
  { href: "/dev-preview/feed-loading", label: "Feed loading", note: "The feed route's loading skeleton" },
  { href: "/dev-preview/feed-empty", label: "Empty feed", note: "No recommendations yet: the loader (generate stays pending) and Explore pre-warm" },
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
