// The reader's words for the Decisions model (used when a result is read as a
// path through states). Depends only on its arguments.
const VERDICT = { up: "Liked", down: "Passed", skip: "Dismissed", dismissed: "Dismissed", U: "no verdict" }
const HISTORY = { up: "Liked", down: "Passed", dismissed: "Dismissed", skip: "Skipped" }

const len = (seq) => Object.keys(seq ?? {}).length
const tabsOf = (v) => Object.keys(v.tab).sort()

function server(s) {
  const verdict = s.fb === "up" ? "a Like on record" : s.fb === "down" ? "a Pass on record" : "no verdict on record"
  const saved = s.saved ? ", saved" : ""
  if (!s.seen && s.skip) return `Server: in neither the queue nor History${saved}`
  if (!s.seen) return `Server: in the Feed queue, ${verdict}${saved}`
  const label = s.saved ? "Saved" : HISTORY[s.fb !== "none" ? s.fb : s.skip ? "dismissed" : "skip"]
  return `Server: in History as ${label}${s.fb !== "none" && s.skip ? " (also dismissed)" : ""}`
}

function screen(tb) {
  const waiting = len(tb.q) + len(tb.sq) + (tb.rtf && len(tb.q) === 0 ? 1 : 0)
  const busy = waiting ? `, ${waiting} request${waiting > 1 ? "s" : ""} waiting` : ""
  if (tb.page === "feed") {
    if (!tb.row) return "Feed has no card"
    return `Feed card shows ${VERDICT[tb.vis]}${tb.savedVis ? ", saved" : ""}${busy}`
  }
  if (!tb.row) return `History has no row${busy}`
  const shown = tb.vis === "U" ? tb.loaded : tb.vis
  return `History row shows ${tb.booked ? "Saved" : HISTORY[shown]}${busy}`
}

export const title = "flipside: one artist's decision"

export const state = (v) => {
  const tabs = tabsOf(v)
  const screens = tabs.map((t) => (tabs.length > 1 ? `Tab ${t.toUpperCase()}: ` : "") + screen(v.tab[t]))
  return [...screens, server(v.srv)].join(" | ")
}

export const group = (v) => (!v.srv.seen && !v.srv.skip ? "queue" : "history")
export const colors = { queue: "blue", history: "tan" }

const REQUEST = {
  postUp: "the Like", postDown: "the Pass", postSkip: "the Dismiss",
  delFeedback: "the verdict removal", delDismiss: "the return to the queue",
  saveUpsert: "the save", saveSeen: "the save's seen stamp", delSave: "the unsave",
}

export const step = (action, from, to) => {
  const tabs = tabsOf(from)
  const t = tabs.find((k) => JSON.stringify(from.tab[k]) !== JSON.stringify({ ...to.tab[k], solo: from.tab[k].solo })) ?? tabs[0]
  const a = from.tab[t], b = to.tab[t]
  const where = tabs.length > 1 ? `in tab ${t.toUpperCase()}, ` : ""
  switch (action) {
    case "LoadTo": return `${where}you open ${b.page === "feed" ? "the Feed" : "History"}`
    case "Judge":
      return `${where}you tap ${b.vis === "U" ? "More like this again (un-like)" : { up: "More like this", down: "Less like this", skip: "Dismiss" }[b.vis]}`
    case "TapUndo": return `${where}you tap Undo`
    case "TapSave": return `${where}you tap ${b.savedVis ? "Save" : "Save again (unsave)"}`
    case "ChangeTo": return `${where}you tap Change to ${VERDICT[b.vis]}`
    case "TapReturnToFeed": return `${where}you tap Return to feed`
    case "Step":
    case "SaveStep": {
      const op = (action === "Step" ? a.q : a.sq)[1]
      const what = REQUEST[op.steps[1]]
      const whose = tabs.length > 1 ? ` from tab ${t.toUpperCase()}` : ""
      if (to.fails === from.fails) return `the server applies ${what}${whose}`
      const applied = JSON.stringify(from.srv) !== JSON.stringify(to.srv)
      return applied
        ? `the server applies ${what}${whose}, but the answer is lost`
        : `${what}${whose} fails`
    }
    default: return action
  }
}
