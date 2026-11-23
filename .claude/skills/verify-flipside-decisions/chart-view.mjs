// Overview chart for chart.cfg: where the server has the artist, and which
// request moves it. Taps and page loads change no server row, so they are not
// drawn; Liked and Passed behave the same and share one state.
export const title = "flipside: where one artist is, by what the server has (one tab, no failures, saving left out)"

export const state = (v) => {
  const s = v.srv
  const rated = s.fb !== "none"
  if (!s.seen && s.skip) return "Stuck: in neither the queue nor History"
  if (!s.seen) return rated ? "In the Feed queue with a Like or Pass on record" : "In the Feed queue, undecided"
  if (rated) return s.skip ? "In History as Liked or Passed (dismissal also on record)" : "In History as Liked or Passed"
  return s.skip ? "In History as Dismissed" : "In History as Skipped (seen, no verdict)"
}

export const group = (v) => (v.srv.seen ? "history" : "queue")
export const colors = { queue: "blue", history: "tan" }

const REQUEST = {
  postUp: "a Like or Pass lands",
  postDown: "a Like or Pass lands",
  postSkip: "a Dismiss lands",
  delFeedback: "the verdict is removed (un-like, Undo of a Like or Pass, first half of Return to feed)",
  delDismiss: "seen and dismissed are cleared (Undo of a Dismiss, second half of Return to feed)",
}

export const step = (action, from) => {
  if (action !== "Step") return null
  const tab = Object.values(from.tab).find((t) => Object.keys(t.q).length > 0)
  return REQUEST[tab.q[1].steps[1]] ?? null
}
