---
title: Architecture Overview
updated: 2026-06-06
related: [[generation-engine]], [[api-routes]], [[music-providers]], [[data-model]]
---

# Architecture Overview

flipside is a **Next.js 16 App Router** app (React 19, TypeScript, Tailwind v4) backed by
**Supabase** (Postgres + RLS). It is deployed on Vercel. See [[index]] for the visual map.

## Route groups

| Group | Routes | Auth | Wrapper |
|---|---|---|---|
| `app/(app)` | `/feed`, `/explore`, `/history`, `/saved`, `/stats`, `/settings` | required (redirect to `/sign-in`) | `AudioProvider` + `AppNav` + `MiniPlayer` |
| `app/(marketing)` | `/sign-in`, `/onboarding` | public | bare layout |
| `app/api` | the HTTP surface | mixed | see [[api-routes]] |

Every `(app)` page is an **async server component** that queries Supabase directly, then
hands serialized data to a `"use client"` shell for interactivity. A single
`HTMLAudioElement` lives in `AudioProvider` so preview playback persists across navigation
(the floating `MiniPlayer`). See [[pages-and-components]].

## Request lifecycle

1. `proxy.ts` (Next.js middleware) wraps NextAuth `auth()` and gates every request:
   unauthenticated → redirect to `/` (or 401 for APIs); authenticated hitting `/` →
   `/feed`. `/api/auth/*` and `/api/cron/*` are exempt. See [[auth-and-session]].
2. The page server component reads the user row (`getCachedUser`, request-deduped) and the
   relevant cache tables, then renders.
3. Client shells call [[api-routes]] for mutations and incremental fills.

## The generation flow (the heart of the app)

Both the **Feed** ([[generation-engine]]) and **Explore** ([[explore-engine]]) share one
resolver/confirm core:

```
seeds ─▶ Last.fm similarity / tag fan-out ─▶ candidate names
      ─▶ resolve names → artists (cache → Spotify search, + Last.fm enrichment)
      ─▶ filter (listened / thumbs-down / cooldown / underground cap)
      ─▶ score (k^popularity) + diversity (greedy + 25% cluster cap)
      ─▶ confirm playable preview (iTunes first → Spotify fallback)
      ─▶ write to cache (recommendation_cache / explore_cache)
```

Key design properties:

- **Fast first paint, fill in background.** The Feed writes a first tier of ~8 confirmed
  artists, returns, then continues resolving/confirming the rest inside `after()`. The
  client polls `/api/recommendations` to append. (See [[generation-engine]] and PRD
  `docs/superpowers/specs/prd-fast-first-paint.md`.)
- **Last.fm is the recommendation brain**, not Spotify. Similar-artist and genre-tag
  expansion are 100% Last.fm. See [[external-apis]].
- **iTunes is the primary preview source**; Spotify is a fallback. See [[music-providers]].
- **Diversity is enforced** by a hard 25% per-genre cluster cap plus soft greedy penalties.
- **Resilience** comes from per-provider circuit breakers + concurrency limiters so one
  generation can't self-DDoS the shared keys. See [[music-providers]].

## External dependencies

| Service | Role | Page |
|---|---|---|
| Last.fm | similar artists, genre tags, enrichment (genres/popularity), history | [[external-apis]] |
| iTunes / Apple | 30s preview audio (primary), Apple Music links | [[external-apis]] |
| Spotify Web API | artist search (name→ID+image), user history (optional), "open in Spotify" | [[external-apis]], [[spotify-dependency]] |
| stats.fm | optional listening-history source | [[external-apis]] |
| Supabase | all persistence | [[data-model]] |

## Where to go next

- Editing recommendations? → [[generation-engine]] / [[explore-engine]]
- Touching external calls or breakers? → [[music-providers]] / [[external-apis]]
- Schema change? → [[data-model]]
- Evaluating the Spotify dependency? → [[spotify-dependency]]
