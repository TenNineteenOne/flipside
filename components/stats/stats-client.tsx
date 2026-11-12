"use client"

import "./stats.css"
import Link from "next/link"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useId, useMemo, useState } from "react"

interface SavedArtist {
  name: string
  /** null = unknown; listed in the table, left out of the scatter and median. */
  popularity: number | null
}

interface StatsClientProps {
  totalDiscovered: number
  totalSaves: number
  totalLikes: number
  totalDislikes: number
  topGenres: { genre: string; count: number }[]
  savedArtists: SavedArtist[]
  likedArtists: SavedArtist[]
}

/** One fixed-locale formatter: the browser's locale would render "1.234.567" against the server's "1,234,567" (hydration error). */
const NUM = new Intl.NumberFormat("en-US")

type TasteKind = "saved" | "liked"
const KIND_LABEL: Record<TasteKind, string> = { saved: "Saved", liked: "Liked" }

/** The shape that marks a kind everywhere on the page (chart, legend, badge): filled violet = saved, ring = liked. */
function Mark({ kind }: { kind: TasteKind }) {
  return <span className={`st-mark st-mark-${kind}`} aria-hidden />
}

function Totals({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <dl className="st-counts" aria-label="Totals">
      {rows.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="st-n">{NUM.format(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function TopGenres({ genres }: { genres: { genre: string; count: number }[] }) {
  const maxCount = genres.length > 0 ? genres[0].count : 1
  const headingId = useId()

  return (
    <section aria-labelledby={headingId}>
      <div className="st-sec-head">
        <h2 id={headingId} className="st-h2">Top genres</h2>
      </div>
      {genres.length === 0 ? (
        <p className="st-empty">No likes yet.</p>
      ) : (
        <ol className="st-genres">
          {genres.map(({ genre, count }, i) => (
            <li key={genre} className="st-genre">
              <span className="st-genre-rank st-n" aria-hidden>{i + 1}</span>
              <span className="st-genre-name">{genre}</span>
              <span className="st-genre-count st-n">{NUM.format(count)}</span>
              <span className="st-bar" aria-hidden>
                <span style={{ width: `${(count / maxCount) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function popularityTier(pop: number): string {
  if (pop < 20) return "Obscure"
  if (pop < 40) return "Niche"
  if (pop < 60) return "Emerging"
  if (pop < 80) return "Popular"
  return "Mainstream"
}

function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

type TasteItem = { name: string; popularity: number | null; kind: TasteKind }

const TICKS = [0, 20, 40, 60, 80, 100]

function TasteProfileView({
  savedArtists,
  likedArtists,
}: {
  savedArtists: SavedArtist[]
  likedArtists: SavedArtist[]
}) {
  const [sortDesc, setSortDesc] = useState(false)
  const headingId = useId()
  const captionId = useId()

  const items = useMemo<TasteItem[]>(() => {
    const savedNames = new Set(savedArtists.map((a) => a.name))
    const out: TasteItem[] = savedArtists.map((a) => ({ ...a, kind: "saved" as const }))
    for (const a of likedArtists) {
      if (savedNames.has(a.name)) continue
      out.push({ ...a, kind: "liked" })
    }
    return out
  }, [savedArtists, likedArtists])

  const sorted = useMemo(
    // Unknown popularity sorts last either way.
    () => [...items].sort((a, b) =>
      a.popularity === null ? 1 : b.popularity === null ? -1 : sortDesc ? b.popularity - a.popularity : a.popularity - b.popularity),
    [items, sortDesc]
  )

  const known = useMemo(() => items.filter((a): a is TasteItem & { popularity: number } => a.popularity !== null), [items])
  const mid = known.length > 0 ? median(known.map((a) => a.popularity)) : 0

  return (
    <section className="st-panel" aria-labelledby={headingId}>
      <div className="st-sec-head">
        <h2 id={headingId} className="st-h2">Your taste profile</h2>
        {items.length > 0 && (
          <div className="st-legend">
            <span><Mark kind="saved" />Saved</span>
            <span><Mark kind="liked" />Liked</span>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="st-empty">Nothing saved or liked yet.</p>
      ) : (
        <>
          <figure className="st-fig">
            <figcaption id={captionId} className="st-caption">
              Median popularity: {mid}
              <span className="sr-only">
                . Each mark is an artist you saved or liked, placed by popularity from 0 (barely known) to 100 (mainstream).
              </span>
            </figcaption>
            <div className="st-plot">
              <svg
                role="img"
                aria-label={`Taste profile popularity distribution: ${NUM.format(items.length)} artists, median popularity ${mid}`}
                aria-describedby={captionId}
              >
                <g className="st-grid">
                  {TICKS.map((tick) => (
                    <line key={tick} x1={`${tick}%`} x2={`${tick}%`} y1="0" y2="100%" />
                  ))}
                </g>
                <line className="st-axis" x1="0" x2="100%" y1="100%" y2="100%" />
                {known.map((a) => (
                  <circle
                    key={`${a.kind}-${a.name}`}
                    className={`st-dot-${a.kind}`}
                    cx={`${a.popularity}%`}
                    cy={`${8 + hashSeed(a.name) * 80}%`}
                    r={a.kind === "saved" ? 5 : 4.5}
                  >
                    <title>{`${a.name} · popularity ${a.popularity} · ${a.kind}`}</title>
                  </circle>
                ))}
              </svg>
              <div className="st-ticks st-n" aria-hidden>
                {TICKS.map((tick) => (
                  <span key={tick} style={{ left: `${tick}%` }}>{tick}</span>
                ))}
              </div>
            </div>
            <p className="st-axis-title" aria-hidden>Popularity</p>
          </figure>

          {/* ARIA table: the header row's Popularity cell is the sort control and carries aria-sort. */}
          <div className="st-table" role="table" aria-label="Saved and liked artists by popularity">
            <div role="rowgroup">
              <div className="st-thead" role="row">
                <span role="columnheader">Artist</span>
                <span role="columnheader">Kind</span>
                <span role="columnheader" aria-sort={sortDesc ? "descending" : "ascending"}>
                  <button
                    type="button"
                    className="st-sort"
                    onClick={() => setSortDesc((v) => !v)}
                    aria-label={`Popularity, sorted ${sortDesc ? "highest" : "lowest"} first. Activate to sort ${sortDesc ? "lowest" : "highest"} first.`}
                  >
                    Popularity
                    {sortDesc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />}
                  </button>
                </span>
              </div>
            </div>

            {/* the scrolling body is focusable so keyboard users can scroll it */}
            <div className="st-rows" role="rowgroup" tabIndex={0} aria-label="Artists">
              {sorted.map((a) => (
                <div key={`${a.kind}-${a.name}`} className="st-row" role="row">
                  <span className="st-row-name" role="cell" title={a.name}>{a.name}</span>
                  <span className="st-row-kind" role="cell">
                    <span className={`st-kind st-kind-${a.kind}`}>
                      <Mark kind={a.kind} />
                      {KIND_LABEL[a.kind]}
                    </span>
                  </span>
                  <span className="st-row-pop st-n" role="cell" title={a.popularity === null ? "Unknown" : popularityTier(a.popularity)}>
                    {a.popularity ?? "–"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export function StatsClient({
  totalDiscovered,
  totalSaves,
  totalLikes,
  totalDislikes,
  topGenres,
  savedArtists,
  likedArtists,
}: StatsClientProps) {
  const nothingDecided = topGenres.length === 0 && savedArtists.length === 0 && likedArtists.length === 0

  return (
    <div className="st shell-wide">
      <header className="st-head">
        <h1 className="st-title">Stats</h1>
        {nothingDecided && (
          <p className="st-lead">
            Nothing here yet. Like or save a few artists in the <Link href="/feed">feed</Link>.
          </p>
        )}
      </header>

      <div className="st-body">
        <div className="st-col">
          <Totals
            rows={[
              { label: "Discovered", value: totalDiscovered },
              { label: "Saved", value: totalSaves },
              { label: "Liked", value: totalLikes },
              { label: "Passed", value: totalDislikes },
            ]}
          />
          <TopGenres genres={topGenres} />
        </div>
        <TasteProfileView savedArtists={savedArtists} likedArtists={likedArtists} />
      </div>
    </div>
  )
}
