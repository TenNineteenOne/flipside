"use client"

import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"

type SearchError =
  | "unauth"
  | "rate-limited"
  | "unavailable"
  | "network"
  | "unknown"

function errorMessage(kind: SearchError): string {
  switch (kind) {
    case "unauth": return "Please sign in again to search artists"
    case "rate-limited": return "Too many searches — try again in a few seconds"
    case "unavailable": return "Search is temporarily unavailable"
    case "network": return "Network error — check your connection"
    case "unknown": return "Couldn't search — try again"
  }
}

export interface SpotifyArtist {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
}

export interface ArtistSearchProps {
  selected: SpotifyArtist[]
  onAdd: (artist: SpotifyArtist) => void
  onRemove: (id: string) => void
  cap: number
  minForHint?: number
}

export function ArtistSearch({ selected, onAdd, onRemove, cap, minForHint = 3 }: ArtistSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SpotifyArtist[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<SearchError | null>(null)
  const [degraded, setDegraded] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    if (!query.trim()) { setResults([]); setError(null); setDegraded(false); return }

    debounceRef.current = setTimeout(async () => {
      const aborter = new AbortController()
      abortRef.current = aborter
      setSearching(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/onboarding/search?q=${encodeURIComponent(query.trim())}`,
          { signal: aborter.signal },
        )
        if (res.ok) {
          const data = await res.json()
          setResults(data.artists ?? [])
          setDegraded(!!data.degraded)
          return
        }
        setDegraded(false)
        console.error("[artist-search]", res.status)
        if (res.status === 401) setError("unauth")
        else if (res.status === 429) setError("rate-limited")
        else if (res.status === 503) setError("unavailable")
        else setError("unknown")
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") return
        console.error("[artist-search] network", err)
        setError("network")
      } finally {
        setSearching(false)
      }
    }, 350)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [query])

  const selectedIds = new Set(selected.map((a) => a.id))
  const atCap = selected.length >= cap

  return (
    <div className="col gap-10">
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {selected.map((a) => (
            <div key={a.id} className="chip selected" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>{a.name}</span>
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${a.name}`}
                style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="field" style={{ height: 40, position: "relative" }}>
        <Search
          size={14}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}
        />
        <input
          type="text"
          placeholder="Search artists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 32 }}
        />
      </div>
      {searching && !error && (
        <div className="mono muted" style={{ fontSize: 11 }}>Searching…</div>
      )}
      {error && (
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--danger, #f87171)" }}
          role="alert"
        >
          {errorMessage(error)}
        </div>
      )}
      {!error && degraded && results.length > 0 && (
        <div className="mono muted" style={{ fontSize: 11 }}>
          Showing cached results — live search is rate-limited
        </div>
      )}
      {results.length > 0 && (
        <div
          style={{
            maxHeight: 220,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
          }}
        >
          {results.map((artist) => {
            const already = selectedIds.has(artist.id)
            return (
              <button
                key={artist.id}
                type="button"
                disabled={already || atCap}
                onClick={() => onAdd(artist)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  background: already ? "rgba(139,92,246,0.08)" : "transparent",
                  border: 0,
                  cursor: already ? "default" : "pointer",
                  textAlign: "left",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {artist.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artist.imageUrl} alt={artist.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 32, height: 32, borderRadius: 6, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {artist.name}
                  </div>
                  {artist.genres[0] && (
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>
                      {artist.genres[0]}
                    </div>
                  )}
                </div>
                {already && (
                  <span style={{ fontSize: 11, color: "var(--accent)", flexShrink: 0 }}>added</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {selected.length > 0 && selected.length < minForHint && (
        <div className="muted" style={{ fontSize: 11 }}>
          Add {minForHint - selected.length} more to use this path
        </div>
      )}
    </div>
  )
}
