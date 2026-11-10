import Link from "next/link"

const PAGES = [
  { href: "/dev-preview/shell", label: "Shell", note: "Rail, top bar, tab bar and avatar menu around tall filler content" },
  { href: "/dev-preview/feed", label: "Feed", note: "Production FeedClient with the 19 fixture artists: desktop feed at 900px+ wide and 540px+ tall, tablet 640–899px wide and 680px+ tall, Snap otherwise" },
  { href: "/dev-preview/feed?start=3", label: "Feed, 3 to start", note: "Starts with 3 artists; the mount top-up and each Load more append the next 6 through the real fill hook" },
  { href: "/dev-preview/feed?real=1", label: "Feed, real-data shapes", note: "Popularity 0, long hyphenated genres and a long name swapped into a few rows; add &n=40 or &n=80 to repeat the fixtures up to that many artists (header strip stress)" },
  { href: "/dev-preview/feed-loading", label: "Feed loading", note: "The feed route's loading skeleton" },
  { href: "/dev-preview/stats", label: "Stats", note: "Production StatsClient with a full account; ?empty=1 a new account, ?stress=1 long genres, large counts and 200 points" },
  { href: "/dev-preview/stats-loading", label: "Stats loading", note: "The Stats route's loading skeleton" },
  { href: "/dev-preview/feed-empty", label: "Empty feed", note: "No recommendations yet: the loader (generate stays pending)" },
  { href: "/dev-preview/genre-picker", label: "Genre picker", note: "Onboarding's genre picker (search, browse, related chips, 50 cap) with the saved value shown below" },
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
