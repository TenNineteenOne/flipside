---
title: Settings & Discovery Tuning
updated: 2026-11-10
related: [[generation-engine]], [[data-model]], [[genre-system]], [[pages-and-components]]
---

# Settings & Discovery Tuning

User discovery preferences live as columns on the `users` row (see [[data-model]]), edited
via `PATCH /api/settings` (`lib/settings/patch-settings.ts` — the only client writer, with
typed keys, abort support and `SettingsSaveError`). Any change triggers `rebuild()` on the
feed-generation controller (`lib/client/feed-generation.ts`), which fires **both**
`POST /api/recommendations/generate?replace=true` and `POST /api/explore/generate?force=true`
in parallel.

## The settings

| Setting | Column | Type / default | Effect |
|---|---|---|---|
| How famous? | `fame_level` | smallint 0–4, def 2 | `fameToEngine` (`lib/settings/fame.ts`) → curve `k` 0.90 / 0.92 / 0.95 / 0.97 / 0.99; stop 0 also applies the hard `popularity > 50` drop (`UNDERGROUND_MAX_POPULARITY`) |
| Wander farther | `adventurous` | bool, def false | 10-slot exploration budget filled from the far pool, then adjacent bleed; also the 2nd similarity hop ([[generation-engine]]). Changes the next batch only |
| Preferred platform | `preferred_music_platform` | text, def `spotify` | which "Open in" link the UI shows |

Stops (labels exported as `FAME_LEVELS`): 0 Underground only · 1 Mostly niche · 2 Balanced ·
3 Mostly popular · 4 Anything goes.

**Retired by #205** (migration 0042; columns kept one release for rollback, never read):
`play_threshold` (now the fixed engine constant `FEED_PLAY_THRESHOLD = 5`; every row was
reset to 5), `popularity_curve` and `underground_mode` (backfilled into `fame_level`:
underground → 0, else the nearest curve stop, 0.90/0.91 → 1), `deep_discovery` (folded into
`adventurous = adventurous OR deep_discovery`). `PATCH /api/settings` rejects a patch carrying
`playThreshold`, `popularityCurve`, `undergroundMode` or `deepDiscovery` with a 400
(`"<key> is no longer a setting"`); `fameLevel` must be an integer 0–4 and `adventurous` a
boolean. The Settings server component passes `initialFameLevel` and `initialAdventurous`.

## How the curve shapes results
`tierMultiplier(popularity, k) = k^popularity`. Lower `k` punishes popular artists harder
(niche); `k→1.0` flattens toward mainstream. Combined with seed relevance:
`score = k^popularity × 0.8 + seedRelevance × 0.2 − adventurousPenalty`. See
[[generation-engine]]. The feed read path (`getUnseenRecommendations`) re-applies the
stop-0 cap from the *current* `fame_level`, so moving the slider is honored on first paint.

## Regenerate flow (`rebuild()` in `lib/client/feed-generation.ts`)
Guards concurrent calls with the controller's synchronous re-entry flag. An Explore 429
(its 90s cooldown) means a rebuild is already running and is treated as success — no
"Explore failed" toast. Both endpoints return after
*scheduling* (not completion) — the toast says "loading", and `localStorage["explore-regen-
at"]` signals `ExploreClient` to begin poll-swapping ([[pages-and-components]]). Honest
async copy was the fix in #146. The flag is the epoch ms written **before** the POSTs
(the server stamps `generated_at` at build start), so Explore treats rails with
`generatedAt >= flag` as already fresh; an Explore failure (non-429) removes it. Shuffle,
Apply and the Explore cold start write the same flag (#175 sweep 2 Y3).

Connected sources: blur saves a Last.fm / stats.fm username when it differs from the last
value the server **accepted**; the "connected · @name" status and Sync use that saved
value, never an unsaved or rejected draft. Genre pickers (onboarding + Settings) cap at
50 (`MAX_SELECTED_GENRES`), matching `PATCH /api/settings`, which rejects the whole patch
above that.
