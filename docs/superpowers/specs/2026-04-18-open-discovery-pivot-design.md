# Flipside — Open Discovery Engine Pivot

**Date:** 2026-04-18  
**Status:** Approved  
**Author:** Nick (via brainstorming session)

---

## Problem Statement

Flipside cannot be shared with more than 5 people because Spotify's developer OAuth requires email whitelisting in development mode. Beyond the access limit, the current design collects Spotify account data (listening history, profile) that users may not want to share, and social/group features add complexity and data exposure that isn't needed. The app needs to work for anyone, with zero PII collected, and no dependency on any user having a Spotify account.

---

## Solution

Replace Spotify OAuth with a privacy-first, no-PII username-only authentication system. Replace Spotify listening history as the sole seed input with a flexible multi-path onboarding system. Remove all social/group features. Keep Spotify only as a server-side service for track previews and artist search via client credentials — no user OAuth required.

---

## Architecture Overview

The core recommendation engine (Last.fm similarity + popularity scoring) is **unchanged**. Everything around it changes: auth, onboarding, seed sources, and social removal.

```
User
 └── Username-only login (HMAC hashed, no PII)
      └── Multi-path onboarding
           ├── Artist search → direct seeds
           ├── Genre picker (Wikidata hierarchy) → Last.fm tag.getTopArtists → seeds
           ├── Last.fm username → user.getTopArtists → seeds + listened_artists filter
           ├── Spotify (authorized only) → top artists → seeds + listened_artists filter
           └── Skip → cold-start random feed
                └── All paths → Seed pipeline → Last.fm getSimilar → Score → Cache → Feed
```

---

## Auth

### Model
Username-only. No password. No email. No PII ever stored.

### Mechanism
- User submits a username string
- Server computes `HMAC-SHA256(username, USERNAME_HMAC_SECRET)`
- Hash stored in `users.username_hash` (unique)
- Session: encrypted JWT, httpOnly cookie, SameSite=strict
- Session contains only the opaque user UUID — the hash never leaves the server
- Account creation: first login with a new username auto-creates the account
- Recovery: none by design. Users are warned at signup.

### Critical constraint
`USERNAME_HMAC_SECRET` is the single most critical secret. Loss or rotation makes all existing accounts inaccessible. Document prominently in deployment README.

### Avatar
- DiceBear library (`@dicebear/core` + `@dicebear/collection`)
- Seeded from user UUID (deterministic, unrelated to username)
- Style: identicon or pixel-art (decided at implementation)
- Nothing stored — generated on render

---

## Onboarding

### Path selection (multi-select)
Users see four cards plus a skip option. Any combination can be active simultaneously.

```
[Search Artists]  [Pick Genres]  [Connect Last.fm]  [Spotify ⚠ Restricted]

                  [Skip — show me random obscure artists]
```

Each selected card reveals its input UI inline. All inputs merge into one seed pool on continue.

### Artist search
- Search by name, pick multiple artists
- Existing seed picker flow — already built

### Genre picker (hierarchical)
- Top-level: Rock, Jazz, Electronic, Hip-Hop, Folk, Metal, Classical, World, Experimental, etc.
- Each node expandable to subgenres
- "+ Add" button at every level — users can submit at any depth
- Selected genres shown as removable chips
- Data source: `data/genres.json` (Wikidata-sourced, build-time generated)
- Each genre node maps to a Last.fm tag string used to query `tag.getTopArtists`

### Last.fm
- Username input field
- Saved to `users.lastfm_username`
- Can also be added/updated from Settings post-onboarding

### Spotify (Restricted)
- Card always visible
- Displays "Restricted Access" badge when `user.spotify_authorized = false`
- Clicking shows modal: explains access is limited, provides contact instructions
- Authorized users: standard Spotify OAuth flow, seeds Spotify top artists

### Skip / cold-start
- No input required
- Engine serves random low-popularity artists from `artist_search_cache` (popularity < 25)
- Fallback if cache sparse: `data/cold-start-seeds.json` (~50 curated artists, popularity < 20)
- After ≥5 thumbs-up reactions, normal personalized engine kicks in

---

## Genre Taxonomy

### Source
Wikidata SPARQL, querying music genre hierarchy via `subclass_of` (P279) property.

### Build process
- `scripts/build-genre-taxonomy.ts` queries Wikidata → builds tree → outputs `data/genres.json`
- Run manually or in CI; result committed to repo
- No runtime SPARQL dependency
- Refresh cadence: monthly or on demand

### Data structure
```typescript
interface GenreNode {
  id: string          // Wikidata entity ID
  label: string       // Display name (e.g., "Japanese Jazz")
  lastfmTag: string   // Last.fm tag string (e.g., "japanese jazz")
  parentId: string | null
  children: GenreNode[]
}
```

### Notes
- After first build, review output for missing `lastfmTag` values and annotate manually
- Some niche genres may not exist in Last.fm's tag namespace — fallback: skip that tag silently

