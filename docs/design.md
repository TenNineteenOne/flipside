# Flipside — Music Discovery App for Friend Groups

## Context

Flipside is a private music discovery web app for small friend groups (max 10 people). The core problem: without social media, finding new music from artists you've never heard is hard. Flipside connects to Spotify, analyzes your listening history, and surfaces artists you've never played — filtered, ranked, and enriched with social signal from your friend group. Users can preview tracks, react with thumbs up/down, save to Spotify, and discover what friends are finding. The feedback loop improves recommendations over time.

GitHub repo: https://github.com/TenNineteenOne/flipside

---

## Stack

- **Next.js 14** (App Router, TypeScript)
- **NextAuth.js** — Spotify OAuth (sole identity provider, no separate accounts)
- **Supabase** — PostgreSQL database + real-time subscriptions + RLS
- **Vercel** — deployment + cron jobs for daily feed refresh
- **Spotify Web API** — top artists, recommendations, 30s preview URLs, playlist management
- **Last.fm API** — similar artists (`artist.getSimilar`) + full scrobble history via username; read-only, no OAuth required
- **Tailwind CSS + shadcn/ui** — dark mode only; blues, teals, purples palette; Spotify-inspired layout

---

## Architecture

```
Browser (Next.js React)
  ↕
Next.js API Routes (server-side — Spotify tokens never exposed to client)
  ↕                    ↕                   ↕
Spotify API        Supabase DB          Last.fm API
(music data)       (users, groups,      (similar artists,
                    feedback, cache)     scrobble history)
```

### MusicProvider Interface

All recommendation logic talks to a `MusicProvider` interface, never to Spotify or Last.fm directly. This is the most important architectural seam in the app.

```typescript
interface MusicProvider {
  getTopArtists(userId: string, term: 'short' | 'medium' | 'long'): Promise<Artist[]>
  getSimilarArtists(artistId: string): Promise<Artist[]>   // uses Last.fm artist.getSimilar
  getRecentlyPlayed(userId: string): Promise<PlayHistory[]>
  searchArtists(query: string): Promise<Artist[]>
  getArtistTopTracks(artistId: string, limit: number): Promise<Track[]>
  createPlaylist(userId: string, name: string): Promise<string>
  addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void>
}
```

`SpotifyProvider` implements this interface. Note: Spotify deprecated `/artists/{id}/related-artists` in November 2024. `getSimilarArtists` uses Last.fm `artist.getSimilar` (unauthenticated) as the primary source and Spotify Recommendations API as secondary. Do not use the deprecated Spotify endpoint.

---

## Data Model

