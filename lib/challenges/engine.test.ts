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
  it("is stable within a week, never repeats consecutively, and cycles the whole rotating set", () => {
    const week = weekOf(0)
    expect(pickWeeklyTemplate(ctx, week)).toBe(pickWeeklyTemplate(ctx, week))
    const picks = Array.from({ length: 30 }, (_, i) => pickWeeklyTemplate(ctx, weekOf(i)).key)
    picks.slice(1).forEach((k, i) => expect(k).not.toBe(picks[i]))
    const keys = new Set(picks)
    expect(keys.size).toBeGreaterThanOrEqual(10)
    for (const k of keys) {
      // credited by the RPC's prefix match, and never a rail-specific template
      expect(/^(thumbs_up|save)_/.test(k)).toBe(true)
      expect(["thumbs_up_new_anchor", "thumbs_up_wildcards", "thumbs_up_adjacent", "thumbs_up_wildcard_seed"]).not.toContain(k)
    }
    expect(keys.has("thumbs_up_any") && keys.has("thumbs_up_deep")).toBe(true)
    expect([...keys].some((k) => k.startsWith("save_"))).toBe(true)
  })

  it("template keys are unique", () => {
    const all = CHALLENGE_TEMPLATES.map((t) => t.key)
    expect(new Set(all).size).toBe(all.length)
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
