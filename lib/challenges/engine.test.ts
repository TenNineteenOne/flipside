import { describe, it, expect } from "vitest"
import { createRouteFakeDb } from "@/lib/api/__fixtures__/route-fake-db"
import {
  CHALLENGE_TEMPLATES,
  ensureCurrentChallenge,
  getISOWeekStart,
  pickWeeklyTemplate,
  type ChallengeApplicabilityCtx,
} from "./engine"

const ctx: ChallengeApplicabilityCtx = { touchedAnchors: new Set(), totalAnchors: 10, selectedGenres: ["rock"], hasThumbsUp: true }
const weekOf = (i: number) => getISOWeekStart(new Date(Date.UTC(2026, 0, 5 + 7 * i)))

describe("pickWeeklyTemplate (#175 rotation)", () => {
  it("is stable within a week and rotates across weeks", () => {
    const week = weekOf(0)
    expect(pickWeeklyTemplate(ctx, week)).toBe(pickWeeklyTemplate(ctx, week))
    const keys = new Set(Array.from({ length: 12 }, (_, i) => pickWeeklyTemplate(ctx, weekOf(i)).key))
    // Only the any-thumb templates rotate until the RPC gets rail context.
    expect(keys).toEqual(new Set(["thumbs_up_any", "thumbs_up_deep"]))
  })

  it("only picks applicable templates", () => {
    const narrow: ChallengeApplicabilityCtx = { touchedAnchors: new Set(["a"]), totalAnchors: 1, selectedGenres: [], hasThumbsUp: false }
    const allowed = new Set(CHALLENGE_TEMPLATES.filter((t) => t.applicableFor(narrow)).map((t) => t.key))
    for (let i = 0; i < 20; i++) expect(allowed.has(pickWeeklyTemplate(narrow, weekOf(i)).key)).toBe(true)
  })
})

describe("ensureCurrentChallenge", () => {
  const now = new Date("2026-10-21T12:00:00Z")

  it("creates this week's row once and returns the same challenge on reload", async () => {
    const db = createRouteFakeDb({ users: [{ id: "u1", selected_genres: ["rock"] }], user_challenges: [] })
    const first = await ensureCurrentChallenge(db.client, "u1", now)
    const again = await ensureCurrentChallenge(db.client, "u1", now)
    expect(db.tables.user_challenges).toHaveLength(1)
    expect(db.tables.user_challenges[0]).toMatchObject({ user_id: "u1", week_start: "2026-10-19" })
    expect(again?.key).toBe(first?.key)
  })

  it("an existing row skips the ctx reads", async () => {
    const db = createRouteFakeDb({
      user_challenges: [{ id: "c1", user_id: "u1", week_start: "2026-10-19", challenge_key: "thumbs_up_deep", target_count: 7, progress: 2 }],
    })
    const c = await ensureCurrentChallenge(db.client, "u1", now)
    expect(c).toMatchObject({ key: "thumbs_up_deep", progress: 2 })
    expect(db.log.map((l) => l.table)).toEqual(["user_challenges"])
  })
})