```sql
-- Core user record
users (
  id uuid PK,
  spotify_id text UNIQUE,
  display_name text,
  avatar_url text,
  play_threshold int DEFAULT 0,       -- 0 = strict (never played), adjustable in Settings
  flipside_playlist_id text,          -- Spotify playlist ID for saves, auto-created on first save
  lastfm_username text,               -- optional; validated against Last.fm API on save
  created_at timestamptz
)

-- Friend groups (max 10 members)
groups (
  id uuid PK,
  name text,
  invite_code text UNIQUE,            -- anyone in group can share this link
  created_by uuid FK users,
  created_at timestamptz
)

group_members (
  id uuid PK,
  group_id uuid FK groups,
  user_id uuid FK users,
  joined_at timestamptz
)

-- Cold start: manually selected seed artists during onboarding
-- Used until user has >= 10 Spotify top artists, then ignored entirely
seed_artists (
  id uuid PK,
  user_id uuid FK users,
  spotify_artist_id text,
  name text,
  image_url text,
  added_at timestamptz
)

-- Accumulated listening history (private — never exposed to groups via RLS)
-- Built from: Spotify top artists, Spotify recently-played, Last.fm scrobbles
listened_artists (
  id uuid PK,
  user_id uuid FK users,
  spotify_artist_id text,             -- null for Last.fm-only entries
  lastfm_artist_name text,            -- null for Spotify-only entries
  source text CHECK (source IN ('spotify_recent', 'spotify_top', 'lastfm')),
  play_count int DEFAULT 1,           -- incremented on each new occurrence
  last_seen_at timestamptz,
  created_at timestamptz,
  UNIQUE(user_id, spotify_artist_id)
)

-- Daily-refreshed recommendation cache
recommendation_cache (
  id uuid PK,
  user_id uuid FK users,
  spotify_artist_id text,
  artist_data jsonb,                  -- name, genres, image, top 3 tracks, preview URLs
  score float,                        -- ranking score (boosted by feedback + friend signals)
  why jsonb,                          -- { sourceArtists: string[], genres: string[], friendBoost: string[] }
  seen_at timestamptz,                -- null = not yet shown to user
  expires_at timestamptz,             -- seen items expire after 7 days; unseen items after 30 days
  source text,                        -- 'lastfm_similar' | 'spotify_recommendations' | 'seed'
  created_at timestamptz
)

-- User feedback signals
feedback (
  id uuid PK,
  user_id uuid FK users,
  spotify_artist_id text,
  signal text CHECK (signal IN ('thumbs_up', 'thumbs_down')),
  created_at timestamptz,
  deleted_at timestamptz              -- soft delete for undo; null = active
)

-- Saves (also treated as implicit thumbs_up in scoring)
saves (
  id uuid PK,
  user_id uuid FK users,
  spotify_artist_id text,
  spotify_track_id text,
  created_at timestamptz
)

-- Social activity surfaced in group members' feeds
group_activity (
  id uuid PK,
  user_id uuid FK users,
  group_id uuid FK groups,
  spotify_artist_id text,
  artist_name text,
  action_type text CHECK (action_type IN ('thumbs_up', 'save')),
  created_at timestamptz
  -- Records persist when user leaves group (historical data retained)
)
```

---

## Recommendation Engine

Runs on-demand after first login (with loading state), then daily via Vercel Cron (`0 3 * * *` — 3am UTC). For each user:

1. **Fetch top artists** via `MusicProvider.getTopArtists()` (short, medium, long term)
2. **Seed fallback**: if user has < 5 Spotify top artists, include `seed_artists`. Seeds ignored once user has ≥10 top artists (hard cutoff).
3. **Expand**: call `MusicProvider.getSimilarArtists()` (Last.fm) and Spotify Recommendations API for each top/seed artist. Engine works at track level where it produces better results, deduplicating to artist level afterward.
4. **Filter — history**: exclude artists where `spotify_artist_id` appears in `listened_artists` with `play_count > play_threshold`, OR where normalized artist name matches a `lastfm_artist_name` entry with `play_count > play_threshold`.
5. **Filter — feedback**: remove thumbs-down'd artists (feedback where signal='thumbs_down' and deleted_at IS NULL)
6. **Score**: base score from Spotify popularity + relationship proximity to seed/top artists
7. **Boost**: +score for artists related to thumbs-up'd artists and saves
8. **Boost**: +score for artists that group members have thumbs-up'd or saved
9. **Resurfacing**: a seen-but-ignored artist (seen_at IS NOT NULL, no feedback) is re-eligible if `ceil(groupSize * 0.2)` other group members have reacted since the user ignored it
10. **Deduplicate** and rank
11. **Fetch top tracks**: call `MusicProvider.getArtistTopTracks(artistId, 10)`, surface top 3 in `artist_data`. Tracks with null `preview_url` are included but flagged — frontend shows disabled play button.
12. **Write** to `recommendation_cache`: replace previous unseen items, preserve unexpired seen items
13. **Cron batching**: process users 10 at a time, 1 batch per minute, exponential backoff on Spotify 429s

### why field structure
```json
{
  "sourceArtists": ["Snail Mail", "Soccer Mommy"],
  "genres": ["indie rock", "lo-fi"],
  "friendBoost": ["Jordan", "Alex"]
}
```
Max 2 source artists, max 2 genres. Populated at cache-build time. Frontend renders: *"Because you like Snail Mail and Soccer Mommy · indie rock, lo-fi · Jordan also likes this"*

