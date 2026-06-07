# Music API Research: Deezer, iTunes Search, Apple Music, TheAudioDB

**Research date:** 2026-06-07  
**Purpose:** Evaluate Spotify API replacements/supplements for flipside music discovery (artist search, genres, popularity, images, 30s previews, stable IDs, similar artists).

All claims verified against live API calls (June 2026) or official documentation fetched the same date. Claims not directly verifiable are labeled with confidence and "as of" dates.

---

## Comparison Table

| Capability | (a) Search | (b) Genres | (c) Popularity | (d) Images | (e) 30s Preview | (f) Stable ID | (g) Similar |
|---|---|---|---|---|---|---|---|
| **Deezer** | ✅ keyless | ❌ not in artist obj | ✅ `nb_fan` | ✅ 4 sizes | ✅ signed MP3, ~few-hr TTL | ✅ integer | ✅ `/related` keyless |
| **iTunes Search API** | ✅ keyless | partial (primaryGenreName only) | ❌ | ❌ (no artist photo) | ✅ AAC .m4a, signed | ✅ `artistId` | ❌ |
| **Apple Music API** | ✅ JWT required | ✅ rich | unknown (no public docs) | ✅ | ✅ | ✅ | ✅ (editorial) |
| **TheAudioDB** | ✅ key=1 free (1 result) | ✅ `strGenre`, `strStyle` | partial (`intCharted`) | ✅ thumb/fanart/banner | ❌ | ✅ `idArtist` | ❌ (no endpoint found) |

---

## 1. Deezer API

