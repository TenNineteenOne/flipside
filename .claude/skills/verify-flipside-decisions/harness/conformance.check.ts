// Does Decisions.tla still describe the code? Every row of the tables the
// model prints (Tables.tla) is compared with the real SQL functions, route
// handlers, read functions and client store. A failure here means the code
// and the model have drifted apart: read SKILL.md before changing either.
import { afterAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { createArtistFeedback } from "@/lib/client/artist-signals"
import { decide } from "@/lib/feed/decision"
import { loadTables, type Row } from "./tables"
import { closeSql, sql, statements } from "./supabase-pg"
import { APP, ARTIST, MODEL, USER, RETURN_TO_FEED_SOURCE, SAVE_SOURCE, pages, readState, requestName, returnToFeed, send, setState } from "./world"

const T = loadTables()
afterAll(closeSql)

/** A "none" feedback state can be no row or a soft-deleted row of either signal. */
const shapes = (row: Row) => (row[0] === "none" ? [undefined, "up", "down"] as const : [undefined] as const)
const key = (row: Row) => row.join(",")
const applyTable = new Map(T.APPLY.map(([from, req, to]) => [`${key(from)}|${req}`, to]))

/** DELETE /api/dismiss first stamps the row's lifetime. The model has no time or expiry, so this write is not a model step. */
const STAMP = /^update recommendation_cache set created_at = \$\d+, expires_at = \$\d+ where /

/** Statements that write one of the three decision tables. */
const writes = () =>
  statements.filter((s) => !STAMP.test(s) && /^select rpc_(record_feedback|delete_feedback|clear_dismiss)|^(insert into|update|delete from) (feedback|saves|recommendation_cache)\b/.test(s))

describe("server steps (Apply)", () => {
  const single = T.APPLY.filter(([, req]) => req !== "saveUpsert" && req !== "saveSeen")
  it("each request changes the rows as the model says, in one statement", async () => {
    for (const [from, req, to] of single)
      for (const shape of shapes(from)) {
        await setState(from, shape)
        const res = await send(req)
        expect(res.status, `${req} from ${key(from)}`).toBeLessThan(300)
        expect(await readState(), `${req} from ${key(from)} (soft-deleted row: ${shape ?? "none"})`).toEqual(to)
        expect(writes(), `${req} must stay one atomic step`).toHaveLength(1)
      }
  })

  it("DELETE /api/dismiss stamps a fresh lifetime (not modelled) before its one model step", async () => {
    await setState(["none", true, false, false])
    await sql("update recommendation_cache set created_at = now() - interval '10 days', expires_at = now() - interval '1 day' where user_id = $1", [USER])
    expect((await send("delDismiss")).status).toBe(204)
    expect(statements.map((s) => (STAMP.test(s) ? "stamp" : s.split("(")[0]))).toEqual(["stamp", "select rpc_clear_dismiss_v2"])
    // Outlives the nightly cron (unseen rows older than 3 days expire) and the Feed read (expires_at in the future).
    expect(await sql("select 1 from recommendation_cache where user_id = $1 and created_at > now() - interval '3 days' and expires_at > now() + interval '29 days'", [USER])).toHaveLength(1)
    expect((await pages()).inQueue).toBe(true)
  })

  it("POST /api/saves is two statements: the saves upsert, then the seen_at stamp", async () => {
    for (const [from, req] of T.APPLY.filter(([, r]) => r === "saveUpsert")) {
      const mid = applyTable.get(`${key(from)}|${req}`)!
      const to = applyTable.get(`${key(mid)}|saveSeen`)!
      await setState(from)
      expect((await send("save")).status).toBe(200)
      expect(await readState(), `save from ${key(from)}`).toEqual(to)
      expect(writes().map((s) => s.split(" ").slice(0, 3).join(" "))).toEqual(["insert into saves", "update recommendation_cache set"])
    }
  })
})

describe("what the pages read (InQueue, InHistory, ServerSignal)", () => {
  it("Feed queue, History list and History's signal match the model in every state", async () => {
    for (const [row, inQueue, inHistory, signal] of T.READ)
      for (const shape of shapes(row)) {
        await setState(row, shape)
        const p = await pages()
        expect(p.inQueue, `InQueue ${key(row)}`).toBe(inQueue)
        expect(p.inHistory, `InHistory ${key(row)}`).toBe(inHistory)
        if (inHistory) {
          expect(MODEL[p.historySignal!], `ServerSignal ${key(row)}`).toBe(signal)
          expect(p.bookmarked).toBe(row[3])
        }
      }
  })
})

/**
 * A feedback client showing `cur`, and the requests it sent since; requests after the first `failFrom` fail.
 * `kept`: the card was saved before the verdict (the model's `kept`; the store's seenBefore).
 */
async function clientShowing(cur: string, failFrom = Infinity, kept = false) {
  const sent: string[] = []
  let ready = false
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    sent.push(requestName(String(url), init))
    return ready && sent.length > failFrom ? new Response(null, { status: 500 }) : new Response(null, { status: 200 })
  }) as typeof fetch
  const fb = createArtistFeedback({ fetchImpl, toast: { error: () => {} } })
  if (kept) fb.markSeen(ARTIST)
  if (cur !== "U") await fb.setSignal(ARTIST, APP[cur as "up"])
  sent.length = 0
  ready = true
  return { fb, sent }
}
const shown = (fb: { store: { get(k: string): string | undefined } }) => { const s = fb.store.get(ARTIST); return s === undefined ? "U" : MODEL[s] }

