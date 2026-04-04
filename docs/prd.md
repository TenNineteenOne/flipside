# PRD: Flipside — Music Discovery App for Friend Groups

## Problem Statement

Discovering genuinely new music is hard without social media. Streaming platforms surface the same popular artists over and over, and algorithmic playlists rarely introduce artists you've truly never heard. The social layer that used to make music discovery fun — friends sharing finds, seeing what your circle is into — has largely moved to platforms people are stepping away from. There's no lightweight, private tool that combines your actual listening history with your friend group's taste to surface artists you've never played.

## Solution

Flipside is a responsive web app that connects to your Spotify account, analyzes your listening history, and shows you a daily feed of artists you've never played — filtered, ranked, and enriched by social signal from a small private friend group. You can preview three tracks per artist, thumbs up or down, save to a Spotify playlist, and see what your friends are discovering. Feedback improves future recommendations over time. The app is designed for small, private friend groups (up to 10 people), not a public social network.

## User Stories

1. As a user, I want to sign in with my Spotify account so that I don't need to create a separate username and password.
2. As a new user with sparse listening history, I want to pick 3–5 seed artists during onboarding so that the app has enough signal to generate recommendations from day one.
3. As a user, I want to see a daily feed of artists I've never played so that I can discover genuinely new music.
4. As a user, I want to understand why each artist was recommended (e.g., "because you like Snail Mail · indie rock") so that I can evaluate whether the suggestion is relevant.
5. As a user, I want to listen to three preview tracks per artist without leaving the app so that I can get a real feel for their range before deciding.
6. As a user, I want to thumbs up an artist so that similar artists appear more often in my future recommendations.
7. As a user, I want to thumbs down an artist so that it disappears from my feed and similar artists appear less often.
8. As a user, I want an undo option immediately after thumbs-downing an artist so that I can recover from accidental taps without going into Settings.
9. As a user, I want thumbs-downed artists to slide out after a 5-second delay (not instantly) so that the undo action feels accessible and natural.
10. As a user, I want a "Hidden Artists" list in Settings so that I can review and restore any artist I previously thumbs-downed.
11. As a user, I want to save an artist to a Spotify playlist so that I can listen to them later in Spotify without losing the discovery.
12. As a user, I want the app to automatically create a "Discovered via Flipside" playlist in my Spotify on my first save so that I don't have to set anything up.
13. As a user, I want to configure which Spotify playlist saves go to in Settings so that I can use an existing playlist instead of the default one.
14. As a user, I want to adjust my "never played" threshold in Settings so that artists I've sampled only once or twice can still appear in my feed.
15. As a user, I want my feed to refresh daily so that I always have fresh recommendations without stale suggestions piling up.
16. As a user, I want artists I've scrolled past without reacting to age out after 7 days so that my feed doesn't fill with ignored suggestions.
17. As a user, I want a seen-but-ignored artist to resurface if at least 20% of my group members interact with it so that socially significant artists get a second chance.
18. As a user, I want to create a friend group and get a shareable invite link so that I can bring my friends into the app easily.
19. As a user, I want any group member (not just the creator) to be able to share the invite link so that adding new members doesn't bottleneck on one person.
20. As a user, I want to be in multiple groups so that I can have separate circles for different friend groups.
21. As a user, I want to see group filter tabs in my feed so that I can view all recommendations or drill into a specific group's activity.
22. As a user, I want to see when a friend saves or thumbs-ups an artist so that friend activity enriches my feed with social context.
23. As a user, I want friend activity to be passive (appearing in the feed naturally) rather than push notifications so that the app doesn't feel like an obligation.
24. As a user, I want my raw listening history to stay private so that only my explicit actions (saves, reactions) are visible to friends.
25. As a user, I want a friend's past saves and reactions to remain visible in the group after they leave so that historical social signal isn't lost.
26. As a user, I want the app to work well on my phone's browser so that I don't need to install a native app.
27. As a user, I want the recommendation engine to improve over time as I thumbs up and down artists so that the feed gets more relevant the more I use it.
28. As a user, I want my seed artists from onboarding to stop being used once I have enough real listening history so that early choices don't permanently constrain my recommendations.
29. As a user, I want to enter my Last.fm username so that the app can use my full scrobble history to more accurately filter out artists I've already heard.

