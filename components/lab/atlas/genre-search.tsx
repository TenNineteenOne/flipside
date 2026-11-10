"use client"

import { forwardRef, useMemo, useState } from "react"
import { Search } from "lucide-react"
import type { GenreHit } from "./atlas-map"

interface Props {
  genres: GenreHit[]
  onJump: (g: GenreHit) => void
}

/** Combobox over all ~6.3k genre names; Enter flies the camera there. */
export const GenreSearch = forwardRef<HTMLInputElement, Props>(function GenreSearch({ genres, onJump }, ref) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const starts: GenreHit[] = [], has: GenreHit[] = []
    for (const g of genres) {
      if (g.label.startsWith(t)) starts.push(g)
      else if (g.label.includes(t)) has.push(g)
      if (starts.length >= 8) break
    }
    return [...starts, ...has].slice(0, 8)
  }, [q, genres])

  const jump = (g: GenreHit) => { onJump(g); setQ(g.label); setOpen(false) }
  const show = open && results.length > 0

  return (
    <div className="atlas-search">
      <Search size={16} aria-hidden className="atlas-search-icon" />
      <input
        ref={ref}
        type="search"
        role="combobox"
        aria-label="Find a genre on the map"
        aria-expanded={show}
        aria-controls="atlas-search-list"
        aria-autocomplete="list"
        aria-activedescendant={show ? `atlas-opt-${active}` : undefined}
        placeholder={genres.length ? `Find any of ${genres.length.toLocaleString("en-US")} genres` : "Loading the map…"}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          else if (e.key === "Enter" && results[active]) { e.preventDefault(); jump(results[active]) }
          else if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur() }
        }}
      />
      {show && (
        <ul id="atlas-search-list" role="listbox" className="atlas-search-list">
          {results.map((g, i) => (
            <li
              key={g.label}
              id={`atlas-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => { e.preventDefault(); jump(g) }}
              onPointerEnter={() => setActive(i)}
            >
              <b>{g.label}</b>
              {g.ex && <span>e.g. {g.ex}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