describe("client taps (JudgeSteps, RestoreSteps, RtfFirst)", () => {
  it("a verdict tap sends what the model says and keeps the Undo the model keeps", async () => {
    for (const [cur, sig, steps, target] of T.JUDGE) {
      const { fb, sent } = await clientShowing(cur)
      await fb.setSignal(ARTIST, APP[sig as "up"])
      expect(sent, `tap ${sig} on ${cur}`).toEqual(steps)
      expect(shown(fb)).toBe(target)
      // lib/feed/decision.ts: every tap sends; only the un-like has no Undo, and Undo goes back to `cur`.
      const plan = decide(
        { ids: [ARTIST], signals: new Map(cur === "U" ? [] : [[ARTIST, APP[cur as "up"]]]), selectedId: ARTIST, playingArtistId: null },
        { artistId: ARTIST, name: "Test Artist", signal: APP[sig as "up"], toggle: true, advance: true },
      )
      expect(plan.send).toEqual({ kind: "set", signal: APP[sig as "up"] })
      const unlike = cur === "up" && sig === "up"
      expect(plan.undo).toEqual(unlike ? null : { artistId: ARTIST, restore: cur === "U" ? undefined : APP[cur as "up"] })
    }
  })

  it("Undo sends what the model says; only the second request of a two-request undo may fail quietly", async () => {
    for (const [cur, prev, kept, steps, soft] of T.RESTORE) {
      const { fb, sent } = await clientShowing(cur, Infinity, kept)
      expect(await fb.restore(ARTIST, prev === "U" ? undefined : APP[prev as "up"])).toBe(true)
      expect(sent, `undo from ${cur} to ${prev}, kept ${kept}`).toEqual(steps)
      expect(shown(fb)).toBe(prev)
      if (steps.length === 0) continue
      const last = await clientShowing(cur, steps.length - 1, kept)
      expect(await last.fb.restore(ARTIST, prev === "U" ? undefined : APP[prev as "up"]), `last request fails, ${cur} to ${prev}, kept ${kept}`).toBe(soft)
    }
  })

  // The model's `kept` (Step, SaveStep): set by an answered un-like and an answered save, cleared by an answered dismiss-clear.
  it("the store keeps `kept` as the model does", async () => {
    const undoOfLike = async (fb: Awaited<ReturnType<typeof clientShowing>>["fb"], sent: string[]) => {
      await fb.setSignal(ARTIST, "thumbs_up")
      sent.length = 0
      await fb.restore(ARTIST, undefined)
      return [...sent]
    }
    const unliked = await clientShowing("up")
    await unliked.fb.setSignal(ARTIST, "thumbs_up") // un-like
    expect(await undoOfLike(unliked.fb, unliked.sent), "after an un-like").toEqual(["delFeedback"])

    const failedUnlike = await clientShowing("up", 0)
    expect(await failedUnlike.fb.setSignal(ARTIST, "thumbs_up")).toBe(false)
    const again = await clientShowing("up")
    expect(await again.fb.restore(ARTIST, undefined)).toBe(true)
    expect(again.sent, "a failed un-like marks nothing (fresh client for comparison)").toEqual(["delFeedback", "delDismiss"])

    const cleared = await clientShowing("skip", Infinity, true)
    await cleared.fb.restore(ARTIST, undefined) // delDismiss
    expect(await undoOfLike(cleared.fb, cleared.sent), "after a dismiss-clear").toEqual(["delFeedback", "delDismiss"])

    const source = fs.readFileSync(path.join(process.env.FLIPSIDE_REPO!, "lib/hooks/use-feed-triage.ts"), "utf8")
    expect(source, "the Feed's save changed: update world.ts feedSave and the model's SaveStep (kept)").toContain(SAVE_SOURCE)
  })

  it("Return to feed starts with the request the model says", async () => {
    const source = fs.readFileSync(path.join(process.env.FLIPSIDE_REPO!, "components/history/history-client.tsx"), "utf8")
    expect(source, "handleUndo changed: update world.ts returnToFeed and the model's TapReturnToFeed").toContain(RETURN_TO_FEED_SOURCE)
    for (const [label, first] of T.RTF) {
      const { fb, sent } = await clientShowing("U")
      expect(await returnToFeed(fb, APP[label as "up"])).toBe(true)
      expect(sent[0], `return to feed on a ${label} row`).toBe(first)
      expect(sent.at(-1)).toBe("delDismiss")
    }
  })
})
