export interface LabOption {
  slug: string
  name: string
  pitch: string
  idea: string
  theme: string
  risk: string
  adopt: string
}

// `adopt` is filled in from each build's own report once it lands.
export const LAB_OPTIONS: LabOption[] = [
  {
    slug: "evolved",
    name: "Evolved",
    pitch: "Flipside as it is, grown up. Same dark surface and violet, none of the glow, blur or grain.",
    idea: "A desktop layout that uses the screen (nav rail, queue, focus pane), one clear triage control instead of six stacked buttons, and full keyboard control.",
    theme: "Dark · violet accent · artist colour tints",
    risk: "Lowest. Least likely to make a stranger stop scrolling.",
    adopt: "Rewrite the landing page, the feed shell and the artist card (queue row + focus pane + triage control); add a docked player, a keyboard hook and undo. About 3 to 5 days, plus about 2 for the phone shell and real-device testing.",
  },
  {
    slug: "bside",
    name: "B-Side",
    pitch: "The name made literal: every artist is a record sleeve that flips over.",
    idea: "A crate you dig through. The back of the sleeve carries the why, the track list and the actions; keeping and passing are physical piles.",
    theme: "Light · drenched in each record's own colour",
    risk: "Medium. The 3D flip has to stay fast on cheap phones.",
    adopt: "Replace the artist card and feed layout with the sleeve and crate, restyle the nav, new landing. About a week including touch testing; the 3D flip needs checking on low-end phones.",
  },
  {
    slug: "tuner",
    name: "Tuner",
    pitch: "A radio that only plays what you've never heard.",
    idea: "Press play once. Previews chain back to back while you lock in or skip; a tuning dial replaces the feed, presets replace bookmarks.",
    theme: "Dark · hi-fi faceplate · warm dial light",
    risk: "Medium. Changes the core loop from browsing to listening.",
    adopt: "Replace the audio provider with a queueing engine, replace the feed with the deck, map presets to Saved and the log to History. 1 to 2 weeks, mostly iOS and Safari audio edge cases.",
  },
  {
    slug: "atlas",
    name: "Atlas",
    pitch: "Your genre map, made visible. Recommendations are pins planted just past your borders.",
    idea: "Turns the genre coordinate data you already ship into the product: pan, zoom, plant flags, push the frontier outward.",
    theme: "Light · printed-map inks",
    risk: "Highest build cost. Biggest wow, weakest on small phones.",
    adopt: "Biggest build: about 2,000 lines of map engine and UI, plus server work to place each recommended artist on the map and build each user's territory from their seeds and feedback. 2 to 3 weeks. Could ship first as the Explore tab only.",
  },
  {
    slug: "drop",
    name: "Daily Drop",
    pitch: "Five artists a day, then you're done. Come back tomorrow.",
    idea: "A finite daily ritual with swipe decisions, a streak, and a result card people post. The only option with a built-in growth loop.",
    theme: "Bright · screen-printed gig poster",
    risk: "Medium. Reframes the endless feed as a bonus round.",
    adopt: "Needs backend work: a per-user daily drop generator, a drops table, server-side decisions and streaks. 1 to 2 weeks backend plus about a week of UI.",
  },
]
