---
title: Spotify-Removal — Stage 2 Implementation & Verification Checklist
updated: 2026-06-06
status: derived from 6 code reviews + 4 security agents (all code-verified)
source_plan: docs/spotify-removal-plan.md (v4)
---

# Stage 2 Implementation & Verification Checklist

The exhaustive, code-verified map for the surrogate-UUID identity migration + resolver swap.
Companion to `docs/spotify-removal-plan.md`. **Do Stage 1 (cache-max + onboarding) first; it
needs none of this.** Everything below is the atomic Stage 2 cut.

`isValidArtistId` regex (use exactly this — strict UUID v4, lowercase, encodes version+variant
bits so it doubles as a path-traversal guard):
```ts
const ARTIST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
```

---

## Resolved decisions (2026-06-07 grill — see `docs/adr/0001-surrogate-uuid-artist-identity.md`)

These settle the open forks below; the SQL draft follows them.

1. **Fold** `artist_search_cache` into `artists` and drop the table (supersedes §A.7's "decide"). One table, no drift.
2. **`name_lower` non-unique** (per §H3); dedup on `spotify_id`/`mbid` only. Doorway collisions
   use **Option B**: ambiguous exact-name lookup → resolve fresh, dedup by id; same-name artists
   with null `spotify_id` correctly get distinct UUIDs.
3. **mbid = B1**: nullable `mbid` column now, populated **only** by the validated MusicBrainz
   backfill (#159) — *also the Spotify-free source of `spotify_id` via MB `url-rels`*. Last.fm's
   mbid is a guarded hint (skip `""`, name-cross-check), never authoritative. (Research: Last.fm
   conflates same-name artists → its mbid is wrong precisely on collisions; ~5.5% invalid.)
4. **Staged**: the Spotify-free Last.fm resolver swap is **#157, after** the cut — not folded in.
   0036 + the §C re-key keep Spotify as the resolver, just re-keyed to `artist_id`.
5. **`recommendation_cache` must be MIGRATED, not deleted** (unlike `explore_cache`): it holds
   durable user state — `skip_at` (permanent Dismiss) + `seen_at` (7-day cooldown), `engine.ts:383`.
   Deleting it would wipe dismisses.
6. **`artist_data` JSONB = re-serialize in-migration** (option A, §H6): in the same `UPDATE` that
   sets `artist_id` and preserves cooldown state, `jsonb_set` the blob → `id = uuid`,
   add `spotifyId = <old id>`. Guard with the §A.4 `RAISE EXCEPTION` if any blob `id` can't map.
7. **FK `ON DELETE RESTRICT`** on every new `artist_id` FK (§H6): `artists` is append-only; a
   future merge must re-point references deliberately (or use a soft `merged_into` pointer).
   SET NULL is impossible on the NOT-NULL tables; CASCADE would destroy user feedback/saves.

**Forward-compat notes (verified 2026-06-07 — no design conflicts, only these sequencing items):**
- The #158 cutover must also re-key **in-memory identity sets**, not just DB columns: the
  diversity engines' `thumbsUpIds: Set<string>` (engine/explore-engine) and the `use-feed-fill`
  dedup key currently hold Spotify IDs → must become UUIDs, or they silently double-show artists.
- **Keep the guard↔table swap paired** for `open/[platform]/[artistId]` (apple) + `artists/[id]/tracks`:
  with FK RESTRICT, dropping `spotify_artist_id` (0037) before swapping those guards = broken surface.
- Stage-3 work (Deezer / TheAudioDB / Wikidata images / per-track links) fits cleanly — the
  `artists` table already reserves nullable `deezer_id`/`apple_id`/`image_url`; per-track links key on
  track ids, not artist identity. #159's MB worker is the same lazy pattern Stage-3 enrichment reuses.

**0036 rehearsal + adversarial review (2026-06-07): drafted, rehearsed GREEN, reviewed.**
`supabase/migrations/0036_artist_identity_additive.sql` validated on REAL prod data (all 6247
artists, 1326 rec_cache, anonymized users) + synthetic edge cases — 79 checks pass. 3-agent
adversarial review (data-loss / additive-rollback / security): security + rollback = SHIP; one
HIGH data-loss bug FOUND + FIXED — the backfill was copying `artist_search_cache.name_lower`
(the search-QUERY key, e.g. "drake & future") into `artists.name_lower` instead of
`lower(artist_name)`, corrupting 756/6254 names → resolver doorway would miss them. Fix:
`select distinct on (spotify_id) … lower(artist_name) … order by (lower(name)=name_lower) desc`.
Carry-forward for #158 / 0037 (NOT blockers):
- Deploy-gap dup-row window (old spotify-keyed + new artist-keyed writes for same user+artist):
  LOW/self-healing at pre-release scale; a dismissed artist (skip_at on the old row) could briefly
  resurface for new-code paths during the ~2-4min gap. Document; consider a transitional dual-write.
- 0037 drops: old `spotify_artist_id` columns + old uniques + old `…_unresolved_idx` + old TEXT RPCs,
  and adds NOT NULL + PK surgery on artist_tracks_cache/artist_external_links.
- Latent: Supabase default privileges auto-grant ALL to anon on every NEW table — each future table
  needs an explicit `revoke all from anon` (artists got one; this isn't automatic).

## App cutover — decision lens + slice plan (2026-06-07, scoped from a 4-cluster ~40-file sweep)

**Lens (resolves the cutover's open questions without one-offs):** (1) one canonical thing, but
co-locate by *lifecycle* not entity — fold duplicates, keep distinct-lifecycle caches separate;
(2) do hard schema now while usage ~0 (caches are disposable → low-risk re-key); (3) don't
defer-*couple* (deferring onto #157 is worse than a clean slice now); (4) stage don't cram —
smallest atomic cut, sequence the rest into smoke-testable slices; (5) client speaks `artist_id`
everywhere, routes recover external ids internally; `spotify_id` is never a client-facing key;
(6) no transitional scaffolding for cosmetic self-healing tiny-window risks at this scale.

**Slice plan:**
- **0036** core identity DB migration — DONE (rehearsed green, reviewed).
- **Slice 1** core app cut: engine, history (id-resolver/syncers/statsfm), name-cache, most API
  routes (feedback/dismiss/saves/seed-artists/onboarding/recommendations/history), client
  (pages/components/hooks), links/validation → `artist_id`. **Hard key rename** on the
  `/api/recommendations` response + `use-feed-fill` dedup (no dual-key — cosmetic self-healing).
- **Slice 2** external-route re-key: `artist_tracks_cache` + `artist_external_links` PK-swap to
  `artist_id` (they're caches → low risk); `tracks`/`open`/`resolve-track` resolve `spotify_id`
  from `artists` internally; guards → `isValidArtistId`. **This makes the client pass `artist_id`
  to ALL routes — the B1 "pass spotifyId to 2 routes" special-case disappears.**
- **#157** Spotify-free Last.fm resolver swap · **#159** MB backfill · **00xx** drop-old (per-user
  spotify_artist_id cols + old uniques + old TEXT RPCs).

**Resolved cutover Qs (by lens):** mint via shared race-safe `lib/artists.ts` helper (insert on
conflict spotify_id do nothing + read-back), DI'd into resolve-candidates (keep pure); name-cache
conflict target = spotify_id when present else distinct uuid; resolver unresolved-filter =
`artist_id is null AND lastfm_artist_name is not null AND spotify_artist_id is null`; explore rail
previews from `artist_tracks_cache` (A1, + one-time backfill of baked topTracks); genre/seed/color
hydration re-pointed to `artists`; feed KEEPS baking topTracks into `rec_cache.artist_data`
(per-user materialization, not drift); 3-row merge = keep + log-and-skip safeguard.

---

## A. Database migration (single transaction; ~4.3k rows → sub-second)

1. **`artists` table** (canonical record): `id uuid pk default gen_random_uuid()`,
   `spotify_id text unique`, `mbid text unique`, `apple_id text`, `deezer_id text`,
   `name text not null`, `name_lower text not null unique`, `genres text[]`, `popularity int`,
   `image_url text`, `artist_color text`, timestamps.
   - RLS: `enable row level security`; `create policy "artists: authenticated read" for select
     to authenticated using (true)`. **No insert/update/delete policy** (service-role writes
     bypass RLS).
   - **GRANT** (Data-API cutover): `grant select on table artists to authenticated;` — **no
     anon grant** (matches `artist_search_cache` precedent).
   - Indexes: `name_lower` (trgm GIN for ILIKE), `spotify_id` partial.
2. **Backfill `artists`** from `artist_search_cache` (has spotify_id + metadata),
   `on conflict (spotify_id) do nothing` (first-seen wins). Second pass: insert any
   `spotify_artist_id` present in per-user tables but not in cache (orphans → `name = spotify_id`
   placeholder). Log orphan count.
3. **Temp map**: `spotify_id → artists.id`.
4. **Add `artist_id uuid references artists(id)`** to: `recommendation_cache`, `feedback`,
   `saves`, `seed_artists`, `listened_artists`, `artist_tracks_cache`, `artist_external_links`.
   `UPDATE … FROM` the map. Guard with a `DO $$ … RAISE EXCEPTION` block if any NOT-NULL table
   has unresolved `artist_id` before constraining.
5. **⚠️ BLOCKER — PK surgery (these two are PKs, not plain columns):**
   `artist_tracks_cache.spotify_artist_id` and `artist_external_links.spotify_artist_id` are
   `TEXT PRIMARY KEY`. Add a surrogate `id uuid` PK (or make `artist_id` the PK); add
   `artist_id uuid not null unique references artists(id)`.
6. **⚠️ BLOCKER — `explore_cache.artist_ids TEXT[]`** stores Spotify IDs and is in NO reviewer's
   "per-user table" mental model. Simplest safe fix: **`DELETE FROM explore_cache;`** (24h TTL,
   regenerates on next /explore load). Do NOT try an in-place `USING` cast.
7. **⚠️ `artist_search_cache`** (the hottest cross-user read path — omitted from the v3 plan):
   decide explicitly — **fold into `artists`** (preferred; drop the table after) OR add
   `artist_id uuid` + index and update every id-keyed read. If kept, every `.eq('spotify_artist_id',…)`
   read must move to `artist_id` or join `artists`.
8. **Swap unique constraints / indexes** to `artist_id`:
   - `recommendation_cache`/`feedback`/`saves`/`seed_artists`: `unique(user_id, artist_id)`.
   - `listened_artists`: keep `artist_id` **nullable** (name-only rows); use a **partial** unique
     index `unique(user_id, artist_id) where artist_id is not null`, and **update the existing
     partial index** `… where lastfm_artist_name is not null and artist_id is null` (was
     `spotify_artist_id is null`).
   - **⚠️ Auto-named constraints**: the 0001 inline `unique(user_id, spotify_artist_id)` and
     indexes have auto-generated names. **Verify live names first**:
     `select conname, pg_get_constraintdef(oid) from pg_constraint where contype='u' and conrelid
     in ('seed_artists'::regclass,'listened_artists'::regclass,'recommendation_cache'::regclass,
     'feedback'::regclass);` Use `drop constraint if exists`.
9. **Keep old `spotify_artist_id` columns (nullable)** for rollback; drop in a later migration.

## B. RPC rewrites (⚠️ atomic with the constraint swap — highest security item)

`rpc_record_feedback`, `rpc_delete_feedback`, `rpc_clear_dismiss` take `p_artist_id TEXT`, use
it in `where spotify_artist_id = p_artist_id` and `on conflict (user_id, spotify_artist_id)`.
For each:
1. `CREATE OR REPLACE FUNCTION …(… p_artist_id UUID …)` with column refs → `artist_id` and
   `on conflict (user_id, artist_id)`.
2. **`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`** on the **new** `(…,UUID,…)` signature
   — a `CREATE OR REPLACE` with a changed param type makes a NEW overload that is **PUBLIC-
   EXECUTE-able by default**. Missing this = an authenticated PostgREST caller can invoke it with
   a spoofed `p_user_id` (the RPCs trust `p_user_id`; safety rests entirely on the revoke). **🔴 HIGH.**
3. **`DROP FUNCTION IF EXISTS rpc_record_feedback(UUID, TEXT, TEXT)`** (and the other two old
   signatures) — `CREATE OR REPLACE` does NOT replace across a type change; the old overload
   lingers as a latent time-bomb once `spotify_artist_id` is dropped.
- `rpc_increment_challenge_progress` and `rpc_register_login_attempt` — no artist param; no change
  (but keep their existing REVOKEs).
- While here: add explicit `with check (auth.uid() = user_id)` to the 5 per-user table policies
  that lack it (`users`, `seed_artists`, `listened_artists`, `recommendation_cache`, `feedback`,
  `saves`) — theoretical-only today (service-role writes), but cheap defense-in-depth.

## C. Application code change map (category: identity→`artist_id` | spotify-attr→keep | track→out-of-scope)

Master sweep covered `app/ lib/ components/ scripts/` + migrations. Ship all of "identity" as ONE
atomic cut with the migration (a half-cut = silent 400s / lost writes).

- **`lib/music-provider/types.ts`** — `Artist.id` becomes the internal uuid; **add `spotifyId?: string`** attribute. (Comment currently says "Spotify artist ID".)
- **`lib/spotify-ids.ts`** — add `isValidArtistId` (uuid). Keep `isValidSpotifyId` for genuine-Spotify routes (below).
- **`lib/recommendation/engine.ts`** — `writeScored` (`spotify_artist_id: item.artist.id` → `artist_id`; `onConflict` → `user_id,artist_id`); cooldown `.in('spotify_artist_id',…)` → `artist_id`; seed-gather feedback/cache selects → `artist_id`. **⚠️ easy-to-miss:** the confirm dep `getSpotifyTopTracks(artist.id)` (≈:144) must pass `artist.spotifyId ?? null`, not the uuid (else 404 + breaker trip).
- **`lib/recommendation/confirm-previews.ts`** — `getSpotifyTopTracks` param accepts `string|null`; callers pass `spotifyId`; no-op when null. (#145 negative-cache semantics unchanged.)
- **`lib/recommendation/resolve-candidates.ts`** — the **identity-mint** site: after resolving a name, look up/INSERT `artists` (uuid) → set `artist.id = uuid`, `artist.spotifyId = best.id`. **⚠️ add a `stringSimilarity(name, resolved.name) ≥ 0.8` guard before the `res[0]` fallback** (reuse `lib/history/name-utils.ts`) — Last.fm search is less authoritative than Spotify; without it the cross-user cache gets poisoned. Mint via `insert … on conflict (name_lower) do nothing` + read-back (race-safe).
- **`lib/recommendation/artist-name-cache.ts`** — `write` stores the canonical record; store `spotify_id` (attribute) + the uuid identity, **never the uuid in a `spotify_artist_id` column**.
- **`lib/recommendation/explore-engine.ts`** — all `spotify_artist_id` selects/sets/maps → `artist_id` (loadUserContext, loadExcludedIds, seed resolution, hydrateRailArtists). `explore_cache.artist_ids` now holds uuids.
- **`lib/history/id-resolver.ts`, `lastfm-syncer.ts`, `spotify-syncer.ts`, `statsfm-listened-artists.ts`** — resolve incoming Spotify IDs → uuid via `artists`; write `artist_id`. Generalize the merge for the 3-row case (legacy spotify-id row + mbid/uuid row + backfill).
- **`lib/recommendation/freshness.ts`** — count select → `artist_id`.
- **API routes** — body key `spotifyArtistId` → `artistId` (uuid) + guard `isValidArtistId` for: `feedback` (+[artistId]), `dismiss/[artistId]`, `saves` (POST+DELETE), `settings/seed-artists` (POST/DELETE/GET maps `id`), `onboarding/seeds`, `artists/[id]/tracks`. RPC arg `p_artist_id` now passes the uuid. `recommendations`, `recommendations/generate` (incl. color-extraction `spotify_artist_id` reads at :47–73), `history`, page server components (`feed/explore/history/saved/stats/settings`) → `artist_id`.
- **`lib/seed-artist-validation.ts:34`** — `isValidSpotifyId` → `isValidArtistId`.
- **Client hooks/components** — split the dual-purpose field: API calls use `id` (uuid), links use the `spotifyId` attribute. `use-artist-feedback`/`-saves` body keys → `artistId`; `use-feed-fill`/`feed-client`/`artist-card`/`track-strip`/`explore-artist-row`/`rail`/`history-client`/`saved-client` field refs → `artist_id` + pass `spotifyId` to `getArtistLink`/`getShareableArtistLink`.
- **`lib/music-links.ts`** — params `{ artistId, spotifyId?, artistName }`; Spotify link = `spotifyId ? open.spotify.com/artist/${spotifyId} : open.spotify.com/search/${enc(name)}`; apple link path carries the **spotifyId** (see guard policy).
- **Tests** — update the hardcoded `spotify_artist_id`/`spotifyArtistId` stubs across `*.test.ts`.
- **`scripts/backfill-artist-genres.ts`, `inspect-cache.ts`, `mb-coverage-spike.ts`** — `.eq('spotify_artist_id',…)` → `spotify_id` (attribute) or `artist_id`.

### Guards that MUST STAY `isValidSpotifyId` (genuine Spotify id)
- `spotify/like` (Spotify **track** id → Spotify API).
- `spotify/resolve-track` (Spotify **artist** id → `GET /artists/{id}`); after Stage 2 the client sends the artist's `spotifyId` attribute; route resolves uuid→spotify_id from `artists` first.
- `open/[platform]/[artistId]` (apple) and `artists/[id]/tracks` — **deferred swap**: keep `isValidSpotifyId` until `artist_external_links` / `artist_tracks_cache` are re-keyed, then swap (or have the apple link carry `spotifyId`). Order matters: swapping the guard before the table = 400s; swapping the table before the guard = silent cache misses.

## D. New MusicBrainz backfill worker (lazy Spotify-id enrichment)
- **Single-process cron / Edge worker, NOT a distributed serverless limiter** (1 req/s can't be enforced across instances sharing a NAT IP).
- **🔴 Must be `CRON_SECRET`-gated with `timingSafeEqual`** (copy `app/api/cron/recommendations/route.ts`) — `/api/cron/*` is excluded from middleware auth, so an ungated worker is a public endpoint driving MB calls.
- Fixed host, User-Agent, timeout. Add an `mbid`/last-attempt column for the queue.

## E. Last.fm load (so the swap doesn't move the SPOF)
- **The "collapse artist.search + getInfo" claim is FALSE** — `artist.search` returns no genres. Keep `getInfo` for genres; **cache it** (`lastfm_cache kind='enrichment'`, 7-day TTL) and cache `artist.search`. Warm path → ~0 live Last.fm calls; cold gen ~20–30 (within budget).
- **Add per-endpoint Last.fm counters** (`incLastfmSearch/Similar/TagTop/GetInfo`) — they don't exist; they're the success-metric gate.
- **Add `runLastfm` token-bucket (~≤4 req/s)** — concurrency=12 with no spacing ≠ rate control.

## F. Localhost rehearsal (the gate — run with `SPOTIFY_CLIENT_ID/SECRET` UNSET)
Seed a localhost DB from a prod schema dump + sample; run the migration; then as a **cold user**:
1. Onboarding search returns results; **0 Spotify calls** in logs.
2. Generate feed → `[gen-timing] spotify: 0`; ≥8 tier-1 cards with images + previews; all ~20 fill.
3. **Thumbs-up / thumbs-down / save / dismiss** an artist → HTTP 200 (not 400 — proves guards swapped); rows land with correct `artist_id`; `seen_at`/`skip_at` set; `user_challenges.progress` +1.
4. **Show tracks** on a fresh Last.fm artist → 200 (not 400), iTunes tracks.
5. **Open in Spotify** with a known id → `/artist/{id}`; without → `/search/{name}` fallback. **Open in Apple Music** → 200 (guard accepts the id form you chose).
6. Explore renders; thumbs-up with `railKey` narrow-invalidates; cross-surface 7-day cooldown holds.
7. Colour: `artist_search_cache`/`artists.artist_color` populated (not all `#8b5cf6`).
- **FK integrity**: `select rc.artist_id from recommendation_cache rc where not exists (select 1 from artists a where a.id = rc.artist_id);` → 0 rows. Same for feedback/saves.

## G. Security must-fixes (graded by reachability)
- 🔴 **HIGH (real, plan-introduced):** RPC overload — REVOKE new signature + DROP old signature (§B).
- 🔴 **HIGH (plan gap):** MB worker must be `CRON_SECRET`-gated (§D).
- 🟠 **MED (real, plan-introduced):** resolver similarity guard before the `res[0]` write (§C resolve-candidates) — cross-user cache poisoning via Last.fm disambiguation.
- 🟠 **MED:** mint-time race on `artists` — `on conflict do nothing` + read-back + the unique constraints (§A.7/C).
- 🟠 **MED:** `artists` Data-API `GRANT SELECT … to authenticated` (no anon) (§A.1).
- 🟡 **LOW:** add `with check` to the 5 per-user policies (§B); port the `tracks`/`resolve-track` name-id poisoning cross-checks to the `artists` table (else they silently no-op post-migration).
- 🟡 **LOW (Stage 3 only):** expanding `next/image remotePatterns` + CSP `img-src` + colour-extraction allowlist for new image CDNs — **specific hosts, never wildcards**.
- 🟡 **LOW (defer):** per-user rate bucket on `/api/open` (iTunes exhaustion by an authed user) — add as the user base grows.
- ✅ Confirmed clean today: SSRF (allowlist + `redirect:"error"` + caps), open-redirect (`isSafeAppleUrl` revalidates cache), secrets (server-only; `_*.ts` now gitignored), XSS (React-escaped; no `dangerouslySetInnerHTML` on provider data), injection (ILIKE escaped, params parameterized).

---

## H. Round-2 corrections (gaps found red-teaming this checklist — these SUPERSEDE the "atomic cut" framing above)

A second exhaustive review (5 agents) red-teamed the fixes above and found real defects. Apply these.

### H1 — 🔴 BLOCKER: it is NOT one atomic cut — split into TWO migrations + keep old alive
DB migration and the Vercel app deploy are separate events (~2–4 min build gap). Dropping the
old RPC overloads / old unique constraints in the same migration that creates the new ones
kills every write during the deploy window AND breaks rollback. Correct sequence:
- **Migration 0036 (apply BEFORE deploying app code):** create `artists` (+RLS+GRANT),
  backfill, add `artist_id` columns + populate, PK surgery, `DELETE FROM explore_cache`,
  create the NEW `(…,UUID,…)` RPC overloads + REVOKE them. **KEEP the old `spotify_artist_id`
  columns, the old `unique(user_id, spotify_artist_id)` constraints, AND the old `(…,TEXT,…)`
  RPC overloads alive.** Add the new `unique(user_id, artist_id)` alongside (not replacing) the
  old unique.
- **Deploy app code** (now reads/writes `artist_id`, calls UUID RPCs).
- **Migration 0037 (apply AFTER deploy verified):** `DROP FUNCTION` the old `(…,TEXT,…)`
  signatures, drop the old `spotify_artist_id` columns + old constraints.
- **Rollback** = revert the Vercel deploy (old code still works because old columns/constraints/
  RPCs are still alive after 0036). Note: `DELETE FROM explore_cache` is **not** reversible —
  Explore is blank until the 24h cache regenerates (acceptable, self-healing).

### H2 — 🔴 Preview == prod DB; rehearse LOCALLY only
There is one hardcoded `NEXT_PUBLIC_SUPABASE_URL`, no env-branching, no staging project — so a
Vercel **preview deploy hits the PRODUCTION Supabase DB**. You cannot safely rehearse Stage 2
on preview. Rehearse on a **local** Supabase (`supabase start`) seeded from a prod schema dump.
**Never** `supabase db push --linked` to "try it" — that runs against prod. (The shared-key
caveat in [[project_shared_api_keys]] extends to the DB.)

### H3 — 🟠 `name_lower` must NOT be UNIQUE on `artists`
Two distinct artists can share a normalized name (e.g. two bands "Phoenix"); a unique
`name_lower` silently collapses the second into the first's row cross-user (the §C similarity
guard does NOT cover this — it guards wrong-artist-returned, not same-name-collision). Make
`name_lower` a **non-unique** lookup index; dedupe on `spotify_id`/`mbid` (those stay unique).
Mint via `insert … on conflict (spotify_id) do nothing` + read-back; for null-spotify_id new
artists, accept that two same-name artists get distinct uuids (correct).

### H4 — 🔴 The two missing RPC DROPs + the exact name-cache write
- §B gave the explicit `DROP FUNCTION` only for `rpc_record_feedback(UUID,TEXT,TEXT)`. Add:
  `DROP FUNCTION IF EXISTS rpc_delete_feedback(UUID,TEXT);` and
  `DROP FUNCTION IF EXISTS rpc_clear_dismiss(UUID,TEXT);` (in migration 0037).
- `lib/recommendation/artist-name-cache.ts:110` literally upserts `spotify_artist_id: artist.id`
  and the `CacheSupabaseClient` row type + the test at ~:173 assert it. Post-flip `artist.id` is
  a uuid → it would write a uuid into a spotify-id column / dropped table. **Fix the exact line**:
  write the canonical record to `artists` (or, if `artist_search_cache` is kept, set the
  spotify-id column from `artist.spotifyId`, never `artist.id`). Update the row type + test.

### H5 — Number correction + getInfo cache is MANDATORY
- The "cold gen ~20–30 Last.fm calls" in §E is the **second-generation** figure. **First-ever
  cold for a brand-new user is ~100–145** (≈90 `getInfo` [one per resolve-pool miss; resolve-
  pools 36+54=90] + 10–40 `getSimilar` + 0–15 `tag.gettopartists`). `enrich-artist.ts` has **no
  cache today**, so caching `getInfo` is **required, not optional** — without it Stage 2 just
  moves the ~90-call burst from Spotify to Last.fm at identical volume. Implement it as a
  `cachedArtistEnrichment(name, fetchFn)` wrapper in `lib/lastfm-cache.ts` (`kind='enrichment'`,
  key=lowercased name, 7-day TTL), mirroring `cachedSimilarArtistNames`.
- The `runLastfm` token-bucket is **per serverless process, not per shared IP** (same limitation
  the MB worker note calls out). Fine at close-friends serial usage; at coworker concurrency,
  N simultaneous cold gens = N×4 req/s from one IP → can trip Last.fm. Real mitigation is
  caching depth (drives volume down), not the bucket. Acceptable for pre-release; revisit at scale.

### H6 — Additional code sites the §C map under-listed
- `app/(app)/stats/page.tsx` — 9 distinct `spotify_artist_id` read/`.in()` sites → `artist_id`.
- **`artist_data` JSONB embedded `id`**: legacy `recommendation_cache`/`artist_search_cache`
  rows store `artist_data.id = <spotifyId>`; `feed/page.tsx:86` filters on `artist_data?.id`.
  Decide: re-serialize blobs during migration (`id=uuid`, add `spotifyId`) OR grandfather
  `artist_data.id` as "may be either" + presence-check. Pick one explicitly.
- `lib/hooks/use-feed-fill.ts` dedup key + the `GET /api/recommendations` response key rename
  must move together; a stale client with the old key dedupes wrong → duplicate cards. Consider
  a transitional response carrying BOTH `spotify_artist_id` and `artist_id` during rollout.
- **FK `ON DELETE`** on the new `artist_id` FKs is unspecified. User-delete cascade does NOT
  touch the cross-user `artists` table (good). But a future artist-dedup/merge that deletes an
  `artists` row would hit the FK — choose `ON DELETE RESTRICT` (deliberate; artists is
  append-only) or `SET NULL`, and document it.

### H7 — Confirmed good (held up under round 2)
Stage 1 is genuinely schema-free **as long as it keeps returning Spotify ids** (the `Artist.id`
flip is the coupling point — keep it in Stage 2). No DB views/triggers/realtime. IDOR clean.
Open-link forgery not exploitable (links built from server data). `isValidArtistId` regex
correct + strictly safer. `gen_random_uuid()` available (used in 0025/0026). RPC in-migration
REVOKE window is theoretical (DDL transactional). No live Critical security vulns.
