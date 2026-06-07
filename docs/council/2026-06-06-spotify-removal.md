# Council + Reviews — Spotify-API-Independence Plan (2026-06-06)

Decision: highest-confidence path to drive flipside's shared-Spotify-key ratelimit risk to
~zero, ideally without a full DB-key migration. Pressure-tested via a 5-adviser llm-council
+ 2 adversarial code-verified reviews. (Generic technical decision — Compendium
ledger/verdict-block steps skipped.)

## Five advisers (theses)
- **Contrarian:** Phase 1 secretly requires Phase 3. `writeScored` puts `artist.id` into the
  NOT NULL `spotify_artist_id` conflict key; Last.fm gives no Spotify id → empty/garbage
  writes, broken thumbs-down dedup, cross-user cache poison, MusicBrainz 1 req/s can't
  backfill 90 names in a serverless window. Worst case: two disjoint id namespaces, dirty
  data, forced migration later. **Order is reversed — define the id type first.**
- **First-Principles:** Discard "Spotify id must be the identity" (a fossil from the old
  Spotify-login era). Irreducible needs: stable key (MBID or name), a preview (iTunes,
  solved), an open-link (search-URL works). Phase 1 hits zero *calls* but not zero *id
  dependency* — fix with a synthetic prefixed key (`mb:<mbid>`) available synchronously +
  background merge. Schema need not move; the *meaning* of the column must.
- **Expansionist:** The real prize is MBID-as-identity → platform-agnostic. MB url-rels
  returns Spotify+Apple+Deezer+Tidal+Wikidata in one keyless call; `preferred_music_platform`
  becomes load-bearing; serve non-Spotify listeners that Spotify-keyed apps can't. Treat the
  migration as the goal, Phase 1 as the enabler.
- **Outsider:** Why an "Open in Spotify" button at all when login isn't Spotify and users
  pick a platform? Why key the DB on a competitor's id? Why per-keystroke search? Why fetch
  images? The plan's complexity is downstream of not wanting to rename a column.
- **Executor:** 7-day sequence — Mon onboarding cache-first+Last.fm; Tue resolver swap; Wed
  id-resolver; Thu iTunes images; Fri the smoke test (unset Spotify creds, 0 calls); Sat
  Deezer Vercel spike; Sun MB backfill. (NOTE: his Tue step `id = mbid || ""` is exactly the
  bug the reviews caught — confirms the peer-check value.)

## Two adversarial reviews (code-verified)
- **Architecture review — confidence 15% as written.** BLOCKERS: `isValidSpotifyId`
  (`/^[a-zA-Z0-9]{22}$/`) guards 9 routes → non-Spotify id = HTTP 400 on every card action;
  `recommendation_cache.spotify_artist_id` NOT NULL; `artist-name-cache.write` poisons the
  cross-user cache; `seed-artist-validation` rejects non-Spotify seeds; `getSpotifyTopTracks`
  fallback would 404-trip the breaker on MBID ids. Phase 3 schema work is a *prerequisite*.
- **Ops/dependency review — 90% to "Spotify calls→0", 35% to "ratelimit→~zero".** The swap
  *moves* the SPOF to Last.fm (up to ~90 un-cached `artist.getInfo` + new `artist.search`
  per cold gen, vs ~5 req/s limit; `runLastfm` has no spacing). Required: cache + collapse
  `artist.search`/`getInfo`, add spacing, add per-endpoint counters, global MB rate-limiter,
  pre-warm cache. iTunes = album art not artist photos. Deezer ToS = categorical commercial
  blocker. (Reviewer got a Deezer 200 once; orchestrator's own tests failed → inconsistent.)

## Orchestrator verification (read the code)
Confirmed: the regex, the 9 guard sites, NOT NULL columns, the name-cache write, the upsert
key. The hinge finding is real.

## Chairman's call
**Sequence two stages; do NOT swap the resolver before the identity work.**
- **Stage 1 (ship now, high conf):** onboarding debounce + cache-first + Last.fm typeahead;
  aggressive offline `artist_search_cache` pre-warm (the biggest, schema-free ratelimit
  lever); cache+collapse Last.fm search/getInfo; add spacing + counters. → *greatly reduced*.
- **Stage 2 (to hit zero, med-high conf):** relax the id key to `isValidArtistKey`
  (Spotify-id preferred, `mb:`/`name:` accepted) **first**, then move the generation/history
  resolver to Last.fm with async MB Spotify-id backfill (global 1 req/s limiter) for the
  open-link. Gate on a localhost test that exercises thumbs/save/dismiss, not just feed gen.
- **One strongest reason:** the resolver swap is cheap; the id key is load-bearing across 9
  routes + NOT NULL columns + dedup — so identity must change first or cards break silently.
- **Biggest risk:** Last.fm becomes the new SPOF unless search is cached/collapsed/spaced.
- **7-day next step:** Stage 1 onboarding + cache pre-warm + Last.fm counters on a branch;
  localhost-verify Spotify call-count drop with Last.fm count ≤ baseline.

Full plan: `docs/spotify-removal-plan.md` (v2). Deezer remains opt-in/unverified.
