# Flipside — Music Discovery App for Friend Groups

## Context

The user wants a music discovery web app called **Flipside** for themselves and a small friend group. The core problem: without social media, finding new music from artists you've never heard is hard. Flipside connects to Spotify, analyzes your listening history, and surfaces artists you've never played — filtered, ranked, and enriched with social signal from your friend group. Users can preview tracks, react with thumbs up/down, save to Spotify, and discover what friends are finding. The feedback loop improves recommendations over time.

GitHub repo: https://github.com/TenNineteenOne/flipside

---

## Stack

- **Next.js 14** (App Router, TypeScript)
- **NextAuth.js** — Spotify OAuth (sole identity provider, no separate accounts)
- **Supabase** — PostgreSQL database + real-time subscriptions
- **Vercel** — deployment + cron jobs for daily feed refresh
- **Spotify Web API** — top artists, related artists, recommendations, 30s preview URLs, playlist management

---

## Architecture

```
Browser (Next.js React)
  ↕
Next.js API Routes (server-side — Spotify tokens never exposed to client)
  ↕                    ↕
Spotify API        Supabase DB
(music data)       (users, groups, feedback, cache)
```

### MusicProvider Interface (critical for Last.fm future support)

All recommendation logic talks to a `MusicProvider` interface, never to Spotify directly. This is the most important architectural seam in the app.

```typescript
interface MusicProvider {
  getTopArtists(userId: string, term: 'short' | 'medium' | 'long'): Promise<Artist[]>
  getRelatedArtists(artistId: string): Promise<Artist[]>
  getPlayHistory(userId: string): Promise<PlayHistory[]>
  searchArtists(query: string): Promise<Artist[]>
  getArtistTopTracks(artistId: string, limit: number): Promise<Track[]>
  createPlaylist(userId: string, name: string): Promise<string>
  addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void>
}
```

`SpotifyProvider` implements this interface. `LastFmProvider` will implement the same interface when added — no other code changes required.

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

-- Cold start: manually selected seed artists shown during onboarding
seed_artists (
  id uuid PK,
  user_id uuid FK users,
  spotify_artist_id text,
  name text,
  image_url text,
  added_at timestamptz
)

-- Daily-refreshed recommendation cache
recommendation_cache (
  id uuid PK,
  user_id uuid FK users,
  spotify_artist_id text,
  artist_data jsonb,                  -- name, genres, image, top 3 tracks, preview URLs
  score float,                        -- ranking score (boosted by feedback + friend signals)
  why text,                           -- "Because you like X" explanation
  seen_at timestamptz,                -- null = not yet shown to user
  expires_at timestamptz,             -- seen items expire after 7 days; unseen items after 30 days
  source text,                        -- 'spotify_related' | 'spotify_recommendations' | 'seed'
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

-- Saves (also treated as implicit thumbs_up)
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
  -- Note: records persist when user leaves group (historical data retained)
)
```

---

## Recommendation Engine

Runs as a daily Vercel Cron job (or Supabase Edge Function). For each user:

1. **Fetch listening history** via `MusicProvider.getTopArtists()` (short, medium, long term)
2. **Seed fallback**: if history is sparse, include `seed_artists` from onboarding
3. **Expand**: for each top/seed artist, call `MusicProvider.getRelatedArtists()`
4. **Filter**: remove any artist where user's play count exceeds their `play_threshold`
5. **Filter**: remove thumbs-down'd artists (feedback where signal='thumbs_down' and deleted_at IS NULL)
6. **Score**: base score from Spotify popularity + relationship proximity
7. **Boost**: +score for artists related to thumbs-up'd artists and saves
8. **Boost**: +score for artists that group members have thumbs-up'd or saved
9. **Deduplicate** and rank
10. **Fetch top 3 tracks** per artist via `MusicProvider.getArtistTopTracks(artistId, 3)`
11. **Write** to `recommendation_cache`, replacing previous day's unseen items

---

## Key Pages & Routes

### Pages
| Route | Description |
|---|---|
| `/` | Landing page with "Connect Spotify" button |
| `/onboarding` | Seed artist picker (3–5 artists); shown when listening history is sparse |
| `/feed` | Main discovery feed; group filter tabs if user is in multiple groups |
| `/groups` | List user's groups; create group button |
| `/join/[code]` | Join group via invite link (works before or after auth) |
| `/settings` | Play threshold, hidden artists list (undo thumbs down), playlist selection |

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

---

## UX Details

**Artist card** (feed item):
- Artist name, genres, avatar image
- "Because you like [Artist X]" — sourced from `recommendation_cache.why`
- Friend overlap: "Jordan and Alex also like this" (from group_activity)
- 3 preview tracks with inline play/pause (HTML5 `<audio>` + Spotify `preview_url`)
- Thumbs up / Thumbs down / Save buttons

**Thumbs down flow**:
- Card immediately shows an "Undo" toast overlay for 5 seconds
- User can tap Undo to cancel — card returns to normal state
- After 5 seconds, card slides out and artist is added to feedback table
- Full hidden artists list available in Settings → Hidden Artists

**Feed behavior**:
- Seen-but-not-reacted artists expire after 7 days (can resurface if friend boosts them)
- Thumbs-down'd artists are permanently hidden (recoverable via Settings)
- Feed sorted by score; refreshed daily in background

**Groups**:
- Max 10 members per group
- Any member can share the invite link
- Users can be in multiple groups; feed has per-group filter tabs
- Past reactions/saves stay in group_activity when a member leaves

**Cold start**:
- Detect sparse history (< 5 top artists) after Spotify login
- Show onboarding seed picker: search Spotify artists, pick 3–5
- Seeds used as additional starting points in recommendation engine
- Seeds fade in weight as real history accumulates

**Saves**:
- First save auto-creates "Discovered via Flipside" playlist in user's Spotify
- Playlist ID stored in `users.flipside_playlist_id`
- User can point to a different playlist in Settings

---

## Background Jobs

**Daily feed refresh** (Vercel Cron `0 3 * * *` — 3am UTC):
- For each user: run recommendation engine, write new cache entries
- Mark expired cache entries (seen > 7 days ago)

---

## Future: Last.fm Integration

When adding Last.fm:
1. Write `LastFmProvider` implementing the `MusicProvider` interface
2. Add `music_provider` field to `users` table (`'spotify' | 'lastfm'`)
3. Auth: add Last.fm OAuth via NextAuth (separate provider)
4. Feed builder picks provider based on user setting — zero changes to scoring/ranking logic
5. Users who connect both get merged history (de-duped by artist name/MusicBrainz ID)

The interface is documented with this future use in mind. Keep `MusicProvider` methods generic (no Spotify-specific types in signatures).

---

## Verification Checklist

- [ ] Spotify OAuth login → user record created in Supabase
- [ ] Sparse history → onboarding seed picker appears
- [ ] Seed picker → selected artists appear in recommendation engine input
- [ ] Feed loads → all artists absent from user's Spotify history (per threshold)
- [ ] Thumbs down → undo toast appears, then card slides out after 5s
- [ ] Undo → card restored, no feedback record written
- [ ] Settings → Hidden Artists list shows thumbs-down'd artists, restore works
- [ ] 3 preview tracks → each plays inline without leaving the app
- [ ] Save → track added to Flipside playlist in user's Spotify account
- [ ] Create group → invite link generated, shareable by any member
- [ ] Friend joins via link → appears in group, their activity surfaces in your feed
- [ ] Daily cron → recommendation cache rebuilt, feed updated next load
- [ ] Multiple groups → filter tabs visible in feed, per-group view works
- [ ] Leave group → historical group_activity records remain for other members