---

## Key Pages & Routes

### Pages
| Route | Description |
|---|---|
| `/` | Landing page with "Connect Spotify" button |
| `/onboarding` | Seed artist picker (3–5 artists); shown when Spotify top artists < 5 |
| `/feed` | Main discovery feed; group filter tabs if user is in multiple groups |
| `/groups` | List user's groups; create group button |
| `/join/[code]` | Join group via invite link; works before or after auth (see pre-auth flow) |
| `/settings` | Play threshold, hidden artists, playlist selection, Last.fm username |

### API Routes
| Route | Method | Description |
|---|---|---|
| `/api/auth/[...nextauth]` | — | NextAuth Spotify OAuth |
| `/api/recommendations` | GET | Return user's cached feed |
| `/api/feedback` | POST | Submit thumbs up or thumbs down |
| `/api/feedback/[artistId]` | DELETE | Undo thumbs down (soft delete) |
| `/api/saves` | POST | Save artist track to Spotify playlist |
| `/api/groups` | GET/POST | List groups / create group |
| `/api/groups/[id]/invite` | GET | Get/regenerate invite code |
| `/api/groups/join` | POST | Join group by invite code |
| `/api/groups/[id]/activity` | GET | Real-time group feed activity |
| `/api/cron/recommendations` | POST | Vercel Cron handler — daily feed rebuild |

---

## UX Details

### Artist card (feed item)
- Artist name, genres, avatar image
- `why` rendered from `recommendation_cache.why` jsonb: "Because you like X and Y · genre1, genre2"
- Friend overlap: "Jordan and Alex also like this" (live-updated via Supabase real-time — annotation only, no reordering)
- Up to 3 preview tracks with inline play/pause (HTML5 `<audio>` + Spotify `preview_url`). Tracks with null `preview_url` show a disabled play button — artist is still shown.
- Thumbs up / Thumbs down / Save buttons (no swipe gestures in v1; card built to support swipe later)

### Thumbs down flow
- Card immediately shows an inline "Undo" overlay for 5 seconds
- Tap Undo → card returns to normal state, no feedback record written
- After 5 seconds → card slides out, `feedback` row written with `deleted_at = null`
- Full hidden artists list in Settings → Hidden Artists (restore via DELETE `/api/feedback/[artistId]`)

### Feed behavior
- Seen-but-not-reacted artists expire after 7 days; can resurface if `ceil(groupSize * 0.2)` other group members react
- Thumbs-down'd artists permanently hidden (recoverable via Settings)
- Feed sorted by score; card order frozen until next daily cron run
- Real-time (Supabase) updates friend annotations only — no mid-session reordering

### Groups
- Max 10 members per group
- Any member can share the invite link
- Users can be in multiple groups; feed has per-group filter tabs
- Past reactions/saves stay in `group_activity` when a member leaves

### Pre-auth invite flow
1. User clicks `/join/[code]` while unauthenticated
2. Invite code stored in a cookie
3. User is redirected to Spotify OAuth
4. After auth and user record creation, pending invite cookie is processed → user auto-joined to group
5. Redirect to feed (already in the group)

### Cold start / onboarding
- Trigger: user has < 5 Spotify top artists after login
- Show seed picker: search Spotify artists, pick 3–5
- Seeds treated as top artists in the engine until real history reaches ≥10 top artists (hard cutoff)
- First feed generated on-demand with loading state ("Building your first feed…"); subsequent refreshes via cron

### Last.fm username
- Optional field in Settings
- Validated against Last.fm API on save (`user.getInfo`)
- Scrobble history pulled via `user.getTopArtists` + `user.getRecentTracks` (no auth needed)
- History stored in `listened_artists` with `source = 'lastfm'`; matched at filter time by normalized artist name
- Dramatically improves "never played" filter accuracy for active Last.fm users

