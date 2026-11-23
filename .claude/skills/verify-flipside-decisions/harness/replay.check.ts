// The model's findings, replayed against the real code: the real client
// store, the real route handlers, the real SQL functions, and the functions the
// Feed and History pages read with. One call per model step.
//
// Each finding's test asserts that the bug HAPPENS. When a fix lands, its test fails:
// that is the signal to re-run the model, update expected.txt and this file
// (see SKILL.md, "When a result changes"). Tests named "fixed" are the inverse: a
// finding that was fixed (F1) must stay fixed.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { decide, type Plan } from "@/lib/feed/decision"
import { closeSql } from "./supabase-pg"
import { ARTIST, feedSave, historyShows, openTab, pages, readState, returnToFeed, setState } from "./world"

afterAll(closeSql)
// The artist starts as a fresh recommendation: in the Feed queue, nothing decided.
beforeEach(() => setState(["none", false, false, false]))

type Tab = ReturnType<typeof openTab>

/**
 * The card's buttons and the toast's Undo, as lib/hooks/use-feed-triage.ts
 * wires them (judge: decide() then setSignal; undoLast: restore). The hook
 * needs React, so its two calls are repeated here around the real decide().
 */
function feedCard(tab: Tab) {
  let undo: Plan["undo"] = null
  return {
    tap(signal: "thumbs_up" | "thumbs_down" | "skip") {
      const plan = decide(
        { ids: [ARTIST], signals: tab.feedback.store.snapshot(), selectedId: ARTIST, playingArtistId: null },
        { artistId: ARTIST, name: "Test Artist", signal, toggle: true, advance: true },
      )
      undo = plan.undo
      if (plan.send.kind === "set") void tab.feedback.setSignal(ARTIST, plan.send.signal)
    },
    undo() {
      if (!undo) throw new Error("no Undo is on offer")
      const u = undo
      undo = null
      void tab.feedback.restore(u.artistId, u.restore)
    },
  }
}

