# PRD: Flipside — Music Discovery App for Friend Groups

## Problem Statement

Discovering genuinely new music is hard without social media. Streaming platforms surface the same popular artists over and over, and algorithmic playlists rarely introduce artists you've truly never heard. The social layer that used to make music discovery fun — friends sharing finds, seeing what your circle is into — has largely moved to platforms people are stepping away from. There's no lightweight, private tool that combines your actual listening history with your friend group's taste to surface artists you've never played.

## Solution

Flipside is a responsive web app that connects to your Spotify account, analyzes your listening history, and shows you a daily feed of artists you've never played — filtered, ranked, and enriched by social signal from a small private friend group. You can preview three tracks per artist, thumbs up or down, save to a Spotify playlist, and see what your friends are discovering. Feedback improves future recommendations over time. The app is designed for small, private friend groups (up to 10 people), not a public social network.

## User Stories

1. As a user, I want to sign in with my Spotify account so that I don't need to create a separate username and password.
2. As a new user with sparse listening history, I want to pick 3–5 seed artists during onboarding so that the app has enough signal to generate recommendations from day one.
3. As a user, I want to see a daily feed of artists I've never played so that I can discover genuinely new music.
4. As a user, I want to understand why each artist was recommended (e.g., "because you like Snail Mail") so that I can evaluate whether the suggestion is relevant.
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
17. As a user, I want a seen-but-ignored artist to resurface if enough friends interact with it so that socially significant artists get a second chance.
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
28. As a user, I want my seed artists from onboarding to fade in influence as my real listening history builds up so that early choices don't permanently constrain my recommendations.

## Implementation Decisions

### Architecture
- **Next.js 14** (App Router, TypeScript) for both frontend and API routes
- **NextAuth.js** for Spotify OAuth — Spotify is the sole identity provider, no separate accounts
- **Supabase** (PostgreSQL + real-time subscriptions) for persistence and live feed updates
- **Vercel** for deployment and daily cron jobs
- **Spotify Web API** for top artists, related artists, recommendations, 30s preview URLs, and playlist management

### MusicProvider Interface
All recommendation logic communicates through a `MusicProvider` interface, never directly to Spotify. This is the primary extensibility seam for future Last.fm support. Methods: `getTopArtists`, `getRelatedArtists`, `getPlayHistory`, `searchArtists`, `getArtistTopTracks`, `createPlaylist`, `addTracksToPlaylist`. `SpotifyProvider` implements this. `LastFmProvider` will implement the same interface with no changes required to the rest of the app.

### Data Model (key tables)
- `users` — spotify_id, play_threshold, flipside_playlist_id
- `groups` — name, invite_code (shareable by any member), max 10 members
- `group_members` — group_id, user_id, joined_at
- `seed_artists` — user_id, spotify_artist_id (onboarding selections)
- `recommendation_cache` — user_id, artist_data (jsonb), score, why, seen_at, expires_at
- `feedback` — user_id, spotify_artist_id, signal (thumbs_up/thumbs_down), deleted_at (soft delete for undo)
- `saves` — user_id, spotify_artist_id, spotify_track_id
- `group_activity` — user_id, group_id, spotify_artist_id, action_type (thumbs_up/save); persists after member leaves

### Recommendation Engine (daily cron)
1. Fetch top artists via MusicProvider (short/medium/long term) + seed artists for cold start
2. Expand to related artists via MusicProvider
3. Filter: remove artists exceeding user's play_threshold; remove active thumbs-down'd artists
4. Score: Spotify popularity + relationship proximity
5. Boost: +score for artists related to thumbs-up'd artists/saves; +score for artists group members reacted to
6. Fetch top 3 tracks per artist
7. Write to recommendation_cache (daily refresh, replaces unseen items)

### Key Routes
- `/` landing, `/onboarding` seed picker, `/feed` main feed, `/groups` group management, `/join/[code]` invite join, `/settings` threshold + hidden artists + playlist
- API: `/api/recommendations`, `/api/feedback`, `/api/feedback/[artistId]` (DELETE = undo), `/api/saves`, `/api/groups`, `/api/groups/join`, `/api/groups/[id]/activity`

### Thumbs Down UX
Card shows an inline Undo overlay for 5 seconds. If tapped, card is restored immediately and no feedback record is written. After 5 seconds, card slides out and artist is recorded in `feedback` table with soft-delete support (`deleted_at` is null while active).

### Social Layer
Only explicit actions (thumbs_up, save) are shared with the group via `group_activity`. Raw listening history is never exposed. Friend activity appears inline in the feed ("Jordan also likes this") via Supabase real-time subscriptions — no push notifications.

## Testing Decisions

A good test verifies observable behavior from the outside, not internal implementation details. Tests should exercise the system as a user or API caller would — not mock internal module calls or assert on private state.

Modules to test:
- **Recommendation engine** — given a set of top artists, feedback signals, and group activity, assert on the scored/ranked output. Use fixture data, not live Spotify API calls.
- **MusicProvider interface** — unit test `SpotifyProvider` against Spotify API responses using recorded fixtures (VCR-style or mock HTTP). Ensures the interface contract is met without live network calls.
- **API routes** — integration tests for `/api/recommendations`, `/api/feedback`, `/api/saves`, `/api/groups/join` against a test Supabase instance.
- **Feed expiry logic** — assert that seen items expire after 7 days and resurface correctly when friend boost score crosses threshold.

## Out of Scope

- Native iOS or Android app (responsive web only for now)
- Last.fm integration (MusicProvider interface is the seam; implementation deferred)
- Push notifications of any kind
- Public profiles or discovery beyond your private group
- Track-level recommendations (artist-level only, with 3 preview tracks per card)
- In-app Spotify full playback control (30s previews only)
- Per-save playlist picker (one configurable destination playlist)
- Group sizes larger than 10 members

## Further Notes

- The `MusicProvider` interface should be documented thoroughly — it is the contract that Last.fm will implement. Keep method signatures generic (no Spotify-specific types).
- When adding Last.fm: add `music_provider` field to `users`, add Last.fm OAuth provider to NextAuth, write `LastFmProvider`. Users with both connected get merged history de-duped by MusicBrainz ID.
- Vercel Cron fires at 3am UTC daily to rebuild recommendation caches.
- The app should be deployed to Vercel from https://github.com/TenNineteenOne/flipside.
- `.superpowers/` should be added to `.gitignore`.
