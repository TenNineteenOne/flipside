---
status: accepted
date: 2026-06-07
---

# Surrogate-UUID artist identity, with Spotify demoted to an attribute

## Context & decision

flipside's goal is to stop depending on the Spotify API (a shared client-credentials key that
gets rate-limited, throttling the whole app). Today an artist's identity *is* its Spotify ID —
a NOT-NULL key, dedup key, and `isValidSpotifyId`-guarded value across ~15 files and most tables.
That coupling is what forces every artist operation to lean on Spotify.

We are introducing an **internal UUID we mint and own (`artists.id`) as the canonical artist
identity**. `spotify_id` becomes one *external attribute* (alongside `mbid`, `apple_id`,
`deezer_id`), nullable, used only to talk to the Spotify API when present. This decouples identity
from Spotify so the resolver can later (#157) move off Spotify entirely.

## Decisions in this cluster

1. **One table (fold).** `artist_search_cache` is folded into a single canonical `artists` table
   and dropped — one book, no cross-table drift. Costs more app-file churn now (paid down while
   the dataset is tiny / pre-release), but eliminates a permanent drift bug class.
2. **Same-name artists: ID evidence splits, a bare name reuses one stable row.** *(Revised
   2026-10, #175 — supersedes "an ambiguous lookup resolves fresh; same-name artists with no
   `spotify_id` get distinct UUIDs".)* `name_lower` stays a non-unique column. The rule,
   enforced in ONE place — the artist-identity module (`lib/artist-identity/`, the doorway):
   1. **Two artists with different Spotify IDs or validated MusicBrainz IDs never share an
      `artists` row.** A seed carrying a `spotify_id` resolves only by `spotify_id` (unique),
      never by name, so it can't land on a same-name row holding another ID. Only `mbid`s
      validated by the MusicBrainz backfill count as evidence (decision 3); Last.fm's mbid never
      does.
   2. **A bare name with no distinguishing evidence reuses the one stable row**: exactly one
      row → that row; several → a deterministic pick (`spotify_id` NOT NULL first, popularity
      desc, id asc); none → mint a name-only row. An ambiguous name still runs the caller's
      lookup first, because that lookup may *produce* evidence (e.g. MusicBrainz url-rels → a
      Spotify id at onboarding); only a lookup that yields none lands on the pick.

   *Why not mint fresh per ambiguous lookup?* Last.fm conflates homonyms onto one page, so a
   bare Last.fm name carries no distinguishing evidence — a fresh mint can't be *more* right,
   only different. In practice "resolve fresh" minted a new row on every ambiguous lookup
   (#161: up to 16 rows for one name), and because the read then saw a different pile each
   run, the resolved uuid flapped between generations — breaking thumbs-down and cooldown
   filters keyed on `artist_id`. A stable (possibly conflated) row is strictly better than a
   flapping one. **Splitting already-conflated rows** (one row standing for two real "Phoenix"
   bands) is future work, tied to #168 — it needs evidence (validated mbid / Spotify id) to
   split on, which the MusicBrainz backfill is accruing.
3. **`mbid` is enrichment, populated only from validated MusicBrainz.** Live research showed
   Last.fm's mbid is *most wrong precisely on same-name collisions* (Last.fm conflates homonyms
   onto one page; ~5.5% of its mbids are invalid; `""` is its "absent" sentinel). MusicBrainz can
   disambiguate properly but only at 1 req/s — a lazy backfill (#159), never the real-time front
   door. So `artists.mbid` is nullable, populated by the validated MB worker, and the canonical
   `spotify_id` is also obtained *through MusicBrainz `url-rels`* — i.e. Spotify IDs get filled in
   without ever calling Spotify. Last.fm's mbid is a guarded hint that seeds the backfill, nothing
   more.
4. **Staged, not combined.** The identity migration (0036 + app re-key) keeps Spotify as the
   *resolver* (just re-keyed to `artist_id`); the Spotify-free Last.fm resolver swap is a separate
   slice (#157) immediately after. Rationale: the migration is the riskiest change we'll make
   (schema + ~15 files + a deploy gap, per the two-migration split in
   `docs/spotify-removal-checklist.md` §H1); changing the resolution *source* in the same breath
   would make name-based dedup load-bearing simultaneously with a schema cutover. Stage them so
   each is independently verifiable — #157 is the commit where the Spotify call count actually
   drops to ~0.

## Consequences

- The more resolution moves off Spotify (#157), the more the **doorway's by-name rule**
  (decision 2) carries the load — because Spotify-free mints often have no `spotify_id` at mint
  time. This is an accepted, deliberate coupling; it is why the doorway rule was pressure-tested
  and why it lives in one module with one test suite (`lib/artist-identity/doorway.test.ts`).
- Homonyms with no ID evidence are conflated onto one row until #168 splits them.
- Recovery during the cut is by reverting the Vercel deploy: 0036 is additive and keeps the old
  `spotify_artist_id` columns/constraints/RPCs alive; Migration B (0037) drops them later.

See `docs/spotify-removal-plan.md` and `docs/spotify-removal-checklist.md` for the full migration
map. Glossary terms: `CONTEXT.md`.