describe("single tab, every request succeeds", () => {
  it.each(["thumbs_up", "thumbs_down"] as const)("fixed (F1) UndoOfVerdictRestores: %s, then Undo, puts the rows back and the card in the queue", async (signal) => {
    const tab = openTab(), card = feedCard(tab)
    const before = await readState()
    card.tap(signal)
    card.undo()
    expect(await tab.server()).toBe(signal === "thumbs_up" ? "postUp" : "postDown")
    expect(await tab.server()).toBe("delFeedback")
    expect(await tab.server()).toBe("delDismiss")
    expect(tab.shows()).toBe("U")
    expect(await readState()).toEqual(before)
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false, excluded: null })
  })

  it("fixed (F1): Like over an earlier Pass, then Undo, puts the Pass back and leaves seen set", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_down")
    expect(await tab.server()).toBe("postDown")
    const before = await readState()
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("postDown")
    expect(await tab.waiting()).toBe(0)
    expect(await readState()).toEqual(before)
    expect(await pages()).toMatchObject({ inQueue: false, inHistory: true, historySignal: "thumbs_down" })
  })

  it("fixed (F1): Save, Like, then Undo: still saved, seen as the save left it", async () => {
    const tab = openTab(), card = feedCard(tab)
    feedSave(tab)
    expect(await tab.server()).toBe("save")
    const before = await readState()
    expect(before).toEqual(["none", true, false, true])
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(await tab.waiting()).toBe(0)
    expect(await readState()).toEqual(before)
    expect(await pages()).toMatchObject({ inHistory: true, bookmarked: true })
  })

  it("fixed (F1): a card loaded as saved but still queued: Like, then Undo, puts it back in the queue, still saved", async () => {
    await setState(["none", false, false, true])
    const tab = openTab(), card = feedCard(tab)
    const before = await readState()
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(await tab.server()).toBe("delDismiss")
    expect(await readState()).toEqual(before)
  })

  it("F2 is untouched by the F1 fix: un-like, Like, then Undo ends where the un-like left it (History, Skipped)", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_up")
    card.tap("thumbs_up")
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    const before = await readState()
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(await tab.waiting()).toBe(0)
    expect(await readState()).toEqual(before)
    expect(await pages()).toMatchObject({ inQueue: false, inHistory: true, historySignal: "skip" })
  })

  it("UndoRestores (F9): Save, Dismiss, then Undo: the saved artist's seen mark is gone, so it is back in the queue and out of History", async () => {
    const tab = openTab(), card = feedCard(tab)
    feedSave(tab)
    expect(await tab.server()).toBe("save")
    const before = await readState()
    card.tap("skip")
    card.undo()
    expect(await tab.server()).toBe("postSkip")
    expect(await tab.server()).toBe("delDismiss")
    expect(before).toEqual(["none", true, false, true])
    expect(await readState()).toEqual(["none", false, false, true])
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false })
  })

  it("UndoRestores (F9): un-like, Dismiss, then Undo: back in the queue, where it was not before the Dismiss", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_up")
    card.tap("thumbs_up")
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    const before = await readState()
    card.tap("skip")
    card.undo()
    expect(await tab.server()).toBe("postSkip")
    expect(await tab.server()).toBe("delDismiss")
    expect(before).toEqual(["none", true, false, false])
    expect(await readState()).toEqual(["none", false, false, false])
  })

  it("UndoRestores (F10): Like, Dismiss, Like, then Undo: the Like that was on record before the last tap is gone", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_up")
    card.tap("skip")
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("postSkip")
    const before = await readState()
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(tab.shows()).toBe("skip")
    expect(before).toEqual(["up", true, true, false])
    expect(await readState()).toEqual(["none", true, true, false])
  })

  it("UndoRestores holds for Dismiss, then Undo (the one undo that does go back)", async () => {
    const tab = openTab(), card = feedCard(tab)
    const before = await readState()
    card.tap("skip")
    card.undo()
    expect(await tab.server()).toBe("postSkip")
    expect(await tab.server()).toBe("delDismiss")
    expect(await readState()).toEqual(before)
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false })
  })

  it("ScreenUndecidedIsQueued: Like, then Like again (un-like): card shows undecided, a reload moves it to History as Skipped", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_up")
    card.tap("thumbs_up")
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(tab.shows()).toBe("U")
    expect(await pages()).toMatchObject({ inQueue: false, inHistory: true, historySignal: "skip" })
  })

  it("ScreenUndecidedIsQueued: Save, then Save again (unsave): the same", async () => {
    const tab = openTab()
    void tab.saves.toggleSave(ARTIST)
    void tab.saves.toggleSave(ARTIST)
    expect(await tab.server()).toBe("save")
    expect(await tab.server()).toBe("delSave")
    expect(tab.saves.store.get(ARTIST)).toBeUndefined()
    expect(await pages()).toMatchObject({ inQueue: false, inHistory: true, historySignal: "skip", bookmarked: false })
  })

  it("ScreenVerdictIsRecorded: Like, then Dismiss: card shows Dismissed, History lists it as Liked", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_up")
    card.tap("skip")
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("postSkip")
    expect(tab.shows()).toBe("skip")
    expect(await pages()).toMatchObject({ inHistory: true, historySignal: "thumbs_up", excluded: "liked" })
  })

  it("ReturnToFeedWorks, NoQueuedVerdict: in History, Return to feed then Change to Passed before it answers: back in the queue with a Pass on record", async () => {
    const feed = openTab()
    feedCard(feed).tap("thumbs_up")
    expect(await feed.server()).toBe("postUp")

    const history = openTab() // you open History
    const loaded = (await pages()).historySignal!
    expect(loaded).toBe("thumbs_up")
    const returned = returnToFeed(history.feedback, historyShows(history.feedback, loaded))
    expect(historyShows(history.feedback, loaded)).not.toBe("thumbs_down") // so "Change to Passed" is on offer
    void history.feedback.setSignal(ARTIST, "thumbs_down")
    expect(await history.server()).toBe("delFeedback")
    expect(await history.server()).toBe("postDown")
    expect(await history.server()).toBe("delDismiss")
    expect(await returned).toBe(true) // History drops the row: "returned to feed"
    expect(await readState()).toEqual(["down", false, false, false])
    // In the queue as an undecided card, while the engine holds it as "never show this artist".
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false, excluded: "thumbs_down" })
  })
})

