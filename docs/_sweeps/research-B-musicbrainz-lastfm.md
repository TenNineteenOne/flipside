# Research B: Music Metadata APIs — MusicBrainz, Last.fm, ListenBrainz, Discogs, Deezer, Wikidata

**Date:** 2026-06-06  
**Scope:** Open/free alternatives and supplements to Spotify Web API for artist search, genres, images, popularity, 30s previews, stable IDs, similar artists. Special focus: obtaining Spotify artist ID/URL without calling the Spotify API.

---

## Comparison Table

| Capability | MusicBrainz | Last.fm | ListenBrainz | Discogs | Deezer | Wikidata |
|---|---|---|---|---|---|---|
| (a) Artist search by name | ✅ | ✅ | ❌ | ✅ | ✅ | partial |
| (b) Genres / tags | ✅ tags | ✅ tags | ✅ tags | ✅ genres+styles | partial (genre list only) | ✅ genres |
| (c) Popularity signal | ❌ | ✅ listener/play count | ✅ listen+listener count | ❌ | ✅ fans count | ❌ |
| (d) Artist images | ❌ | ❌ (dead — star placeholder) | ❌ | ✅ (OAuth required) | ✅ (no-store) | ✅ via P18→Commons |
| (e) 30s audio preview | ❌ | ❌ | ❌ | ❌ | ✅ (track-level, expiring URL) | ❌ |
| (f) Stable artist IDs | ✅ MBID | partial (artist name key) | ✅ MBID | ✅ Discogs ID | ✅ Deezer artist ID | ✅ QID |
| (g) Similar / related artists | ❌ (artist-rels ≠ similarity) | ✅ artist.getSimilar | ✅ Labs similar-artists | ❌ | ❌ | ❌ |
| Auth required | User-Agent (no key) | API key (free) | optional token | OAuth or key+secret | none (public endpoints) | none |
| Rate limit | 1 req/s per IP | ~5 req/s per IP | unstated | 60/min auth, 25/min anon | quota (unstated) | no stated limit |

---

## FEATURED: Getting Spotify Artist ID Without the Spotify API

This is the most important finding for flipside's "Open in Spotify" link requirement.

### Method 1 — MusicBrainz url-rels (HIGH confidence, verified live)

