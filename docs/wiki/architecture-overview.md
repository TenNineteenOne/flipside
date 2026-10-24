---
title: Architecture Overview
updated: 2026-10-24
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
      ─▶ resolve names → artist uuids (the doorway, lib/artist-identity:
         `artists` name read → Last.fm artist.getInfo → mint/reuse row)
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

## Module layering

Dependencies point one way (no import cycles, #175 E3):

```
app/ ─▶ lib/cards (card assembly) · lib/client (framework-free UI controllers)
     ─▶ lib/recommendation (engines, PlayableCandidates, PreviewStore, Exclusions)
     ─▶ lib/lastfm (one Last.fm adapter) · lib/music-provider (iTunes, Spotify)
        · lib/artist-identity (the doorway)
     ─▶ lib/limiter · lib/metrics · lib/supabase
```

See [[index]] for the full module map.

## External dependencies

| Service | Role | Page |
|---|---|---|
| Last.fm | similar artists, genre tags, enrichment (genres/popularity), history | [[external-apis]] |
| iTunes / Apple | 30s preview audio (primary), Apple Music links | [[external-apis]] |
| Spotify Web API | client-credentials top-tracks preview fallback only (`lib/music-provider/spotify.ts`); no user token, no library actions, no name resolution (#157, #175). "Open in Spotify" is a URL, not an API call | [[external-apis]], [[spotify-dependency]] |
| stats.fm | optional listening-history source | [[external-apis]] |
| Supabase | all persistence | [[data-model]] |

## Where to go next

- Editing recommendations? → [[generation-engine]] / [[explore-engine]]
- Touching external calls or breakers? → [[music-providers]] / [[external-apis]]
- Schema change? → [[data-model]]
- Evaluating the Spotify dependency? → [[spotify-dependency]]
