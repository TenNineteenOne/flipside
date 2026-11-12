import { describe, it, expect, vi } from "vitest"
import { dbError } from "./errors"

describe("dbError", () => {
  vi.spyOn(console, "error").mockImplementation(() => {})

  it("maps an artist foreign-key violation (23503) to 404 Artist not found", async () => {
    const res = dbError({
      code: "23503",
      message: 'insert or update on table "saves" violates foreign key constraint "saves_artist_id_fkey"',
      details: 'Key (artist_id)=(00000000-0000-0000-0000-000000000000) is not present in table "artists".',
    }, "t")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Artist not found" })
  })

  it("keeps other FK violations and errors as a generic 500", async () => {
    expect(dbError({ code: "23503", message: 'violates foreign key constraint "saves_user_id_fkey"' }, "t").status).toBe(500)
    expect(dbError({ message: "boom" }, "t").status).toBe(500)
  })
})