MusicBrainz stores streaming service links as "URL relationships" on artist records. The relationship type is called **"free streaming"** (type-id `769085a1-c2f7-4c24-a532-2375a77693bd`) and Spotify is cited as the canonical example. [(source)](https://musicbrainz.org/relationships/artist-url)

**Confirmed working — two real API calls verified 2026-06-06:**

**Flow A: MBID → Spotify URL**  
Given an artist's MBID, fetch their url-rels:

```
GET https://musicbrainz.org/ws/2/artist/5b11f4ce-a62d-471e-81fc-a69a8278c7da?inc=url-rels&fmt=json
```

Returns (Nirvana example, verified live):

```json
{
  "type": "free streaming",
  "type-id": "769085a1-c2f7-4c24-a532-2375a77693bd",
  "url": {
    "resource": "https://open.spotify.com/artist/6olE6TJLqED3rqDCT0FyPh",
    "id": "f6a499eb-5959-4861-95f1-13caec960006"
  },
  "direction": "forward",
  "target-type": "url"
}
```

The Spotify artist ID (`6olE6TJLqED3rqDCT0FyPh`) is embedded directly in the URL. Strip `https://open.spotify.com/artist/` → done.

**Flow B: Spotify URL → MBID (reverse lookup)**  
Given a Spotify artist URL, resolve to MBID:

```
GET https://musicbrainz.org/ws/2/url?resource=https://open.spotify.com/artist/3WrFJ7ztbogyGnTHbHJFl2&fmt=json&inc=artist-rels
```

Returns the MBID `b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d` (The Beatles), verified live 2026-06-06.

**Coverage caveat:** MusicBrainz is community-maintained. Spotify URL-rels are well-populated for mainstream artists but coverage is uneven for obscure/emerging acts. The community thread from 2017 cited ~11K Spotify IDs in MusicBrainz at that time; database has grown substantially since (now 2.9M artists total). Expect high hit rates for recognizable artists. [(source)](https://community.metabrainz.org/t/get-a-list-of-all-artists-with-wikidata-and-spotify-artist-id/344268) — **Confidence: High for popular artists, Med for long-tail.**

### Method 2 — Wikidata SPARQL (MED confidence)

Wikidata stores both MusicBrainz artist ID (property **P434**) and Spotify artist ID (property **P1902**) on the same item. The SPARQL endpoint at `https://query.wikidata.org/sparql` is free, keyless, and supports JSON responses.

**Query pattern to get Spotify ID from MBID:**

```sparql
SELECT ?spotifyId WHERE {
  ?artist wdt:P434 "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d" .
  ?artist wdt:P1902 ?spotifyId .
}
```

**Additional bonus:** Wikidata property **P18** (image) links to a Wikimedia Commons filename, from which you can derive a thumbnail URL via the Commons API:

```
https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url&iiurlwidth=500&titles=File:{filename}
```

**Coverage caveat:** As of 2017, Wikidata had ~135K items with P434 (MBID) and only ~5,320 with P1902 (Spotify ID). Even with growth, Wikidata's Spotify coverage is much thinner than MusicBrainz's url-rels. Best used as a fallback or complement. [(source)](https://www.wikidata.org/wiki/Property:P1902) — **Confidence: Med (good for notable artists, sparse for long-tail).**

### Recommended Strategy for Flipside

1. **Primary:** MusicBrainz url-rels lookup (MBID → url-rels → filter `"free streaming"` type → extract Spotify URL). Works without any API key.
2. **Fallback:** Wikidata SPARQL on P1902 (keyless, ~60s latency acceptable since this is a background enrichment step).
3. **Last resort:** Accept that ~5-15% of obscure artists may not have a Spotify URL in either database. Gracefully omit the "Open in Spotify" button rather than calling Spotify API.

---

## 1. MusicBrainz

**URL:** https://musicbrainz.org/doc/MusicBrainz_API  
**Auth:** No API key — but **User-Agent header is mandatory** (format: `AppName/version (contact-url-or-email)`). Requests without a proper User-Agent are blocked. [(source)](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)

### Rate Limits (as of 2012-01-08 policy, still current as of 2026-06-06)
- **1 req/s per IP** (averaged). Exceeding triggers HTTP 503 and blocks ALL requests from that IP until rate drops. [(source)](https://wiki.musicbrainz.org/MusicBrainz_API/Rate_Limiting) — **Confidence: High (official docs, unchanged since 2012)**
- 50 req/s per User-Agent string (shared across IPs using same UA)
- 300 req/s global cap

### Capability Checklist
- **(a) Artist search:** ✅ Full Lucene syntax. Fields: `artist:`, `alias:`, `tag:`, `type:`, `country:`, etc. Returns MBID, name, sort-name, country, disambiguation, aliases, tags, life-span. [(source)](https://musicbrainz.org/doc/MusicBrainz_API/Search)
- **(b) Genres/tags:** ✅ Include `tags` and `genres` in `inc=` parameter. Tags are user-contributed; genres are a curated subset. DB has 2,146 distinct genres, 239,538 distinct tags, 19.8M raw tag instances as of 2026-06-06. [(source)](https://musicbrainz.org/statistics)
- **(c) Popularity:** ❌ No listen counts. Ratings exist (`inc=ratings`) but sparse.
- **(d) Images:** ❌ No artist photos. Cover Art Archive only covers **release cover art**, not artist photos. [(source)](https://musicbrainz.org/doc/Cover_Art_Archive/API)
- **(e) 30s previews:** ❌
- **(f) Stable IDs:** ✅ MBID — permanent UUID, never reassigned.
- **(g) Similar artists:** ❌ `artist-rels` returns relationships to other artists (member-of, collaborated-with) but not a similarity score.

### ToS / Reliability
- Data is CC0 / open license. No commercial restrictions. [(source)](https://musicbrainz.org/doc/MusicBrainz_API/FAQ)
- DB has 2,892,734 artists, 5,549,970 releases, 39,072,910 recordings as of 2026-06-06.
- **Best role for flipside:** MBID anchor + Spotify URL resolution + tags/genres enrichment. First call in artist enrichment pipeline.

---

## 2. Last.fm API

**URL:** https://www.last.fm/api/intro  
**Auth:** Free API key required (registration form at last.fm/api). No approval needed for non-commercial use. Commercial use requires separate written agreement with partners@last.fm. [(source)](https://www.last.fm/api/tos)

### Rate Limits
- **5 req/s per IP** (averaged over 5-minute window) per ToS §4.4. Sustained higher rates risk account suspension. [(source)](https://www.last.fm/api/tos) — **Confidence: High (official ToS)**

### Capability Checklist
- **(a) Artist search:** ✅ `artist.search` — returns name, listeners count, MBID, URL.
- **(b) Genres/tags:** ✅ `artist.getTopTags` — returns user-contributed tags with counts. `artist.getInfo` also returns top tags.
- **(c) Popularity:** ✅ `artist.getInfo` returns `listeners` (unique) and `playcount` (total scrobbles). High-quality signal for mainstream artists.
- **(d) Images:** ❌ **CONFIRMED DEAD.** Last.fm removed artist images from their API circa 2019 following a Getty Images licensing dispute. All `image` fields in API responses now return a static star placeholder URL. This is still broken as of 2025-2026 per multiple active support threads. [(sources)](https://support.last.fm/t/last-fm-api-artist-getinfo-only-returns-placeholder-images-for-artists/117821) — **Confidence: High (multiple independent confirmations, official support thread)**
- **(e) 30s previews:** ❌
- **(f) Stable IDs:** partial — Last.fm returns MBIDs where available, but uses artist name as primary key.
- **(g) Similar artists:** ✅ `artist.getSimilar` — returns up to 250 similar artists with similarity score (0.0–1.0). Data derived from Last.fm user listening patterns. Good quality for mainstream artists.

### ToS Notes
- **Images expressly excluded:** "You will not use any audio, audiovisual, images and/or artwork, whether or not accessible through the API, and all such content is expressly excluded from this Agreement." [(source)](https://www.last.fm/api/tos)
- Attribution required: must link back to Last.fm artist/album/track pages.
- Data storage cap: 100 MB max without written consent.
- **Best role for flipside:** Listener/playcount popularity signal + artist.getSimilar + tags. Already in use — current integration is correctly scoped.

---

## 3. ListenBrainz

**URL:** https://listenbrainz.readthedocs.io  
**Auth:** No API key required for read endpoints. Free account token (`Authorization: Token {token}`) optional, provides higher rate limits and enables write operations. Metadata lookup endpoints now require auth token "because of possible abuse by AI scrapers." [(source)](https://listenbrainz.readthedocs.io/en/latest/users/api/metadata.html) — **Confidence: High (official docs, Jun 2026)**

### Rate Limits
Not explicitly published. MAX_ITEMS_PER_GET and MAX_LOOKUPS_PER_POST exist but numeric values not disclosed in docs.

### Capability Checklist
- **(a) Artist search:** ❌ No artist name search endpoint.
- **(b) Genres/tags:** ✅ `GET /1/metadata/artist/` returns tags via MusicBrainz data.
- **(c) Popularity:** ✅ `POST /1/popularity/artist` — returns `total_listen_count` and `total_user_count` per artist MBID. Also `GET /1/popularity/top-recordings-for-artist/{mbid}`. [(source)](https://listenbrainz.readthedocs.io/en/latest/users/api/popularity.html)
- **(d) Images:** ❌
- **(e) 30s previews:** ❌
- **(f) Stable IDs:** ✅ Uses MBIDs.
- **(g) Similar artists:** ✅ ListenBrainz Labs: `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids={mbid}&algorithm={algo}`. Six session-based algorithms with varying lookback periods (75 days to 9000 days). No auth required for Labs endpoints. [(source)](https://labs.api.listenbrainz.org/similar-artists) — **Confidence: High (live endpoint confirmed)**

### Data Quality
Derived from actual listening sessions of ListenBrainz users — smaller user base than Last.fm but growing. Similar-artist data quality is "somewhat limited" per their own documentation (not all historical data has been run through the algorithm). Coverage thinner for non-Western and obscure artists.

**Best role for flipside:** Listen-count popularity signal (complement/replace Spotify's popularity field) + similar artists (complement Last.fm getSimilar). Requires MBID as input — use MusicBrainz search first.

---

## 4. Discogs API

**URL:** https://www.discogs.com/developers  
**Auth:** Three methods: (1) unauthenticated — 25 req/min, no images; (2) Discogs Auth (consumer key+secret) — 60 req/min, includes image URLs; (3) OAuth flow — full user context. [(source)](https://www.discogs.com/forum/thread/1104957)

Image URLs in responses require at minimum consumer key+secret authentication. [(source)](https://www.discogs.com/forum/thread/401894)

### Rate Limits
- **Unauthenticated:** 25 req/min
- **Authenticated (key+secret or OAuth):** 60 req/min
- Moving average over 60-second window. Response headers `X-Discogs-Ratelimit` and `X-Discogs-Ratelimit-Used` track usage. — **Confidence: High (official docs)**

### Capability Checklist
- **(a) Artist search:** ✅ `GET /database/search?q={name}&type=artist` (requires consumer key+secret since August 2014). [(source)](https://www.discogs.com/forum/thread/399958)
- **(b) Genres/tags:** ✅ Artist endpoint returns `genres` array and `styles` array (sub-genres). These map to release genres, not freeform tags — more structured than Last.fm but narrower.
- **(c) Popularity:** ❌ No listener/play counts.
- **(d) Images:** partial — Artist endpoint returns `images` array with primary + secondary photos when authenticated. However: images may not be commercially reusable — they are "Restricted Data" under Discogs ToS and user-uploaded with unclear provenance. Discogs explicitly prohibits sublicensing content to third parties. [(source)](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use) — **Confidence: High (ToS confirmed)**
- **(e) 30s previews:** ❌
- **(f) Stable IDs:** ✅ Discogs artist ID (integer).
- **(g) Similar artists:** ❌

### ToS Risks on Images
Discogs images are "Restricted Data" — not CC0. Commercial display in a third-party app is a legal grey area. The ToS prohibits "sub-licensing the API or Content." Using Discogs images in flipside's UI carries meaningful ToS risk unless Discogs explicitly approves. **Do not use as a primary image source without legal review.**

**Best role for flipside:** Fallback genres/styles enrichment (structured genre taxonomy). Images: avoid for production without legal review.

---

## 5. Deezer API

**URL:** https://developers.deezer.com/api  
**Auth:** Public catalog endpoints (search, artist info, track metadata) require **no authentication**. User-context endpoints (playlists, library) require OAuth. [(source)](https://publicapis.io/deezer-api) — **Confidence: Med (confirmed by multiple 2024-2025 sources, Deezer dev FAQ)**

### Rate Limits
Deezer applies a "query quota" but does not publish specific numbers. Response headers track usage. [(source)](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)

### Capability Checklist
- **(a) Artist search:** ✅ `GET /search/artist?q={name}` — keyless.
- **(b) Genres/tags:** partial — `GET /genre` returns all Deezer genres with IDs and images. Artist endpoint does not directly expose genre; genre is associated with albums. Limited compared to Last.fm tags.
- **(c) Popularity:** ✅ Artist endpoint returns `nb_fan` (fan count). [(source)](https://www.educative.io/courses/getting-started-with-the-deezer-api-in-javascript/exploring-genre-on-deezer)
- **(d) Images:** ✅ Artist endpoint returns image URLs at multiple sizes (small/medium/large/xl). **But: images cannot be stored/cached.** "No, images are not allowed to be stored for legal reasons." Must re-fetch on every display. This makes them impractical for high-traffic use or server-side rendering. [(source)](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers) — **Confidence: High (official FAQ)**
- **(e) 30s previews:** ✅ Track records include `preview` field — a signed MP3 URL. **Caveats:** (1) URLs expire after a few hours; (2) Deezer can't provide audio files directly from API for legal reasons — SDK required for full playback. The 30s preview URL itself appears to work without SDK for web audio. [(source)](https://medium.com/@abuzarflw/using-the-deezer-api-to-generate-random-songs-7fec8dc35ed2) — **Confidence: Med (expiring URL limitation is significant)**
- **(f) Stable IDs:** ✅ Deezer artist ID (integer). Stable.
- **(g) Similar artists:** ❌ No endpoint for this.

### ToS Notes
The no-storage rule for images is a hard restriction, not advisory. Preview URLs expire. Both constrain how flipside can use Deezer as a backend.

**Best role for flipside:** 30s preview audio (keyless, but expiring URLs need refresh logic) + artist fan count as secondary popularity signal. Images: technically available but no-caching rule limits usefulness.

---

## 6. Wikidata / Wikimedia

**URL:** https://query.wikidata.org (SPARQL) | https://www.wikidata.org/w/api.php (entity API)  
**Auth:** None required. Completely keyless and free. [(source)](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service)

### Rate Limits
No formally published rate limits for the SPARQL endpoint or entity API. Queries timing out at 60 seconds are a practical ceiling for complex queries. Burst traffic may be throttled.

### Capability Checklist
- **(a) Artist search:** partial — SPARQL queries possible but not a fuzzy-name search. Better as a lookup by known ID than a discovery tool.
- **(b) Genres/tags:** ✅ Genre property (P136) on Wikidata items. Well-structured but less granular than Last.fm tags.
- **(c) Popularity:** ❌
- **(d) Images:** ✅ Property P18 stores the Wikimedia Commons filename for the primary image. Workflow: `wbgetentities?ids=Q{qid}&props=claims` → extract `P18.mainsnak.datavalue.value` (filename) → `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url&iiurlwidth=500&titles=File:{filename}` → get thumbnail URL. Images on Wikimedia Commons are CC-licensed (usually CC BY-SA or CC BY) — free to use with attribution. [(source)](https://codingtechroom.com/question/how-to-retrieve-image-url-properties-from-wikidata-api) — **Confidence: High**
- **(e) 30s previews:** ❌
- **(f) Stable IDs:** ✅ Wikidata QID (stable).
- **(g) Similar artists:** ❌

### As an Image Bridge
Wikidata is the best **legally clean** artist image source when Spotify images are unavailable:
1. Get artist's Wikidata QID from MusicBrainz url-rels (`inc=url-rels` → filter for `wikidata.org` URL) or from SPARQL (`?artist wdt:P434 "{mbid}"`)
2. Fetch P18 claim via entity API
3. Resolve filename to Commons thumbnail URL

Wikimedia Commons images are freely licensable — no ToS concerns for display. Attribution required.

**Best role for flipside:** (1) Spotify ID resolution (P1902) when MusicBrainz url-rels misses; (2) CC-licensed artist photos via P18.

---

## 7. Spotify API — Current State (2026)

**IMPORTANT CONTEXT for this research.** Spotify issued significant API restrictions in February 2026:

- **Development Mode** now requires active Spotify Premium account, max 1 Client ID per developer, max 5 authorized users.
- **Removed endpoints** (Dev Mode): bulk fetch for artists/tracks/albums, `GET /artists/{id}/top-tracks`, `GET /browse/new-releases`, user profile endpoints.
- **Still works:** `GET /search` (limit reduced from 50 to 10), individual `GET /artists/{id}`, `GET /artists/{id}/related-artists`.
- **Extended Quota Mode:** All existing endpoints and behaviors unchanged — but requires Spotify approval (not available via self-service).
- **Client Credentials flow:** Still technically available but moving away from for metadata endpoints per Spotify's stated direction. [(sources)](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) — **Confidence: High (official changelog, confirmed 2026-02-06)**

**Implication:** Flipside's current Spotify client-credentials usage for artist search + metadata is operating in a restricted mode. The 10-result search limit may be acceptable for single-name lookups. The `popularity` and `followers` fields appear to have been removed in February 2026 changes. Artist images and genres appear still available for individual artist lookups.

---

## Recommended Architecture for Flipside

| Need | Primary | Fallback |
|---|---|---|
| Artist search | MusicBrainz (keyless) or Deezer (keyless) | Spotify (limited) |
| Genres/tags | Last.fm `getTopTags` | MusicBrainz `inc=tags+genres` |
| Popularity | Last.fm listeners/playcount | ListenBrainz popularity API |
| Artist images | Wikidata P18 → Wikimedia Commons (CC-licensed) | Deezer (no-cache, expiring) |
| 30s previews | Deezer track preview URL | iTunes (already in use) |
| Stable IDs | MusicBrainz MBID (primary anchor) | Deezer artist ID |
| Similar artists | Last.fm `artist.getSimilar` | ListenBrainz Labs similar-artists |
| **Spotify URL** (Open in Spotify link) | **MusicBrainz url-rels** (MBID → `inc=url-rels` → free streaming URL) | Wikidata P1902 SPARQL |

---

## Sources

- [MusicBrainz API Rate Limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [MusicBrainz API Search](https://musicbrainz.org/doc/MusicBrainz_API/Search)
- [MusicBrainz Artist-URL Relationship Types](https://musicbrainz.org/relationships/artist-url)
- [MusicBrainz Database Statistics](https://musicbrainz.org/statistics)
- [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)
- [MetaBrainz Community: Get MBID from Spotify Song ID](https://community.metabrainz.org/t/api-query-get-mbid-from-spotify-song-id/700125)
- [MetaBrainz Community: Artists with Wikidata and Spotify ID](https://community.metabrainz.org/t/get-a-list-of-all-artists-with-wikidata-and-spotify-artist-id/344268)
- [ListenBrainz API: Popularity](https://listenbrainz.readthedocs.io/en/latest/users/api/popularity.html)
- [ListenBrainz API: Metadata](https://listenbrainz.readthedocs.io/en/latest/users/api/metadata.html)
- [ListenBrainz Labs: Similar Artists](https://labs.api.listenbrainz.org/similar-artists)
- [Last.fm API Terms of Service](https://www.last.fm/api/tos)
- [Last.fm API Intro](https://www.last.fm/api/intro)
- [Last.fm Support: Artist images returning placeholder](https://support.last.fm/t/last-fm-api-artist-getinfo-only-returns-placeholder-images-for-artists/117821)
- [Discogs API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use)
- [Deezer Developer FAQs](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)
- [Deezer API Public Directory](https://publicapis.io/deezer-api)
- [Wikidata Property P1902: Spotify Artist ID](https://www.wikidata.org/wiki/Property:P1902)
- [Wikidata Property P434: MusicBrainz Artist ID](https://www.wikidata.org/wiki/Property:P434)
- [Wikidata SPARQL Query Service](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service)
- [Wikidata Image Retrieval via API](https://codingtechroom.com/question/how-to-retrieve-image-url-properties-from-wikidata-api)
- [Spotify February 2026 API Changes Changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
- [Spotify February 2026 Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify February 2026 Security Update Blog](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
