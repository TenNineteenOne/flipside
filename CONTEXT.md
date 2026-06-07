# CONTEXT — flipside glossary

> A glossary of the domain language, not a spec. Implementation decisions live in
> `docs/adr/`; architecture lives in `docs/wiki/`.

## Artist identity (Stage 2, surrogate-UUID migration)

- **Artist identity** — the *internal* UUID we mint and own (`artists.id`). This is the
  artist's canonical name tag everywhere in the app going forward. Prior to Stage 2 the
  identity was the Spotify ID; Stage 2 demotes that.
- **Spotify ID** (a.k.a. `spotify_id`) — an *external attribute* of an artist (one address
  in their contact card), no longer the identity. Stored on the artist record; used only
  to talk to the Spotify API. May be null for artists we know only via Last.fm/MusicBrainz.
- **`artists`** — the single canonical artist record (the official roster). As of the
  fold decision, this is the **one** table holding artist metadata going forward;
  `artist_search_cache` is folded into it and dropped. One table = no drift.
- **External link** — any non-identity provider id we keep for an artist
  (`spotify_id`, `mbid`, `apple_id`, `deezer_id`).
- **The doorway (resolve step)** — the single moment an artist enters our world as a
  *name string* (from Last.fm `getSimilar`, history sync, or onboarding search) and must be
  translated to an internal UUID: match an existing roster row or mint a new one. Everywhere
  *else* in the app, lookups are by UUID. Collisions only exist at the doorway.
- **Name-cache** — the `name_lower → artist` shortcut used at the doorway to avoid re-resolving
  a name we've seen. Once resolution moves off Spotify (#157), this becomes the *primary dedup
  mechanism*, not just an optimization, because Spotify-free mints often have no `spotify_id`.
- **mbid as hint, not authority** — a `mbid` from Last.fm is treated as an unverified hint
  (Last.fm conflates same-name artists, so its mbid is wrong precisely on collisions). The
  canonical `mbid` is populated only by the validated MusicBrainz backfill worker.
- **`artist_tracks_cache`** — the cross-user track cache (top tracks + previews), keyed by
  `artist_id` post-0036. Deliberately a *separate table*, NOT a column on `artists`: tracks are a
  volatile, TTL'd, lazily-populated cache, whereas `artists` is the stable, hot identity row.
  Principle: **co-locate by lifecycle, not by entity — identity is forever, caches are disposable;
  never weld a disposable cache onto a forever row.** (Why the fold absorbed `artist_search_cache`
  — a metadata *duplicate* of `artists` — but never `artist_tracks_cache`, a distinct concern.)
