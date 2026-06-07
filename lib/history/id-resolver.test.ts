import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Mock the music provider singleton ────────────────────────────────────────
// resolveUnresolvedArtistIds imports `musicProvider` from the provider module;
// mock searchArtists so we can drive the live-search branch deterministically.
const searchArtists = vi.fn()
vi.mock("@/lib/music-provider/provider", () => ({
  musicProvider: {
    searchArtists: (...args: unknown[]) => searchArtists(...args),
  },
}))

import { resolveUnresolvedArtistIds } from "./id-resolver"

// ── In-memory listened_artists + artists fake ────────────────────────────────

interface ListenedRow {
  id: string
  user_id: string
  artist_id: string | null
  spotify_artist_id: string | null
  lastfm_artist_name: string | null
  play_count: number
  last_seen_at: string
  id_resolution_attempted_at: string | null
}

interface ArtistRow {
  id: string
  spotify_id: string | null
  name: string
  name_lower: string
  genres?: string[]
  popularity?: number | null
  image_url?: string | null
}

/**
 * A small chainable Supabase fake covering exactly the query shapes the
 * id-resolver uses against `listened_artists` and `artists`.
 */
function makeSupabase(listened: ListenedRow[], artists: ArtistRow[]) {
  let artistSeq = 0

  // ── artists table ──
  function artistsTable() {
    return {
      // ensureArtists upsert(rows, {onConflict, ignoreDuplicates})
      async upsert(rows: ArtistRow[]) {
        for (const r of rows) {
          const existing = artists.find((x) => x.spotify_id === r.spotify_id)
          if (existing) continue // ignoreDuplicates
          artists.push({ ...r, id: `artist-uuid-${++artistSeq}` })
        }
        return { error: null }
      },
      select(_cols: string) {
        return {
          // ensureArtists read-back: .in("spotify_id", chunk)
          // resolver table-hit read: .in("name_lower", nameLowers)
          async in(column: string, values: string[]) {
            const data = artists
              .filter((x) => values.includes((x as unknown as Record<string, unknown>)[column] as string))
              .map((x) => ({
                id: x.id,
                spotify_id: x.spotify_id,
                name: x.name,
                name_lower: x.name_lower,
              }))
            return { data, error: null }
          },
        }
      },
    }
  }

  // ── listened_artists table ──
  function listenedTable() {
    return {
      select(cols: string) {
        const builder = {
          _userId: undefined as string | undefined,
          _eqId: undefined as string | undefined,
          _eqArtistId: undefined as string | undefined,
          eq(col: string, val: string) {
            if (col === "user_id") this._userId = val
            if (col === "id") this._eqId = val
            if (col === "artist_id") this._eqArtistId = val
            return this
          },
          is() {
            return this
          },
          not() {
            return this
          },
          or() {
            // terminal for the unresolved fetch
            const data = listened.filter(
              (r) =>
                r.user_id === this._userId &&
                r.artist_id === null &&
                r.lastfm_artist_name !== null &&
                r.spotify_artist_id === null
            )
            return Promise.resolve({
              data: data.map((r) => ({ id: r.id, lastfm_artist_name: r.lastfm_artist_name })),
              error: null,
            })
          },
          async maybeSingle() {
            const found = listened.find(
              (r) =>
                (this._eqId === undefined || r.id === this._eqId) &&
                (this._userId === undefined || r.user_id === this._userId) &&
                (this._eqArtistId === undefined || r.artist_id === this._eqArtistId)
            )
            if (!found) return { data: null, error: null }
            if (cols.includes("last_seen_at")) {
              return { data: { id: found.id, play_count: found.play_count, last_seen_at: found.last_seen_at }, error: null }
            }
            return { data: found, error: null }
          },
        }
        return builder
      },
      update(patch: Partial<ListenedRow>) {
        return {
          eq(_col: string, id: string) {
            const target = listened.find((r) => r.id === id)
            if (!target) return Promise.resolve({ error: null })
            // Simulate the (user_id, artist_id) partial-unique constraint.
            if (patch.artist_id != null) {
              const clash = listened.find(
                (r) => r.id !== id && r.user_id === target.user_id && r.artist_id === patch.artist_id
              )
              if (clash) return Promise.resolve({ error: { code: "23505", message: "duplicate" } })
            }
            Object.assign(target, patch)
            return Promise.resolve({ error: null })
          },
        }
      },
      delete() {
        return {
          eq(_col: string, id: string) {
            const idx = listened.findIndex((r) => r.id === id)
            if (idx >= 0) listened.splice(idx, 1)
            return Promise.resolve({ error: null })
          },
        }
      },
    }
  }

  const client = {
    from(table: string) {
      if (table === "artists") return artistsTable()
      if (table === "listened_artists") return listenedTable()
      throw new Error(`unexpected table ${table}`)
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any
}

const baseRow = (over: Partial<ListenedRow>): ListenedRow => ({
  id: "row-1",
  user_id: "user-1",
  artist_id: null,
  spotify_artist_id: null,
  lastfm_artist_name: "Radiohead",
  play_count: 3,
  last_seen_at: "2026-01-01T00:00:00.000Z",
  id_resolution_attempted_at: null,
  ...over,
})

beforeEach(() => {
  searchArtists.mockReset()
})

describe("resolveUnresolvedArtistIds — tight unresolved filter", () => {
  it("skips rows that already carry a legacy spotify_artist_id", async () => {
    const listened = [baseRow({ spotify_artist_id: "sp-legacy" })]
    const supabase = makeSupabase(listened, [])
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    expect(searchArtists).not.toHaveBeenCalled()
    expect(listened[0].artist_id).toBeNull()
  })

  it("skips rows that already have an artist_id", async () => {
    const listened = [baseRow({ artist_id: "artist-uuid-existing" })]
    const supabase = makeSupabase(listened, [])
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    expect(searchArtists).not.toHaveBeenCalled()
  })
})

describe("resolveUnresolvedArtistIds — artists table hit", () => {
  it("uses the uuid directly when exactly one artists row matches the name", async () => {
    const listened = [baseRow({})]
    const artists: ArtistRow[] = [
      { id: "artist-uuid-7", spotify_id: "sp-7", name: "Radiohead", name_lower: "radiohead" },
    ]
    const supabase = makeSupabase(listened, artists)
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    expect(searchArtists).not.toHaveBeenCalled()
    expect(listened[0].artist_id).toBe("artist-uuid-7")
    expect(listened[0].id_resolution_attempted_at).not.toBeNull()
  })

  it("Option B: ambiguous name (>1 row) skips the hit and falls through to live search", async () => {
    const listened = [baseRow({})]
    const artists: ArtistRow[] = [
      { id: "artist-uuid-a", spotify_id: "sp-a", name: "Radiohead", name_lower: "radiohead" },
      { id: "artist-uuid-b", spotify_id: "sp-b", name: "Radiohead", name_lower: "radiohead" },
    ]
    searchArtists.mockResolvedValue([
      { id: "sp-live", name: "Radiohead", genres: [], popularity: 80, imageUrl: null },
    ])
    const supabase = makeSupabase(listened, artists)
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    expect(searchArtists).toHaveBeenCalledOnce()
    // minted a fresh artists row for sp-live and wrote its uuid
    expect(listened[0].artist_id).toBe("artist-uuid-1")
  })
})

describe("resolveUnresolvedArtistIds — live search + mint", () => {
  it("mints a uuid via ensureArtist on a high-similarity match and writes artist_id", async () => {
    const listened = [baseRow({})]
    searchArtists.mockResolvedValue([
      { id: "sp-live", name: "Radiohead", genres: ["rock"], popularity: 90, imageUrl: "http://img" },
    ])
    const artists: ArtistRow[] = []
    const supabase = makeSupabase(listened, artists)
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    expect(listened[0].artist_id).toBe("artist-uuid-1")
    expect(artists).toHaveLength(1)
    expect(artists[0].spotify_id).toBe("sp-live")
  })

  it("leaves artist_id null + only bumps timestamp on low similarity (no match)", async () => {
    const listened = [baseRow({ lastfm_artist_name: "Radiohead" })]
    searchArtists.mockResolvedValue([
      { id: "sp-other", name: "Completely Different", genres: [], popularity: 10, imageUrl: null },
    ])
    const supabase = makeSupabase(listened, [])
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    expect(listened[0].artist_id).toBeNull()
    expect(listened[0].id_resolution_attempted_at).not.toBeNull()
    expect(listened[0].spotify_artist_id).toBeNull()
  })

  it("rate-limited search only bumps timestamp, leaves artist_id null", async () => {
    const listened = [baseRow({})]
    searchArtists.mockResolvedValue({ rateLimited: true, retryAfterSec: 30 })
    const supabase = makeSupabase(listened, [])
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    expect(listened[0].artist_id).toBeNull()
    expect(listened[0].id_resolution_attempted_at).not.toBeNull()
  })
})

describe("resolveUnresolvedArtistIds — 23505 merge path on artist_id", () => {
  it("merges play_count into the existing row and deletes the orphan", async () => {
    const orphan = baseRow({ id: "orphan", play_count: 4, lastfm_artist_name: "Radiohead" })
    const target = baseRow({
      id: "target",
      artist_id: "artist-uuid-9",
      lastfm_artist_name: null,
      play_count: 10,
      last_seen_at: "2026-02-01T00:00:00.000Z",
    })
    const listened = [orphan, target]
    const artists: ArtistRow[] = [
      { id: "artist-uuid-9", spotify_id: "sp-9", name: "Radiohead", name_lower: "radiohead" },
    ]
    const supabase = makeSupabase(listened, artists)
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })

    // orphan deleted, target merged
    expect(listened.find((r) => r.id === "orphan")).toBeUndefined()
    const merged = listened.find((r) => r.id === "target")!
    expect(merged.play_count).toBe(14)
    expect(merged.last_seen_at).toBe("2026-02-01T00:00:00.000Z")
  })

  it("merge-miss safeguard: 23505 with no findable target leaves the orphan in place", async () => {
    // The update reports 23505 but the target row can't be located by artist_id
    // (gap edge). Build a fake where update always 23505s but the target lookup
    // returns nothing.
    const orphan = baseRow({ id: "orphan", lastfm_artist_name: "Radiohead" })
    const listened = [orphan]
    const artists: ArtistRow[] = [
      { id: "artist-uuid-5", spotify_id: "sp-5", name: "Radiohead", name_lower: "radiohead" },
    ]
    const supabase = makeSupabase(listened, artists)
    // Patch update to always return 23505 so the merge branch runs, but no
    // target row exists with that artist_id → merge-miss.
    const origFrom = supabase.from.bind(supabase)
    supabase.from = (table: string) => {
      const t = origFrom(table)
      if (table === "listened_artists") {
        const origUpdate = t.update.bind(t)
        t.update = (patch: Partial<ListenedRow>) => {
          if (patch.artist_id != null) {
            return { eq: () => Promise.resolve({ error: { code: "23505", message: "dup" } }) }
          }
          return origUpdate(patch)
        }
      }
      return t
    }
    await resolveUnresolvedArtistIds({ supabase, userId: "user-1", accessToken: "tok" })
    // orphan still present (not deleted), artist_id still null
    const still = listened.find((r) => r.id === "orphan")!
    expect(still).toBeDefined()
    expect(still.artist_id).toBeNull()
  })
})
