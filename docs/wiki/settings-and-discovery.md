---
title: Settings & Discovery Tuning
updated: 2026-06-06
related: [[generation-engine]], [[data-model]], [[genre-system]], [[pages-and-components]]
---

# Settings & Discovery Tuning

User discovery preferences live as columns on the `users` row (see [[data-model]]), edited
via `PATCH /api/settings` (`lib/settings/patch-settings.ts`). Any change triggers
`lib/settings/regenerate.ts`, which fires **both**
`POST /api/recommendations/generate?replace=true` and `POST /api/explore/generate?force=true`
in parallel.

## The settings

| Setting | Column | Type / default | Effect |
|---|---|---|---|
| Obscurity | `play_threshold` | int 0–50, def 0 | upper bound for filtering out already-listened artists; banded label |
| Popularity curve | `popularity_curve` | numeric 0.90–1.00, def 0.95 | base `k` in the `k^popularity` score ([[generation-engine]]) |
| Adventurous | `adventurous` | bool, def false | broadens Feed + reorders Explore rails |
| Deep discovery | `deep_discovery` | bool, def false | enables the 2nd similarity hop (`runDeepHop`) |
| Underground | `underground_mode` | bool, def false | hard cap: drop `popularity > 50` (`UNDERGROUND_MAX_POPULARITY`) |
| Preferred platform | `preferred_music_platform` | text, def `spotify` | which "Open in" link the UI shows |

> `underground_mode` (0015) and `deep_discovery` (0022) **both exist** — confirm intended
> semantics before assuming one replaced the other.

## Labels

**Obscurity** (`lib/settings/obscurity.ts`): `<5` Deep underground · `5–14` Offbeat ·
`15–29` Curious · `≥30` Familiar (each with a color token).

**Curve** (`lib/settings/curve-text.ts`): `<0.92` Niche only · `0.92–0.94` Mostly niche ·
`0.95–0.96` Balanced (default) · `0.97–0.98` Mostly popular · `≥0.99` Mainstream. The curve
is the base of an exponential applied to artist popularity.

## How the curve shapes results
`tierMultiplier(popularity, k) = k^popularity`. Lower `k` punishes popular artists harder
(niche); `k→1.0` flattens toward mainstream. Combined with seed relevance:
`score = k^popularity × 0.8 + seedRelevance × 0.2 − adventurousPenalty`. See
[[generation-engine]].

## Regenerate flow (`lib/settings/regenerate.ts`)
Guards concurrent calls with a synchronous `isGeneratingRef`. Both endpoints return after
*scheduling* (not completion) — the toast says "loading", and `localStorage["explore-regen-
at"]` signals `ExploreClient` to begin poll-swapping ([[pages-and-components]]). Honest
async copy was the fix in #146.
