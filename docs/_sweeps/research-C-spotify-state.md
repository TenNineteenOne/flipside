# Research: Current State of Spotify Web API & Similarity Alternatives (2026)

**Compiled:** 2026-06-06  
**Purpose:** Inform flipside's roadmap for reducing Spotify API dependence while retaining "Open in Spotify" links.

---

## 1. November 2024 API Changes — What Was Deprecated/Restricted

**Confidence: High** | Source: [Spotify Dev Blog, 2024-11-27](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) | [TechCrunch](https://techcrunch.com/2024/11/27/spotify-cuts-developer-access-to-several-of-its-recommendation-features/)

Effective **November 27, 2024**, Spotify restricted the following for new/development-mode apps. These are not removed from the infrastructure — they are access-gated to apps that already had extended quota mode approval before the cutoff.

### Restricted Endpoints (new apps cannot use):

| Endpoint | Path | Status for New Apps |
|---|---|---|
| Related Artists | `GET /v1/artists/{id}/related-artists` | BLOCKED |
| Recommendations | `GET /v1/recommendations` | BLOCKED |
| Audio Features | `GET /v1/audio-features/{id}` | BLOCKED |
| Audio Analysis | `GET /v1/audio-analysis/{id}` | BLOCKED |
| Featured Playlists | `GET /v1/browse/featured-playlists` | BLOCKED |
| Category Playlists | `GET /v1/browse/categories/{id}/playlists` | BLOCKED |
| Curated/Editorial Playlists | various | BLOCKED |
| 30s preview_url (multi-get) | `SimpleTrack` object | BLOCKED |

**Exception:** Apps with *existing* extended quota mode approval before Nov 27, 2024 remain unaffected.

**Spotify's stated reason:** Preventing data scraping and AI training dataset extraction. The restricted features expose listener behavior patterns (similar-artist graphs, recommendation signals).

**Preview URLs specifically:** Developer reports confirm `preview_url` is consistently `null` for client-credentials apps. This predates the Nov 2024 change — the field has been unreliable since at least mid-2024, with community threads confirming `null` returns are the norm for client-creds flows. As of 2025-2026, treat `preview_url` as effectively dead for client-credentials use.

---

## 2. February 2026 API Changes — Additional Removals

**Confidence: High** | Source: [Spotify Feb 2026 Changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) | [Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)

A second wave of removals took effect around **February 2026** (migration deadline March 9, 2026):

### Additional Removed Endpoints (Feb 2026):

| Endpoint | Notes |
|---|---|
| `GET /artists/{id}/top-tracks` | Removed entirely |
| `GET /browse/new-releases` | Removed |
| `GET /browse/categories` and `/{id}` | Removed |
| `GET /artists` (batch/multi-get) | Use individual calls instead |
| `GET /tracks`, `/albums`, `/episodes`, `/shows`, `/audiobooks` (batch) | Use individual calls |
| `GET /users/{id}` | Use `/me` instead |
| `GET /users/{id}/playlists` | Use `/me` instead |
| `GET /markets` | Removed |

### Field Removals from Artist Object (Feb 2026):

- `followers` — removed
- `popularity` — removed from Artist object (was already marked Deprecated)

**genres and images: NOT removed in Feb 2026.** The migration guide does not mention them as removed fields. However, the `/v1/artists/{id}` reference page marks both `genres` and `popularity` as **Deprecated** (still returned, may be removed in a future wave). Images remain present and unmarked for deprecation.

### Search Restrictions (Feb 2026):
- `limit` parameter max reduced from 50 → **10**
- Default `limit` reduced from 20 → **5**

---

## 3. What Still Works with Client-Credentials in 2026

**Confidence: High** | Sources: [Spotify API Reference](https://developer.spotify.com/documentation/web-api/reference/get-an-artist) | [State of Spotify Web API 2025](https://spotify.leemartin.com/) | [dev.to report](https://dev.to/leemartin/the-state-of-spotify-web-api-report-2025-4gh3)

### STILL WORKS vs GONE — Client-Credentials, 2026

| Feature | Endpoint | Works? | Notes |
|---|---|---|---|
| Artist search | `GET /v1/search?type=artist` | YES | Limit now max 10 per page |
| Get single artist | `GET /v1/artists/{id}` | YES | |
| Artist genres | via artist object | YES (deprecated) | Marked deprecated; reliability degraded since Mar 2025 — some artists returning 0-1 genres |
| Artist images | via artist object | YES | Not deprecated |
| Artist popularity | via artist object | NO (Feb 2026 removal) | Removed from artist object |
| Artist followers | via artist object | NO (Feb 2026 removal) | Removed |
| Related Artists | `GET /v1/artists/{id}/related-artists` | NO | Blocked Nov 2024 |
| Recommendations | `GET /v1/recommendations` | NO | Blocked Nov 2024 |
| Audio Features | `GET /v1/audio-features/{id}` | NO | Blocked Nov 2024 |
| Audio Analysis | `GET /v1/audio-analysis/{id}` | NO | Blocked Nov 2024 |
| Get Artist Top Tracks | `GET /artists/{id}/top-tracks` | NO | Removed Feb 2026 |
| 30s preview_url | track objects | NO (effectively) | Null for client-creds flows |
| Batch get artists | `GET /artists?ids=...` | NO | Removed Feb 2026 |

**Summary for flipside:** Artist search, single artist lookup, genres (fragile, deprecated), and images still work. Popularity is gone. Everything discovery-related is gone.

---

## 4. Rate Limits & Development Mode (2026)

**Confidence: High** | Sources: [Spotify Rate Limits docs](https://developer.spotify.com/documentation/web-api/concepts/rate-limits) | [Quota Modes docs](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) | [TechCrunch Feb 2026](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/) | [Extended Access blog](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access)

### Rate Limit Mechanics
- Rolling **30-second window** (not per-minute or per-day)
- Spotify does **not publish exact numbers** — they are undisclosed and differ by mode
- 429 responses include a `Retry-After` header (in seconds) — must honor it
- Some endpoints have custom per-endpoint rate limits separate from the app-wide limit

### Development Mode (what flipside is in)
- **User cap:** Reduced from 25 → **5 users** as of February 2026
- **Premium requirement:** App owner must have active Spotify Premium; if Premium lapses, app stops working
- **One Client ID per app:** New apps limited to 1 Client ID (existing apps grandfathered)
- Rate limits are significantly lower than extended quota mode (Spotify doesn't publish exact dev-mode numbers)

### Extended Quota Mode (what flipside cannot get)
As of **May 15, 2025**, Spotify requires extended-quota applicants to be:
- A **legally registered organization** (individuals no longer eligible)
- Minimum **250,000 monthly active users**
- Active launched service in key Spotify markets
- Apply via company email

This effectively locks out every indie/startup project from extended access.

### Implications for flipside (single shared key)
Client-credentials apps share the rolling-window quota across all requests. With one key serving all users, any bursty traffic hits the shared cap. Retry-After durations are not published but developer reports suggest seconds to tens of seconds. The combination of dev-mode caps + shared key = throttle risk under any meaningful load. Caching is the primary mitigation.

---

## 5. "Open in Spotify" Links — Zero-API Strategies

**Confidence: High (canonical format)** | Sources: [Spotify URIs docs](https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids) | [Spotify Community FAQ](https://community.spotify.com/t5/FAQs/Basics-of-a-Spotify-URL/ta-p/919201)

### Canonical Artist URL (requires ID)

```
https://open.spotify.com/artist/{spotify_artist_id}
```

The `{spotify_artist_id}` is a 22-character Base62 string (e.g., `7dGJo4pcD2V6oG08qCgod6`). This is the only deep-link format that goes directly to an artist profile. **If you have the ID from a prior API call, no further API calls are needed to generate this link.**

### Fallback Strategies (No Artist ID Required)

**Strategy A — open.spotify.com search URL (name-only)**  
The Spotify web player supports a search deep link:
```
https://open.spotify.com/search/{artist_name}
```
Or with type filter (observed from the web player):
```
https://open.spotify.com/search/results/artist:{artist_name}
```
Example: `https://open.spotify.com/search/Radiohead` opens Spotify (app or web) to a search for "Radiohead". **Confidence: Med** — these URL patterns are inferred from observed web player behavior; Spotify does not officially document them. They work in practice but could change without notice.

**Strategy B — Spotify URI for deeplink into app**  
```
spotify:search:{artist_name}
```
This launches the Spotify app directly to a search (if installed). Falls back gracefully on web. No API needed, no ID needed.

**Strategy C — Cache the ID, link without further API calls**  
The most reliable approach: store the artist's Spotify ID at search time (when you already call the API for metadata), then generate `open.spotify.com/artist/{id}` links forever from the cache. Zero ongoing API dependency.

**Strategy D — Encode artist name in search URL**  
URL-encode the artist name and append to `https://open.spotify.com/search/`:
```javascript
const url = `https://open.spotify.com/search/${encodeURIComponent(artistName)}`;
```
This is the safest zero-API fallback when no cached ID exists. Lands on search results, not the exact artist profile, but keeps the user within Spotify's ecosystem.

### Recommendation for flipside
- **Primary:** Cache Spotify artist ID at onboarding/search time; use `open.spotify.com/artist/{id}` links.
- **Fallback (no cached ID):** Use `open.spotify.com/search/{encodedName}` — zero API calls, always works.
- **Do not** rely on preview_url for any in-app playback.

---

## 6. Similarity/Recommendation Alternatives Landscape (2026)

**Confidence: Med** | Sources: [Last.fm API docs](https://www.last.fm/api/show/artist.getSimilar) | [ListenBrainz docs](https://listenbrainz.readthedocs.io) | [ListenBrainz similar-artists lab](https://labs.api.listenbrainz.org/similar-artists) | [State of Spotify API 2025](https://dev.to/leemartin/the-state-of-spotify-web-api-report-2025-4gh3)

With Spotify's Related Artists and Recommendations endpoints blocked for new apps, the indie developer ecosystem has converged on these alternatives:

**Last.fm `artist.getSimilar`** — The most-used drop-in replacement. Free, no authentication required, takes artist name directly (no external ID needed). Returns a ranked list with `match` scores (0–1). Rate limit: 5 req/IP/second averaged over 5 minutes. Requires a free Last.fm API key. Reliability is good for mainstream artists; coverage thins for niche/regional acts. This is likely the best fit for flipside given it already integrates Last.fm scrobbling history.

**ListenBrainz Similar Artists** — Open-source, community-driven. REST endpoint at `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids={mbid}`. Requires MusicBrainz IDs (not Spotify IDs — needs an ID resolution step via MusicBrainz API). Multiple algorithm variants available (session-based, varying time windows). No auth needed. Coverage is growing but thinner than Last.fm for many artists. Best for open/ethical-data positioning.

**Deezer `GET api.deezer.com/artist/{id}/related`** — Deezer's catalog API is largely unauthenticated for read-only calls. The `related` endpoint returns artists Deezer considers similar. Requires Deezer artist IDs (another ID mapping step). Good complement since Deezer doesn't throttle the same key as Spotify. **Confidence: Med** — Deezer's specific related-artists endpoint behavior in 2026 was not directly verifiable from public documentation fetched.

**MusicBrainz + AcousticBrainz (legacy)** — AcousticBrainz shut down in 2022. MusicBrainz has artist relationship data but not a similarity-scored endpoint.

**Embedding-based approaches** — Some indie devs are building similarity from Last.fm play-count vectors or genre embeddings (e.g., using OpenAI embeddings on genre/tag text). Requires upfront computation but no ongoing per-query API dependency.

**Apple Music / iTunes** — No public similar-artists API. iTunes Search API is useful for metadata/search but provides no similarity graph.

**For flipside specifically:** Last.fm `artist.getSimilar` is the lowest-friction replacement for Spotify Related Artists — it uses the artist name (already known), needs no ID mapping, requires no user auth, and aligns with flipside's existing Last.fm integration.

---

## Key Findings Summary for flipside

1. **Related Artists and Recommendations are permanently inaccessible** for any app without pre-Nov-2024 extended quota approval. Do not attempt workarounds.
2. **Artist search and single-artist lookup still work** with client-credentials. Genres (fragile/deprecated) and images are still returned; popularity is gone as of Feb 2026.
3. **preview_url is effectively dead** for client-credentials flows — treat it as null.
4. **Rate limits are opaque but painful** — dev mode is significantly capped, shared key compounds risk; aggressive caching is mandatory.
5. **"Open in Spotify" links need zero API calls** — cache the ID at search time for `open.spotify.com/artist/{id}`; fall back to `open.spotify.com/search/{name}` when no ID is cached.
6. **Last.fm `artist.getSimilar`** is the best drop-in replacement for similarity — free, no auth, name-based, already within flipside's existing Last.fm integration.

---

## Sources

- [Spotify Dev Blog: Changes to the Web API (Nov 2024)](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
- [Spotify February 2026 Changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
- [Spotify February 2026 Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify Rate Limits Documentation](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [Spotify Quota Modes Documentation](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify: Updating Criteria for Extended Access (Apr 2025)](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access)
- [Spotify Get Artist API Reference](https://developer.spotify.com/documentation/web-api/reference/get-an-artist)
- [TechCrunch: Spotify cuts developer access (Nov 2024)](https://techcrunch.com/2024/11/27/spotify-cuts-developer-access-to-several-of-its-recommendation-features/)
- [TechCrunch: Spotify Feb 2026 dev mode changes](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/)
- [State of Spotify Web API Report 2025 (Lee Martin)](https://spotify.leemartin.com/)
- [dev.to: State of Spotify Web API 2025](https://dev.to/leemartin/the-state-of-spotify-web-api-report-2025-4gh3)
- [Last.fm artist.getSimilar API docs](https://www.last.fm/api/show/artist.getSimilar)
- [ListenBrainz Similar Artists Lab](https://labs.api.listenbrainz.org/similar-artists)
- [ListenBrainz API Documentation](https://listenbrainz.readthedocs.io/en/latest/users/api/core.html)
- [Music Ally: Spotify removes features citing security (Nov 2024)](https://musically.com/2024/11/28/spotify-removes-features-from-web-api-citing-security-issues/)
- [Spotify URIs and IDs documentation](https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids)