## Implementation Decisions

### Architecture
- **Next.js 14** (App Router, TypeScript) for both frontend and API routes
- **NextAuth.js** for Spotify OAuth — Spotify is the sole identity provider, no separate accounts
- **Supabase** (PostgreSQL + real-time subscriptions) for persistence and live feed updates
- **Vercel** for deployment and daily cron jobs
- **Spotify Web API** for top artists, recommendations, 30s preview URLs, and playlist management
- **Last.fm API** (read-only, no OAuth) for similar artists and full scrobble history via username
- **Tailwind CSS + shadcn/ui** for UI components; dark mode only, blues/teals/purples palette

### MusicProvider Interface
All recommendation logic communicates through a `MusicProvider` interface, never directly to Spotify. Methods: `getTopArtists`, `getSimilarArtists`, `getRecentlyPlayed`, `searchArtists`, `getArtistTopTracks`, `createPlaylist`, `addTracksToPlaylist`. `SpotifyProvider` implements this interface. Note: Spotify deprecated `/artists/{id}/related-artists` — `getSimilarArtists` is implemented using Last.fm `artist.getSimilar` (unauthenticated) as the primary source and Spotify Recommendations API as a secondary source.

### Data Model (key tables)
- `users` — spotify_id, lastfm_username, play_threshold, flipside_playlist_id
- `groups` — name, invite_code (shareable by any member), max 10 members
- `group_members` — group_id, user_id, joined_at
- `seed_artists` — user_id, spotify_artist_id (onboarding selections; used until user has ≥10 Spotify top artists)
- `listened_artists` — user_id, spotify_artist_id, lastfm_artist_name, source (spotify_recent/spotify_top/lastfm), play_count, last_seen_at (private; never exposed to groups)
- `recommendation_cache` — user_id, artist_data (jsonb), score, why (jsonb), seen_at, expires_at
- `feedback` — user_id, spotify_artist_id, signal (thumbs_up/thumbs_down), deleted_at (soft delete for undo)
- `saves` — user_id, spotify_artist_id, spotify_track_id
- `group_activity` — user_id, group_id, spotify_artist_id, action_type (thumbs_up/save); persists after member leaves

### Recommendation Engine (daily cron + on-demand first load)
1. Fetch top artists via `MusicProvider.getTopArtists()` (short/medium/long term)
2. **Seed fallback**: if user has < 5 Spotify top artists, include `seed_artists` from onboarding. Seeds are ignored once user has ≥10 top artists.
3. **Expand**: for each top/seed artist, call `MusicProvider.getSimilarArtists()` (Last.fm) and Spotify Recommendations API. Engine can work at track level where it produces better results.
4. **Filter**: remove artists appearing in `listened_artists` where `play_count` exceeds user's `play_threshold`. Spotify history matched by `spotify_artist_id`; Last.fm history matched by normalized artist name.
5. **Filter**: remove thumbs-down'd artists (feedback where signal='thumbs_down' and deleted_at IS NULL)
6. **Score**: base score from Spotify popularity + relationship proximity
7. **Boost**: +score for artists related to thumbs-up'd artists and saves
8. **Boost**: +score for artists that group members have thumbs-up'd or saved
9. **Deduplicate** and rank
10. **Fetch top tracks** per artist via `MusicProvider.getArtistTopTracks()` — fetch up to 10, surface top 3
11. **Write** to `recommendation_cache` (daily refresh, replaces unseen items)
12. **Cron batching**: process users in batches of 10/min with exponential backoff on Spotify 429 responses

**First load**: engine runs on-demand after onboarding completes. User sees a loading state ("Building your first feed…"). All subsequent refreshes happen via cron at 3am UTC.

### Key Routes
- `/` landing, `/onboarding` seed picker, `/feed` main feed, `/groups` group management, `/join/[code]` invite join, `/settings` threshold + hidden artists + playlist + Last.fm username
- API: `/api/recommendations`, `/api/feedback`, `/api/feedback/[artistId]` (DELETE = undo), `/api/saves`, `/api/groups`, `/api/groups/join`, `/api/groups/[id]/activity`

