import { describe, it, expect, vi } from "vitest"
import { claimCooldown } from "./cooldown"

type Row = Record<string, string | null>

/**
 * Focused fake for the single conditional UPDATE claimCooldown issues:
 * .from("users").update(patch).eq("id", v).or("c.is.null,c.lte.<iso>").select("id")
 * Parses the `or` filter the way PostgREST would for these two operators.
 */
function fakeUsers(rows: Row[], error: { message: string } | null = null) {
  const calls: string[] = []
  const client = {
    from: () => {
      let patch: Row = {}
      let id = ""
      let orExpr = ""
      const q = {
        update(p: Row) { patch = p; return q },
        eq(...args: string[]) { id = args[1]; return q },
        or(expr: string) { orExpr = expr; calls.push(expr); return q },
        select() {
          if (error) return Promise.resolve({ data: null, error })
          const conds = orExpr.split(",").map((c) => {
            const [col, op, ...rest] = c.split(".")
            const val = rest.join(".").replace(/^"(.*)"$/, "$1") // PostgREST strips value quotes
            return (r: Row) =>
              op === "is" ? r[col] == null : r[col] != null && Date.parse(r[col]!) <= Date.parse(val)
          })
          const hit = rows.filter((r) => r.id === id && conds.some((f) => f(r)))
          for (const r of hit) Object.assign(r, patch)
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
        },
      }
      return q
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls }
}

const NOW = Date.parse("2026-10-24T12:00:00.000Z")
const iso = (ms: number) => new Date(ms).toISOString()

describe("claimCooldown", () => {
  it("claims when the column is NULL and stamps now", async () => {
    const rows: Row[] = [{ id: "u1", last_generated_at: null }]
    const { client } = fakeUsers(rows)
    expect(await claimCooldown(client, "u1", "last_generated_at", 30_000, NOW)).toBe("claimed")
    expect(rows[0].last_generated_at).toBe(iso(NOW))
  })

  it("is cooling inside the window and leaves the stamp alone", async () => {
    const rows: Row[] = [{ id: "u1", last_generated_at: iso(NOW - 10_000) }]
    const { client } = fakeUsers(rows)
    expect(await claimCooldown(client, "u1", "last_generated_at", 30_000, NOW)).toBe("cooling")
    expect(rows[0].last_generated_at).toBe(iso(NOW - 10_000))
  })

  it("claims exactly at the window boundary (elapsed === window)", async () => {
    const rows: Row[] = [{ id: "u1", last_explore_generated_at: iso(NOW - 90_000) }]
    const { client } = fakeUsers(rows)
    expect(await claimCooldown(client, "u1", "last_explore_generated_at", 90_000, NOW)).toBe("claimed")
  })

  it("a second immediate claim is cooling (no double pass)", async () => {
    const rows: Row[] = [{ id: "u1", last_explore_generated_at: null }]
    const { client } = fakeUsers(rows)
    const a = claimCooldown(client, "u1", "last_explore_generated_at", 90_000, NOW)
    const b = claimCooldown(client, "u1", "last_explore_generated_at", 90_000, NOW + 1)
    expect([await a, await b]).toEqual(["claimed", "cooling"])
  })

  it("only touches the given user", async () => {
    const rows: Row[] = [{ id: "u2", last_generated_at: null }]
    const { client } = fakeUsers(rows)
    expect(await claimCooldown(client, "u1", "last_generated_at", 30_000, NOW)).toBe("cooling")
    expect(rows[0].last_generated_at).toBeNull()
  })

  it("fails open on a DB error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = fakeUsers([], { message: "boom" })
    expect(await claimCooldown(client, "u1", "last_generated_at", 30_000, NOW)).toBe("claimed")
    spy.mockRestore()
  })

  it("builds the PostgREST or-filter from the column and cutoff", async () => {
    const { client, calls } = fakeUsers([{ id: "u1", last_generated_at: null }])
    await claimCooldown(client, "u1", "last_generated_at", 30_000, NOW)
    expect(calls).toEqual([`last_generated_at.is.null,last_generated_at.lte."${iso(NOW - 30_000)}"`])
  })
})