### Auth Requirement
**No auth required for public read endpoints.** Live verified June 2026: `GET https://api.deezer.com/search/artist?q=coldplay` returns full JSON with no token. The developer portal shows a login prompt but public GET endpoints operate without it. ([developers.deezer.com/api](https://developers.deezer.com/api)) **Confidence: High** (live tested)

### Capability Checklist

**(a) Artist Search** ✅  
`GET /search/artist?q={name}` — keyless, no registration. Returns paginated artist list. Live-verified returning 22 results for "coldplay" including correct artist as first hit. **Confidence: High** (live tested June 2026)

**(b) Genres** ❌ (not in artist object, workaround available)  
The `/artist/{id}` and `/search/artist` responses do **not** include a `genres` field. Genres live on albums: `/album/{id}` returns `genres: { data: [{ id, name }] }` and `genre_id`. So genre data requires a second call to fetch an artist's album. A flat `/genre` endpoint lists all Deezer genres by ID (keyless, live-verified). **Confidence: High** (live tested)

**(c) Popularity** ✅  
`nb_fan` (integer fan count) is returned on every artist object in search and lookup results. Example: Coldplay = 18,275,829 fans. Sortable, usable as a popularity proxy. **Confidence: High** (live tested)

**(d) Artist Images** ✅  
Four sizes returned per artist: `picture_small` (56x56), `picture_medium` (250x250), `picture_big` (500x500), `picture_xl` (1000x1000). All are `cdn-images.dzcdn.net` CDN URLs. **However**, Deezer ToS states images cannot be cached ("not allowed to be stored for legal reasons"). ([Deezer FAQ for Developers](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)) **Confidence: High** (live tested; ToS note High confidence as of May 2025)

**(e) 30-Second Preview Audio** ✅ (with caveats)  
`preview` field on track objects (from `/artist/{id}/top` or `/search`): signed MP3 CDN URL (`cdnt-preview.dzcdn.net`). Live-verified format:
```
https://cdnt-preview.dzcdn.net/api/1/1/.../hash.mp3?hdnea=exp=...~hmac=...
```
URLs are **time-limited** (expire in a few hours — exact TTL not documented, "a few hours" per community sources). Must be fetched fresh, not cached at rest. **Confidence: High** (live tested June 2026)

**(f) Stable Artist IDs** ✅  
Integer IDs (e.g., Coldplay = `892`). Stable across calls. **Confidence: High**

**(g) Similar/Related Artists** ✅  
`GET /artist/{id}/related` — **keyless, live-verified**. Returns up to 20 related artists with full picture/nb_fan fields. Example: Coldplay → Keane, Ed Sheeran, Snow Patrol. **Confidence: High** (live tested June 2026)

### Rate Limits
Not officially published. Community reports suggest a per-IP query quota; exceeding it returns **error code 4** ("Quota limit exceeded"). Third-party wrappers suggest ~50 req/5 sec as a safe ceiling; some sources say the limit is per-hour with whitelisting available only via commercial agreement. No hard number is officially documented. ([GitHub DeezerSync issue #6](https://github.com/BackInBash/DeezerSync/issues/6)) **Confidence: Med** (as of 2024–2025, community sourced)

### ToS / Commercial Use
**Strict non-commercial only.** Official terms: *"The Developer agrees that the use of the Services is strictly limited for a non-commercial purpose … [and] shall not perceive, receive, generate, benefit or create directly or indirectly, any moneys, incomes, revenues."* ([developers.deezer.com/termsofuse](https://developers.deezer.com/termsofuse)) An ad-supported app would violate these terms. Commercial use requires a separate Deezer partnership agreement (no paid API tier exists). **Confidence: High** (official ToS, as of May 2025)

Additional restrictions:
- Images must not be stored/cached
- Audio must be presented as "strictly private use within a family scope"
- No app whitelisting without a commercial deal

### Reliability
API has been public for years; widespread open-source usage confirms it is operational. Preview URLs expire requiring fresh fetches. No SLA for free tier.

### Best Role
**Primary keyless provider for: artist search/typeahead, fan-count popularity, artist images (on-demand only, no caching), 30s previews (refresh on use), related artists.** Genre requires a secondary album lookup. **Not suitable as the only provider for a commercial/ad-supported app without a Deezer partnership — this is the critical blocker.**

---

## 2. iTunes Search API (free, keyless)

Official docs: [performance-partners.apple.com/search-api](https://performance-partners.apple.com/search-api)

### Auth Requirement
**None.** Completely keyless. `itunes.apple.com/search` and `itunes.apple.com/lookup` accept unauthenticated HTTP requests. **Confidence: High** (live tested June 2026)

### Capability Checklist

**(a) Artist Search** ✅  
`GET https://itunes.apple.com/search?term={name}&entity=musicArtist` — live-verified returns artist name, `artistId`, `primaryGenreName`, `artistLinkUrl`. No images in artist search results. **Confidence: High** (live tested)

**(b) Genres** partial  
Returns only `primaryGenreName` (single string, e.g., "Alternative"). No genre taxonomy, no secondary genres. **Confidence: High** (live tested)

**(c) Popularity** ❌  
No play count, follower count, or popularity score in any response. **Confidence: High**

**(d) Artist Images** ❌  
Artist search/lookup does not return artist photos. Track/song search returns `artworkUrl30`, `artworkUrl60`, `artworkUrl100` — these are **album art**, not artist photos. **Confidence: High** (live tested)

**(e) 30-Second Preview Audio** ✅  
`previewUrl` field on track/song results. Live-verified format:
```
https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview.../mzaf_...aac.p.m4a
```
AAC/M4A format (not MP3). Not visibly time-signed in URL but Apple controls CDN access. **Confidence: High** (live tested June 2026)

**(f) Stable Artist IDs** ✅  
`artistId` (integer, e.g., Coldplay = `471744`). Stable Apple Music catalog ID. **Confidence: High**

**(g) Similar Artists** ❌  
No similar/related artist endpoint. **Confidence: High**

### Rate Limits
Official documentation states: "approximately 20 calls per minute (subject to change)." No per-IP vs. per-app clarification. In practice, 403 errors are returned when throttled, with no Retry-After header — the only signal is an HTTP 403 Forbidden. Heavy aggregate load across many users risks sustained 403 windows with no documented recovery time. ([Apple Developer Forums thread 69955](https://developer.apple.com/forums/thread/69955), [Apple Developer Forums thread 90888](https://developer.apple.com/forums/thread/90888)) **Confidence: High** (as of 2024, Apple forum sourced)

### ToS / Commercial Use
Apple allows developers to use promotional content (previews, artwork, icons) **only to promote store content**, not for entertainment purposes. Attribution to Apple/iTunes required. Commercial/ad-supported apps permitted as long as the content is used to link/promote the iTunes Store, not as a streaming entertainment product. **Confidence: Med** (Apple affiliate terms, may have been updated — verify before production use; as of 2024)

### Reliability
Has been operational for 15+ years. No announced shutdown. 403 throttle events are the main pain point for production use. The app already uses this API (iTunes is one of flipside's three existing sources).

### Contrast with Apple Music API (official, paid)
The official **Apple Music API** requires: an Apple Developer Program membership ($99/yr), a MusicKit identifier, and a signed JWT developer token (ES256, 6-month max expiry). ([developer.apple.com/documentation/applemusicapi/generating-developer-tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)) It provides richer catalog search (artist genres, editorial playlists, storefront-aware results), but rate limits are **not publicly documented** — Apple developer forum questions about rate limits went unanswered. ([Forum thread 699396](https://developer.apple.com/forums/thread/699396)) For flipside's use case (metadata enrichment, not streaming), the iTunes Search API covers the core needs without requiring paid developer membership. **Confidence: High for auth requirement; Med for rate limits** (as of 2025)

### Best Role
**Supplement for: 30s preview audio (AAC) and primary-genre tagging on tracks.** Already in use by flipside. Not suitable as the sole artist search provider (no images, no popularity). Pair with Deezer for images + fan count.

---

## 3. TheAudioDB

Homepage: [theaudiodb.com](https://www.theaudiodb.com/)  
Free API docs: [theaudiodb.com/free_music_api](https://www.theaudiodb.com/free_music_api)

### Auth Requirement
Free tier uses public key `1` (formerly documented as `123` — both observed in community references). No registration required for the free key. Premium tier ($8/month Patreon) provides a private key and unlocks V2 API + higher limits. ([theaudiodb.com/api_apply.php](https://www.theaudiodb.com/api_apply.php)) **Confidence: High** (as of 2025; live tested with key `2` which returns full Coldplay data)

### Capability Checklist

**(a) Artist Search** partial (1-result limit on free tier)  
`GET /api/v1/json/{key}/search.php?s={name}` — returns 1 result on free key, 10 on premium. Useful for name-to-ID resolution, not typeahead. **Confidence: High** (live tested)

**(b) Genres** ✅  
Live response includes: `strGenre` ("Alternative Rock"), `strStyle` ("Rock/Pop"), `strMood` ("Happy"). Rich metadata, community-contributed. **Confidence: High** (live tested June 2026)

**(c) Popularity** partial  
`intCharted` (integer chart position, e.g., `7` for Coldplay). Not a fan/play count — it's an editorial chart ranking. Coarse signal. **Confidence: High** (live tested)

**(d) Artist Images** ✅  
Multiple image types returned: `strArtistThumb` (1000x1000), `strArtistBanner` (1000x185), `strArtistFanart`/`strArtistFanart2-4` (1280x720 or 1920x1080), `strArtistLogo` (400x155 PNG), `strArtistCutout`, `strArtistClearart`, `strArtistWideThumb`. Hosted on `r2.theaudiodb.com`. Rich, high-resolution. **Confidence: High** (live tested June 2026)

**(e) 30-Second Previews** ❌  
No audio preview URLs in any documented or tested endpoint. **Confidence: High**

**(f) Stable Artist IDs** ✅  
`idArtist` (integer, e.g., `111239` for Coldplay). Also returns `strMusicBrainzID` for cross-referencing. **Confidence: High** (live tested)

**(g) Similar Artists** ❌  
No similar artists endpoint found. Tested `/similar.php`, `/similar-artist.php`, `/artist-similar.php` — all return 404. V2 endpoint format also returns 404. Not documented in official docs or graphbrainz extension docs. **Confidence: High** (live tested June 2026 — endpoint does not exist)

### Rate Limits
Free tier: **30 requests/minute**. Premium: **100 req/min**. Business: **120 req/min**. ([theaudiodb.com/free_music_api](https://www.theaudiodb.com/free_music_api)) **Confidence: High** (official docs, as of 2025)

### Reliability
FreePubicAPIs.com reports 100% uptime over a 30-day test window (as of June 2026), 143ms average response time. Community-sourced database so coverage is uneven for obscure artists. The free key is rate-limited to 1 search result which constrains its use as a primary search provider. **Confidence: Med** (third-party uptime monitor)

### ToS / Commercial Use
No explicit commercial restriction documented on the free API page. Database is community-contributed under open terms. Images are hosted on theaudiodb.com CDN — check specific attribution requirements before production use. **Confidence: Low** (not independently verified against an official ToS page as of 2026)

### Best Role
**Enrichment layer for: artist genres (`strGenre`/`strStyle`/`strMood`), high-resolution artist images (fanart, banners), and MusicBrainz ID cross-referencing.** Requires name-to-ID resolution first (one search call), then a lookup. Not suitable for typeahead search, popularity signals, previews, or similar artists. Free tier adequate for enrichment at low volume; $8/month Patreon unlocks 100 req/min and V2 API for heavier use.

---

## 4. Deezer Related Artists — Quick Note

`GET https://api.deezer.com/artist/{id}/related`

- **Exists and is keyless** — confirmed live (June 2026)
- Returns up to 20 results (`total` field shows full count); supports `limit` and `index` pagination
- Each result is a full artist object: `id`, `name`, `picture_*` (4 sizes), `nb_fan`, `tracklist`
- No genre data in related artist objects (same limitation as artist search)
- No auth required — same keyless behavior as `/search/artist`

**Confidence: High** (live tested June 2026)

---

## Summary of Recommendations for flipside

| Role | Provider | Notes |
|---|---|---|
| Artist search/typeahead (a) | **Deezer** (primary) | Keyless, multi-result, instant |
| Genres (b) | **TheAudioDB** (enrichment) + Deezer album fallback | TheAudioDB gives genre/style/mood; Deezer requires album call |
| Popularity (c) | **Deezer** `nb_fan` | Best proxy available keylessly |
| Artist images (d) | **Deezer** (fast, 4 sizes) + **TheAudioDB** (high-res fanart) | Deezer: no caching allowed by ToS; TheAudioDB: cacheable |
| 30s preview audio (e) | **Deezer** (MP3) + **iTunes** (AAC) — both already used | Deezer previews expire; iTunes has 20 req/min cap |
| Stable IDs (f) | **Deezer** integer IDs | Simple, no auth |
| Similar artists (g) | **Deezer** `/artist/{id}/related` | Keyless, 20 results, full artist objects |

**Critical blocker:** Deezer's ToS is **non-commercial only**. An ad-supported or revenue-generating app requires a Deezer partnership agreement. This must be resolved before shipping Deezer as a primary provider. For a non-revenue personal/demo app, Deezer covers (a), (c), (d), (e), (f), (g) without a key. TheAudioDB covers (b) and (d) with richer metadata.

---

*Citations index:*
- [Deezer Developer ToS](https://developers.deezer.com/termsofuse)
- [Deezer FAQ for Developers](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)
- [Deezer Developer Guidelines](https://developers.deezer.com/guidelines)
- [TheAudioDB Free API Docs](https://www.theaudiodb.com/free_music_api)
- [TheAudioDB API Apply](https://www.theaudiodb.com/api_apply.php)
- [iTunes Search API Docs](https://performance-partners.apple.com/search-api)
- [Apple Music API Docs](https://developer.apple.com/documentation/applemusicapi/)
- [Apple Developer Forum — iTunes rate limits](https://developer.apple.com/forums/thread/69955)
- [Apple Developer Forum — iTunes 403 errors](https://developer.apple.com/forums/thread/90888)
- [Apple Developer Forum — Apple Music API rate limits (unanswered)](https://developer.apple.com/forums/thread/699396)
- [Deezer quota exceeded community thread](https://en.deezercommunity.com/features-feedback-44/can-i-use-deezer-api-for-website-that-runs-ads-78072)
- [DEV.to Deezer tutorial — April 2025, working demo](https://dev.to/reynaldi/create-a-cool-music-chart-site-with-deezer-api-no-backend-needed-386e)
- [FreePubicAPIs.com TheAudioDB uptime](https://www.freepublicapis.com/free-music-api-2)
