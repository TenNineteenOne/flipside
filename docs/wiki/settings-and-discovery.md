---
title: Settings & Discovery Tuning
updated: 2026-11-10
related: [[generation-engine]], [[data-model]], [[genre-system]], [[pages-and-components]]
---

# Settings & Discovery Tuning

User discovery preferences live as columns on the `users` row (see [[data-model]]), edited
via `PATCH /api/settings` (`lib/settings/patch-settings.ts` — the only client writer, with
typed keys, abort support and `SettingsSaveError`). Nothing regenerates on save: the route
calls `onTasteChanged` (`lib/taste-change.ts`), which wipes the user's unseen Feed queue when
`selectedGenres` changed, so the next Feed load generates under the new genres. "How
famous?" (`fameLevel`) and Wander farther (`adventurous`) only shape the next batch and wipe
nothing; the slider saves only when its value differs from the last saved one.

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

Connected sources: blur saves a Last.fm / stats.fm username when it differs from the last
value the server **accepted**; the "connected · @name" status and Sync use that saved
value, never an unsaved or rejected draft. Genre pickers (onboarding + Settings) cap at
50 (`MAX_SELECTED_GENRES`), matching `PATCH /api/settings`, which rejects the whole patch
above that.
