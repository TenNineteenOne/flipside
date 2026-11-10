// Ideas that can be lifted out of a direction and built on their own.
export const LAB_FEATURES = [
  { id: "playable-landing", label: "Landing page that plays music before sign-up", from: "all five" },
  { id: "desktop-layout", label: "Desktop layout that uses the screen (rail · queue · focus pane)", from: "Evolved" },
  { id: "triage-control", label: "One triage control instead of six stacked buttons", from: "Evolved" },
  { id: "keyboard", label: "Keyboard triage, auto-advance and undo", from: "Evolved" },
  { id: "autoplay", label: "Lean-back mode: previews chain back to back", from: "Tuner" },
  { id: "visualiser", label: "Live audio visualiser", from: "Tuner" },
  { id: "swipe", label: "Swipe to keep / pass on mobile", from: "Daily Drop, B-Side" },
  { id: "daily-drop", label: "Daily drop of five with a streak", from: "Daily Drop" },
  { id: "share-card", label: "Shareable result card", from: "Daily Drop" },
  { id: "flip-card", label: "Flip the card: why + tracks + actions on the back", from: "B-Side" },
  { id: "colour-drench", label: "Page takes on the current artist's colour", from: "B-Side" },
  { id: "genre-map", label: "Genre map as a view (e.g. replaces Explore rails)", from: "Atlas" },
  { id: "frontier", label: "\"How far out?\" control shown spatially", from: "Atlas" },
  { id: "perf-pass", label: "Performance pass: no blur, no grain, two fonts", from: "audit" },
] as const
