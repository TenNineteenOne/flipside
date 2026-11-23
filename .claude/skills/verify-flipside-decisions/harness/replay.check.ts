// The model's findings, replayed against the real code: the real client
// store, the real route handlers, the real SQL functions, and the functions the
// Feed and History pages read with. One call per model step.
//
// Each test asserts that the bug HAPPENS. When a fix lands, its test fails:
// that is the signal to re-run the model, update expected.txt and this file
// (see SKILL.md, "When a result changes").
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { decide, type Plan } from "@/lib/feed/decision"
import { closeSql } from "./supabase-pg"
import { ARTIST, historyShows, openTab, pages, readState, returnToFeed, setState } from "./world"

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
  it("UndoRestores: Like, then Undo, leaves the artist out of the queue and in History as Skipped", async () => {
    const tab = openTab(), card = feedCard(tab)
    const before = await readState()
    card.tap("thumbs_up")
    card.undo()
    expect(await tab.server()).toBe("postUp")
    expect(await tab.server()).toBe("delFeedback")
    expect(tab.shows()).toBe("U") // the card is back to undecided on screen
    expect(await readState()).not.toEqual(before)
    expect(await pages()).toMatchObject({ inQueue: false, inHistory: true, historySignal: "skip", excluded: "cooldown" })
  })

  it("UndoRestores: the same for Less like this, then Undo", async () => {
    const tab = openTab(), card = feedCard(tab)
    card.tap("thumbs_down")
    card.undo()
    expect(await tab.server()).toBe("postDown")
    expect(await tab.server()).toBe("delFeedback")
    expect(await pages()).toMatchObject({ inQueue: false, inHistory: true, historySignal: "skip" })
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