### Thumbs Down UX
Card shows an inline Undo overlay for 5 seconds. If tapped, card is restored immediately and no feedback record is written. After 5 seconds, card slides out and artist is recorded in `feedback` table with soft-delete support (`deleted_at` is null while active).

### Social Layer
Only explicit actions (thumbs_up, save) are shared with the group via `group_activity`. Raw listening history (`listened_artists`) is never exposed. Friend activity appears inline in the feed ("Jordan also likes this") via Supabase real-time subscriptions — annotation only, no reordering of feed cards. Card order and scores only change on the next daily cron run. No push notifications.

### Pre-auth Invite Flow
When a user clicks `/join/[code]` before logging in, the invite code is stored in a cookie before initiating Spotify OAuth. After auth completes and the user record is created, the pending invite cookie is processed to auto-join the group before redirecting to the feed.

### Resurfacing Threshold
A seen-but-ignored artist resurfaces if `ceil(groupSize * 0.2)` other group members have thumbs-up'd or saved it after you ignored it. At 10 members this is 2; at 5 members this is 1. Calculated dynamically per group.

### why Field
`recommendation_cache.why` is stored as `jsonb`, not plain text. Structure:
```json
{
  "sourceArtists": ["Snail Mail", "Soccer Mommy"],
  "genres": ["indie rock", "lo-fi"],
  "friendBoost": ["Jordan", "Alex"]
}
```
Capped at 2 source artists and 2 genres. Frontend renders: "Because you like Snail Mail and Soccer Mommy · indie rock, lo-fi · Jordan also likes this."

### Row Level Security
RLS is enabled on all Supabase tables from day one. Users can only read/write their own rows in `users`, `feedback`, `saves`, `recommendation_cache`, `seed_artists`, `listened_artists`. Group activity is readable by group members only. `listened_artists` is never exposed via any group-readable policy.

## Testing Decisions

A good test verifies observable behavior from the outside, not internal implementation details. Tests should exercise the system as a user or API caller would — not mock internal module calls or assert on private state.

Modules to test:
- **Recommendation engine** — given a set of top artists, feedback signals, and group activity, assert on the scored/ranked output. Use fixture data, not live Spotify or Last.fm API calls.
- **MusicProvider interface** — unit test `SpotifyProvider` against Spotify API responses using recorded fixtures (VCR-style or mock HTTP). Ensures the interface contract is met without live network calls.
- **API routes** — integration tests for `/api/recommendations`, `/api/feedback`, `/api/saves`, `/api/groups/join` against a dedicated Supabase test project.
- **Feed expiry logic** — assert that seen items expire after 7 days and resurface correctly when friend boost score crosses the 20% threshold.
- **listened_artists accumulation** — assert that Spotify recently-played and Last.fm scrobbles are correctly merged at filter time via normalized artist name matching.

## Out of Scope

- Native iOS or Android app (responsive web only for now)
- Last.fm OAuth (username-only in Settings is sufficient; full OAuth deferred indefinitely)
- Push notifications of any kind
- Public profiles or discovery beyond your private group
- Track-level recommendations (artist-level only, with 3 preview tracks per card)
- In-app Spotify full playback control (30s previews only; tracks with null preview_url show a disabled play button)
- Per-save playlist picker (one configurable destination playlist)
- Group sizes larger than 10 members
- Swipe gestures on feed cards (buttons only for v1; card component built to support swipe later)

## Further Notes

- The `MusicProvider` interface should be documented thoroughly — keep method signatures generic (no Spotify-specific types). `getSimilarArtists` uses Last.fm under the hood but the interface remains provider-agnostic.
- Spotify deprecated `/artists/{id}/related-artists` in November 2024. Do not use it. Use Last.fm `artist.getSimilar` (unauthenticated, API key only) + Spotify Recommendations API instead.
- Last.fm API is public-read. No OAuth required. Store `lastfm_username` on the `users` table and validate against the Last.fm API when the user saves it in Settings.
- Vercel Cron fires at 3am UTC daily to rebuild recommendation caches. Process users in batches of 10/min with exponential backoff on 429 responses.
- The app should be deployed to Vercel from https://github.com/TenNineteenOne/flipside.
- `.superpowers/` should be added to `.gitignore`.