---

## Seed Pipeline

All sources fire in parallel. Results merged, deduped by Spotify artist ID. Diversity-aware selection ensures no single source dominates.

### Sources

| Source | Trigger | Engine input | Side effect |
|---|---|---|---|
| Artist search | User picked artists in onboarding | Direct seed list | None |
| Genre tags | User selected genres | `Last.fm tag.getTopArtists(tag)` per tag → artists | None |
| Last.fm | `lastfm_username` set | `Last.fm user.getTopArtists(username)` → artists | Populates `listened_artists` |
| Spotify | `spotify_authorized = true` | Spotify top artists (user token) → artists | Populates `listened_artists` |
| Cold-start | No sources + < 5 thumbs-up | `artist_search_cache` (popularity < 25) or `cold-start-seeds.json` | None |
| Feedback | ≥ 5 thumbs-up exist | Thumbs-up artists used as seeds regardless of other sources | None |

### Diversity sampling
- Proportional: if user has 3 genre tags and 2 artist seeds, neither source dominates
- Per-source cap: prevents one prolific source from flooding the pool
- Total seeds passed to engine: ~10 (matches existing engine expectation)

---

## Feed

- Unchanged from current implementation
- Thumbs-up / thumbs-down / undo / save / preview all unchanged
- Spotify client credentials used for preview URLs (no user auth needed)
- Authorized Spotify users: saves still add to Spotify playlist

### Load More
Works in every state:

| State | Behavior |
|---|---|
| Normal (seeds configured) | Run engine, generate fresh batch |
| Cold-start, zero thumbs-up | Serve new random low-popularity batch |
| Cold-start, ≥1 thumbs-up | Run engine with thumbs-up artists as seeds |

---

## Settings

- **Obscurity slider**: maps to `users.play_threshold` — labeled "How underground?" — controls how aggressively known artists are filtered
- **Connected sources**: shows Last.fm (connected/not), Spotify (authorized/not)
- **Last.fm**: update username
- **Spotify**: connect button (only visible if `spotify_authorized = true`)
- No group/social settings

---

## Schema Changes

### `users` table

**Remove:** `spotify_id`, `display_name`, `avatar_url`

**Add:**
- `username_hash` (text, unique, not null) — HMAC of username
- `selected_genres` (text[], nullable) — Last.fm tag strings from genre picker
- `spotify_authorized` (boolean, default false) — controls Spotify path access

**Keep:** `id`, `play_threshold`, `lastfm_username`, `flipside_playlist_id`, `created_at`

### Tables dropped
- `groups`
- `group_members`
- `group_activity`

### All other tables unchanged
`recommendation_cache`, `feedback`, `saves`, `seed_artists`, `listened_artists`, `artist_search_cache`, `artist_tracks_cache`

---

## Removals

### Social features (hard delete, no feature flags)
- Tables: `groups`, `group_members`, `group_activity`
- API routes: all `/api/groups/*`
- UI: all group pages and components
- Copy: every reference to friends, groups, social, sharing anywhere in the app

### Spotify user-level auth
- No Spotify OAuth for users
- Spotify client credentials (server-side) retained for search + previews
- User-level token logic removed except for `spotify_authorized = true` users

---

## New Environment Variables

| Var | Purpose | Notes |
|---|---|---|
| `USERNAME_HMAC_SECRET` | HMAC key for username hashing | CRITICAL — document rotation risk prominently |

Existing Spotify vars (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`) retained for server-side use.

---

## New Files

| File | Purpose |
|---|---|
| `scripts/build-genre-taxonomy.ts` | Wikidata SPARQL → genres.json |
| `data/genres.json` | Generated genre hierarchy (committed) |
| `data/cold-start-seeds.json` | ~50 curated obscure artists for cold-start |
| `components/onboarding/PathCards.tsx` | Multi-select onboarding path cards |
| `components/onboarding/GenrePicker.tsx` | Hierarchical genre tree picker |
| `components/ui/DiceBearAvatar.tsx` | UUID-seeded avatar component |

---

## Implementation Phases

| Phase | Description |
|---|---|
| 1 | Remove all social/group features |
| 2 | Auth pivot: username-only HMAC + DiceBear avatars |
| 3 | Genre taxonomy: Wikidata build script + cold-start seed list |
| 4 | Onboarding redesign: multi-path seed selection |
| 5 | Seed pipeline expansion: genre tags, cold-start, diversity sampling |
| 6 | Settings page: obscurity slider, connected sources |
| 7 | QA, cleanup, deployment docs |
| 8 | Code review and bug check |

See `CLAUDE.md` plan file for full per-phase step lists.

---

## Out of Scope

- Spotify Extended Quota Mode application
- Account deletion / data export
- Email notifications
- Admin panel for `spotify_authorized` management
- Password recovery
- Mobile app
- Playlist features for non-Spotify users
- Real-time feed updates