describe("single tab, one answer lost", () => {
  it("fixed (F1), second request fails: Like, Undo, the seen-clear fails: card shows undecided, no verdict on record, out of the queue (as before the fix)", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(await tab.server("fail")).toBe("delDismiss")
    expect(tab.shows()).toBe("U")
    expect(await readState()).toEqual(["none", true, false, false])
    // The next Like and Undo on the card sends the clear again.
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(await tab.server()).toBe("delDismiss")
    expect(await readState()).toEqual(["none", false, false, false])
  })

  it("NoQueuedVerdict: Like, Dismiss, Undo, and the undo's answer is lost: card shows Dismissed, server has it queued with a Like", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_up")
    card.tap("skip")
    expect(await tab.server()).toBe("postUp")
    card.undo()
    expect(await tab.server()).toBe("postSkip")
    expect(await tab.server("lost")).toBe("delDismiss")
    expect(await tab.waiting()).toBe(0) // the follow-up Like is never sent
    expect(tab.shows()).toBe("skip")
    expect(await readState()).toEqual(["up", false, false, false])
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false, excluded: "liked" })
  })
})

describe("two tabs, every request succeeds", () => {
  it("NoQueuedVerdict: tab A likes; tab B (still showing the card) dismisses and undoes: queued with a Like on record", async () => {
    const a = openTab(), b = openTab(), cardB = feedCard(b)
    feedCard(a).tap("thumbs_up")
    expect(await a.server()).toBe("postUp")
    cardB.tap("skip")
    expect(await b.server()).toBe("postSkip")
    cardB.undo()
    expect(await b.server()).toBe("delDismiss")
    expect(await b.waiting()).toBe(0)
    expect(await readState()).toEqual(["up", false, false, false])
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false, excluded: "liked" })
  })

  it("NoQueuedVerdict (F11): tab A likes and undoes; tab B's Like lands between the undo's two requests: queued with a Like on record", async () => {
    const a = openTab(), b = openTab(), cardA = feedCard(a)
    cardA.tap("thumbs_up")
    expect(await a.server()).toBe("postUp")
    cardA.undo()
    expect(await a.server()).toBe("delFeedback")
    feedCard(b).tap("thumbs_up")
    expect(await b.server()).toBe("postUp")
    expect(await a.server()).toBe("delDismiss")
    expect(a.shows()).toBe("U")
    expect(b.shows()).toBe("up")
    expect(await readState()).toEqual(["up", false, false, false])
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false, excluded: "liked" })
  })

  it("ReturnToFeedWorks: History row loaded as Dismissed, a Like from tab A lands, Return to feed: queued with a Like on record", async () => {
    const a = openTab(), b = openTab()
    feedCard(a).tap("thumbs_up")
    feedCard(b).tap("skip")
    expect(await b.server()).toBe("postSkip")
    const history = openTab() // tab B opens History
    const loaded = (await pages()).historySignal!
    expect(loaded).toBe("dismissed")
    expect(await a.server()).toBe("postUp")
    const returned = returnToFeed(history.feedback, historyShows(history.feedback, loaded))
    expect(await history.server()).toBe("delDismiss")
    expect(await returned).toBe(true)
    expect(await readState()).toEqual(["up", false, false, false])
    expect(await pages()).toMatchObject({ inQueue: true, inHistory: false, excluded: "liked" })
  })
})
