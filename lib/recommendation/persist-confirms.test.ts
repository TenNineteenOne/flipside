import { describe, it, expect } from "vitest"
import { createConfirmCollector } from "./persist-confirms"
import type { ConfirmOutcome } from "./confirm-previews"
import type { Track } from "@/lib/music-provider/types"

const UUID_A = "aaaaaaaa-0000-4000-8000-000000000001"
const UUID_B = "bbbbbbbb-0000-4000-8000-000000000002"

function track(id: string): Track {
  return {
    id,
    spotifyTrackId: null,
    name: `Track ${id}`,
    previewUrl: `https://audio.example.com/${id}.m4a`,
    durationMs: 30000,
    albumName: "Album",
    albumImageUrl: null,
    source: "itunes",
  }
}

function positive(artistId: string): ConfirmOutcome {
  return { artistId, tracks: [track("t1")], definitiveEmpty: false, source: "itunes" }
}
function negative(artistId: string): ConfirmOutcome {
  return { artistId, tracks: [], definitiveEmpty: true, source: "itunes" }
}

/** Minimal Supabase stub recording upsert calls. `fail` mode surfaces an error. */
function fakeClient(mode: "ok" | "error" | "throw" = "ok") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upserts: Array<{ rows: any[]; opts: any }> = []
  const client = {
    from() {
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async upsert(rows: any[], opts: any) {
          if (mode === "throw") throw new Error("connection reset")
          upserts.push({ rows, opts })
          return { error: mode === "error" ? { message: "upsert boom" } : null }
        },
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, upserts }
}

describe("createConfirmCollector", () => {
  it("no-op when nothing collected (no upsert call)", async () => {
    const { client, upserts } = fakeClient()
    await createConfirmCollector().flush(client)
    expect(upserts).toHaveLength(0)
  })

  it("collects a positive as source=itunes with tracks + fetched_at", async () => {
    const { client, upserts } = fakeClient()
    const c = createConfirmCollector()
    c.onConfirmOutcome(positive(UUID_A))
    await c.flush(client)
    expect(upserts).toHaveLength(1)
    expect(upserts[0].opts).toEqual({ onConflict: "artist_id" })
    const row = upserts[0].rows[0]
    expect(row).toMatchObject({ artist_id: UUID_A, source: "itunes" })
    expect(row.tracks).toHaveLength(1)
    expect(typeof row.fetched_at).toBe("string")
  })

  it("collects a negative as source=none with empty tracks", async () => {
    const { client, upserts } = fakeClient()
    const c = createConfirmCollector()
    c.onConfirmOutcome(negative(UUID_A))
    await c.flush(client)
    const row = upserts[0].rows[0]
    expect(row).toMatchObject({ artist_id: UUID_A, source: "none" })
    expect(row.tracks).toEqual([])
  })

  it("skips non-uuid artistIds", async () => {
    const { client, upserts } = fakeClient()
    const c = createConfirmCollector()
    c.onConfirmOutcome(positive("not-a-uuid"))
    c.onConfirmOutcome(positive(UUID_A))
    await c.flush(client)
    expect(upserts[0].rows.map((r: { artist_id: string }) => r.artist_id)).toEqual([UUID_A])
  })

  it("dedupes by artistId — last write wins", async () => {
    const { client, upserts } = fakeClient()
    const c = createConfirmCollector()
    c.onConfirmOutcome(positive(UUID_A)) // first: positive
    c.onConfirmOutcome(negative(UUID_A)) // last: negative → wins
    c.onConfirmOutcome(positive(UUID_B))
    await c.flush(client)
    const rows: Array<{ artist_id: string; source: string }> = upserts[0].rows
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.artist_id === UUID_A)?.source).toBe("none")
    expect(rows.find((r) => r.artist_id === UUID_B)?.source).toBe("itunes")
  })

  it("swallows an upsert error (never throws)", async () => {
    const { client } = fakeClient("error")
    const c = createConfirmCollector()
    c.onConfirmOutcome(positive(UUID_A))
    await expect(c.flush(client)).resolves.toBeUndefined()
  })

  it("swallows a thrown upsert (never throws)", async () => {
    const { client } = fakeClient("throw")
    const c = createConfirmCollector()
    c.onConfirmOutcome(positive(UUID_A))
    await expect(c.flush(client)).resolves.toBeUndefined()
  })
})