### Saves
- First save auto-creates "Discovered via Flipside" playlist in user's Spotify
- Playlist ID stored in `users.flipside_playlist_id`
- User can configure a different destination playlist in Settings

---

## Row Level Security

All Supabase tables have RLS enabled from day one.

| Table | Policy |
|---|---|
| `users` | User can read/write own row only |
| `feedback` | User can read/write own rows only |
| `saves` | User can read/write own rows only |
| `recommendation_cache` | User can read/write own rows only |
| `seed_artists` | User can read/write own rows only |
| `listened_artists` | User can read/write own rows only; **never readable by group members** |
| `groups` | Members of the group can read; creator can update |
| `group_members` | Members of the group can read |
| `group_activity` | Members of the group can read |

---

## Background Jobs

**Daily feed refresh** (Vercel Cron `0 3 * * *` — 3am UTC):
- Pull all users in batches of 10, 1 batch per minute
- For each user: run recommendation engine, write new `recommendation_cache` entries
- Mark expired cache entries (seen_at > 7 days ago)
- Exponential backoff on Spotify 429 responses

**listened_artists accumulation** (runs as part of daily cron per user):
- Call Spotify recently-played (last 50 tracks), upsert artists into `listened_artists`
- If `lastfm_username` set, pull Last.fm `user.getRecentTracks` (paginated), upsert by normalized name

---

## Visual Design

- Dark mode only
- Color palette: blues, teals, purples — used for accents, interactive states, and highlights
- Spotify-inspired layout: vertical feed of cards, prominent artist imagery, clean typography
- Component library: Tailwind CSS + shadcn/ui for primitives (buttons, dialogs, inputs, tabs)
- Custom card component for artist feed items — built to support swipe gestures as a future enhancement

---

## Future Considerations

- **Swipe gestures** on feed cards (left = thumbs down, right = thumbs up) — card component is built with this in mind
- **Last.fm OAuth** — not needed; username-only provides equivalent read-only data for public profiles
- **Apple Music / Tidal** — no viable public history API; deferred indefinitely
- **MusicBrainz ID deduplication** — if merging Last.fm + Spotify history more precisely in future; current normalized-name approach is sufficient for v1

---

## Verification Checklist

- [ ] Spotify OAuth login → user record created in Supabase
- [ ] Sparse history (< 5 top artists) → onboarding seed picker appears
- [ ] Seed picker → selected artists used in recommendation engine
- [ ] ≥10 Spotify top artists → seeds ignored in engine
- [ ] First login → on-demand feed generation with loading state
- [ ] Feed loads → all artists absent from user's listening history (per threshold)
- [ ] Tracks with null preview_url → disabled play button shown, artist still visible
- [ ] Thumbs down → undo overlay appears for 5s, then card slides out
- [ ] Undo → card restored, no feedback record written
- [ ] Settings → Hidden Artists list shows thumbs-down'd artists; restore works
- [ ] 3 preview tracks → each plays inline without leaving the app
- [ ] Save → track added to Flipside playlist in user's Spotify account
- [ ] Create group → invite link generated, shareable by any member
- [ ] Pre-auth invite → invite code preserved through OAuth, user auto-joined after login
- [ ] Friend joins → their activity surfaces in your feed via real-time annotation
- [ ] Real-time friend activity → appends to card annotation, does not reorder feed
- [ ] Resurfacing → ignored artist reappears when ceil(groupSize * 0.2) other members react
- [ ] Daily cron → recommendation cache rebuilt, feed updated next load
- [ ] Cron batching → processes users 10/min, retries on 429
- [ ] Multiple groups → filter tabs visible in feed, per-group view works
- [ ] Leave group → historical group_activity records remain for other members
- [ ] Last.fm username saved → validated, scrobble history populates listened_artists
- [ ] listened_artists → never readable by group members (RLS enforced)
- [ ] why field → renders source artists, genres, and friend names on card
