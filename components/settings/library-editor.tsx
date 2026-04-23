"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { GenreNode } from "@/lib/types"
import { GenrePicker, ALL_GENRES } from "@/components/onboarding/genre-picker"
import { ArtistSearch, type SpotifyArtist } from "@/components/onboarding/artist-search"
import { normalizeGenre } from "@/lib/genre/normalize"

const GENRE_CAP = 200
const ARTIST_CAP = 200
const GENRE_SAVE_DEBOUNCE_MS = 400

// Build a normalized-key lookup so "indie-rock", "Indie Rock", and "indie_rock"
// all resolve to the same node. Survives format drift between the stored tag
// format and the tree's lastfmTag format.
export function buildTagLookup(nodes: GenreNode[], acc = new Map<string, GenreNode>()): Map<string, GenreNode> {
  for (const node of nodes) {
    if (node.lastfmTag) {
      const key = normalizeGenre(node.lastfmTag)
      if (key && !acc.has(key)) acc.set(key, node)
    }
    if (node.children.length) buildTagLookup(node.children, acc)
  }
  return acc
}

export interface LibraryEditorProps {
  initialGenreTags: string[]
  initialSeedArtists: SpotifyArtist[]
  flat?: boolean
}

export function LibraryEditor({ initialGenreTags, initialSeedArtists, flat = false }: LibraryEditorProps) {
  const tagLookup = useMemo(() => buildTagLookup(ALL_GENRES), [])

  const { initialGenreNodes, orphanCount } = useMemo(() => {
    const nodes: GenreNode[] = []
    let orphans = 0
    for (const tag of initialGenreTags) {
      const node = tagLookup.get(normalizeGenre(tag))
      if (node) nodes.push(node)
      else orphans += 1
    }
    return { initialGenreNodes: nodes, orphanCount: orphans }
  }, [initialGenreTags, tagLookup])

  const [genres, setGenres] = useState<GenreNode[]>(initialGenreNodes)
  const [artists, setArtists] = useState<SpotifyArtist[]>(initialSeedArtists)
  const [genresOpen, setGenresOpen] = useState(false)
  const [artistsOpen, setArtistsOpen] = useState(false)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveAborter = useRef<AbortController | null>(null)
  const orphanNoticeShown = useRef(false)

  // When the genre taxonomy rebuild dropped some of the user's previously-
  // selected tags, PATCH the pruned list back right away so subsequent loads
  // don't keep flagging the same orphans — and surface a one-shot confirmation.
  useEffect(() => {
    if (orphanCount <= 0 || orphanNoticeShown.current) return
    orphanNoticeShown.current = true
    const valid = initialGenreNodes.map((g) => g.lastfmTag)
    const aborter = new AbortController()
    void (async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedGenres: valid }),
          signal: aborter.signal,
        })
        if (!res.ok) throw new Error("prune failed")
        toast.info(
          `Cleaned up ${orphanCount} old genre tag${orphanCount === 1 ? "" : "s"} from the updated taxonomy.`,
        )
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") return
        // Fall back to the old "heads up" toast if the auto-prune didn't land.
        toast.info(
          `${orphanCount} previously-selected genre${orphanCount === 1 ? "" : "s"} ` +
            `no longer map to our updated taxonomy and will be removed on your next save.`,
        )
      }
    })()
    return () => aborter.abort()
  }, [orphanCount, initialGenreNodes])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveAborter.current?.abort()
    }
  }, [])

  function scheduleGenreSave(next: GenreNode[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      saveAborter.current?.abort()
      const aborter = new AbortController()
      saveAborter.current = aborter
      try {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedGenres: next.map((g) => g.lastfmTag) }),
          signal: aborter.signal,
        })
        if (!res.ok) throw new Error("save failed")
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") return
        toast.error("Couldn't save genres")
      }
    }, GENRE_SAVE_DEBOUNCE_MS)
  }

  function toggleGenre(node: GenreNode) {
    const has = genres.some((g) => g.id === node.id)
    const next = has ? genres.filter((g) => g.id !== node.id) : genres.length < GENRE_CAP ? [...genres, node] : genres
    if (next === genres) return
    setGenres(next)
    scheduleGenreSave(next)
  }

  async function addArtist(artist: SpotifyArtist) {
    if (artists.some((a) => a.id === artist.id) || artists.length >= ARTIST_CAP) return
    const next = [...artists, artist]
    setArtists(next)
    try {
      const res = await fetch("/api/settings/seed-artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artists: [{ id: artist.id, name: artist.name, imageUrl: artist.imageUrl }],
        }),
      })
      if (!res.ok) throw new Error("add failed")
    } catch {
      setArtists((prev) => prev.filter((a) => a.id !== artist.id))
      toast.error("Couldn't add artist")
    }
  }

  async function removeArtist(id: string) {
    const prev = artists
    setArtists((cur) => cur.filter((a) => a.id !== id))
    try {
      const res = await fetch(`/api/settings/seed-artists?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("remove failed")
    } catch {
      setArtists(prev)
      toast.error("Couldn't remove artist")
    }
  }

  const collapsibles = (
    <>
      <Collapsible
        title="Artists"
        subtitle="The starting points for your feed"
        count={artists.length}
        open={artistsOpen}
        onToggle={() => setArtistsOpen((v) => !v)}
        flat={flat}
      >
        <ArtistSearch
          selected={artists}
          onAdd={addArtist}
          onRemove={removeArtist}
          cap={ARTIST_CAP}
          minForHint={0}
        />
      </Collapsible>

      <Collapsible
        title="Genres"
        subtitle="Steer the feed toward what you love"
        count={genres.length}
        open={genresOpen}
        onToggle={() => setGenresOpen((v) => !v)}
        flat={flat}
      >
        <GenrePicker selected={genres} onToggle={toggleGenre} cap={GENRE_CAP} />
      </Collapsible>
    </>
  )

  if (flat) return collapsibles

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Your library</div>
      <div className="col gap-10">{collapsibles}</div>
    </div>
  )
}

function Collapsible({
  title,
  subtitle,
  count,
  open,
  onToggle,
  children,
  flat,
}: {
  title: string
  subtitle: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  flat?: boolean
}) {
  const cardStyle: React.CSSProperties = flat
    ? { padding: 0, overflow: "hidden", background: "transparent", border: 0 }
    : {
        padding: 0,
        overflow: "hidden",
        borderColor: open ? "rgba(139,92,246,0.4)" : "var(--border)",
        background: open ? "rgba(139,92,246,0.04)" : "var(--bg-card)",
        transition: "border-color 0.15s, background 0.15s",
      }

  return (
    <div className={flat ? undefined : "fs-card"} style={cardStyle}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: flat ? "6px 0" : "14px 16px",
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {title}
            {count > 0 && (
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "rgba(139,92,246,0.2)",
                  color: "var(--accent)",
                }}
              >
                {count}
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ color: "var(--text-faint)", flexShrink: 0 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div
          style={
            flat
              ? { paddingTop: 10 }
              : { padding: "0 16px 16px", borderTop: "1px solid var(--border)" }
          }
        >
          <div style={{ paddingTop: flat ? 0 : 14 }}>{children}</div>
        </div>
      )}
    </div>
  )
}
