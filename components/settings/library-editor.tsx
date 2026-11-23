"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { GenreNode } from "@/lib/types"
import { GenrePicker, ALL_GENRES } from "@/components/onboarding/genre-picker"
import { ArtistSearch, type SpotifyArtist } from "@/components/onboarding/artist-search"
import { normalizeGenre } from "@/lib/genre/normalize"
import { MAX_SELECTED_GENRES, patchSettings } from "@/lib/settings/patch-settings"
import { createKeyedSerializer } from "@/lib/keyed-serializer"

const GENRE_CAP = MAX_SELECTED_GENRES
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

/**
 * Writer for the genre selection (users.selected_genres). Each save carries the whole list, so a newer
 * save aborts the one in flight. A failed save rolls the picker back to the last list the server
 * confirmed, unless a newer change is waiting (`supersede()`) or in flight: that one re-sends the
 * whole list, failed pick included, and its own outcome decides.
 */
export function createGenreWriter(
  initial: GenreNode[],
  rollback: (saved: GenreNode[]) => void,
): ((next: GenreNode[]) => Promise<void>) & { supersede: () => void; abort: () => void } {
  let saved = initial
  let latest = 0
  let aborter: AbortController | null = null
  const write = async (next: GenreNode[]) => {
    const id = ++latest
    aborter?.abort()
    const mine = (aborter = new AbortController())
    try {
      await patchSettings({ selectedGenres: next.map((g) => g.lastfmTag) }, { signal: mine.signal })
      saved = next
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return
      if (id === latest) rollback(saved)
      toast.error("Couldn't save genres")
    }
  }
  return Object.assign(write, { supersede: () => { latest++ }, abort: () => aborter?.abort() })
}

export interface LibraryEditorProps {
  initialGenreTags: string[]
  initialSeedArtists: SpotifyArtist[]
}

export function LibraryEditor({ initialGenreTags, initialSeedArtists }: LibraryEditorProps) {
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
  const [writeGenres] = useState(() => createGenreWriter(initialGenreNodes, setGenres))
  const [inTapOrder] = useState(createKeyedSerializer)
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
        await patchSettings({ selectedGenres: valid }, { signal: aborter.signal })
        toast.info(
          `Cleaned up ${orphanCount} old genre tag${orphanCount === 1 ? "" : "s"} from the updated taxonomy.`,
        )
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") return
        // Fall back to the old "heads up" toast if the auto-prune didn't land.
        toast.info(
          `${orphanCount} old genre tag${orphanCount === 1 ? "" : "s"} will be removed on your next save.`,
        )
      }
    })()
    return () => aborter.abort()
  }, [orphanCount, initialGenreNodes])

  // Leaving Settings inside the debounce window sends the pending save now (keepalive, so the
  // navigation doesn't cancel it) instead of dropping it. A save already in flight is left to land.
  const pendingGenres = useRef<GenreNode[] | null>(null)
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const next = pendingGenres.current
      if (!next) return
      pendingGenres.current = null
      writeGenres.abort()
      void patchSettings(
        { selectedGenres: next.map((g) => g.lastfmTag) },
        { fetchImpl: (url, init) => fetch(url, { ...init, keepalive: true }) },
      ).catch(() => toast.error("Couldn't save genres"))
    }
  }, [writeGenres])

  function scheduleGenreSave(next: GenreNode[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    pendingGenres.current = next
    writeGenres.supersede()
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      pendingGenres.current = null
      void writeGenres(next)
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
    // Functional: `artists` here can be stale (a remove may have landed since this render).
    setArtists((cur) => (cur.some((a) => a.id === artist.id) || cur.length >= ARTIST_CAP ? cur : [...cur, artist]))
    try {
      // Per artist, in tap order: a quick add-then-remove must not let the DELETE reach the server first.
      const res = await inTapOrder(artist.id, () => fetch("/api/settings/seed-artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artists: [{ id: artist.id, name: artist.name, imageUrl: artist.imageUrl }],
        }),
      }))
      if (!res.ok) throw new Error("add failed")
    } catch {
      setArtists((prev) => prev.filter((a) => a.id !== artist.id))
      toast.error("Couldn't add artist")
    }
  }

  async function removeArtist(id: string) {
    const removed = artists.find((a) => a.id === id)
    if (!removed) return
    setArtists((cur) => cur.filter((a) => a.id !== id))
    try {
      const res = await inTapOrder(id, () => fetch(`/api/settings/seed-artists?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }))
      if (!res.ok) throw new Error("remove failed")
    } catch {
      // Put back only this artist: a snapshot of the whole list would drop adds made meanwhile.
      setArtists((cur) => (cur.some((a) => a.id === id) ? cur : [...cur, removed]))
      toast.error("Couldn't remove artist")
    }
  }

  return (
    <>
      <Collapsible
        title="Artists"
        count={artists.length}
        open={artistsOpen}
        onToggle={() => setArtistsOpen((v) => !v)}
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
        count={genres.length}
        open={genresOpen}
        onToggle={() => setGenresOpen((v) => !v)}
      >
        <GenrePicker selected={genres} onToggle={toggleGenre} cap={GENRE_CAP} />
      </Collapsible>
    </>
  )
}

function Collapsible({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ padding: 0, overflow: "hidden", background: "transparent", border: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "6px 0",
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
        </div>
        <div style={{ color: "var(--text-faint)", flexShrink: 0 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && <div style={{ paddingTop: 10 }}>{children}</div>}
    </div>
  )
}
