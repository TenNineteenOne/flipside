# Flipside — Architecture Deepening Review

## Context

This is a discussion document, not an implementation plan. You asked for an architecture audit that explains savings and benefits without writing code and without changing how the app functions. It surfaces **deepening opportunities** — refactors that turn shallow or fragmented modules into deep ones with stable interfaces and high leverage.

Each candidate is rated on:

- **Locality** — does the change concentrate complexity (bugs, knowledge, edits) into one place?
- **Leverage** — does a small interface hide a lot of behavior for many callers?
- **Test surface** — does the deepened module open a clean interface to test, or does the code remain testable only through its outer effects?
- **Deletion test** — if we deleted the proposed module, would complexity vanish (it was a pass-through) or re-appear scattered across N callers (it earned its keep)?

A few candidates **reverse an existing pattern**. Those are flagged with `⚠ contradicts current pattern` and include the reason the friction is bad enough to revisit.

No code changes are proposed. Each candidate ends with a recommendation strength so you can pick which to pursue:

- **Strong** — friction is real, savings concrete, low risk
- **Worth exploring** — meaningful win, but interface design needs a session
- **Speculative** — pattern smell, but not yet load-bearing enough to refactor

---

## Candidate Map (8 candidates, ranked)

```
                  IMPACT (locality + leverage)
                    HIGH ↑
                       │
   #1 Adventurous   ●  │  ●  #2 Settings monolith
   mode seam            │
                       │  ●  #3 Cache + invalidation fan-out
   #4 Feedback      ●  │
   mutation hook        │  ●  #5 listened-artists triad
                       │
   #6 MusicProvider ●  │  ●  #7 ArtistCard split
   registry             │
                       │
                       │  ●  #8 API route auth/validate shell
                       │
                       └────────────────────────→
                                          EFFORT
                       LOW                    HIGH
```

---

## #1 — Adventurous-mode seam

**Files**

- `components/explore/explore-client.tsx` (lines ~89–108)
- `components/settings/settings-form.tsx` (lines ~197–211)
- `components/nav/app-nav.tsx` (lines ~26–43)
- `components/visual/ambient.tsx` (lines ~18–35)

**Problem**

Four independent files each:

1. Hold local `useState<boolean>` for `adventurous`
2. Read `localStorage.getItem("flipside.adventurous") === "1"`
3. Listen on `window` for the custom event `"flipside:adventurous-change"`
4. (For the toggle owners) write to localStorage + dispatch the same event

This is the textbook **missing seam**: a single piece of state has four adapters in four files, each carrying the same coupling to `localStorage`, the same magic string, the same event name. Two adapters = a real seam; we have four.

**Why it bites**

- A schema change ("store on the user row, fall back to localStorage for unauthed") = 4 edits, all coordinated.
- New consumer (e.g., the feed wants to colour its hero strip) = paste the same pattern.
- Tests must mock `localStorage` + `window.dispatchEvent` in each surface.
- The bug class "tab A and tab B disagree on adventurous state until you reload" is currently invisible — there's no place to instrument it.

**Proposed deepening**

One client-side module exposes:

```
useAdventurousMode()  ->  { adventurous: boolean, setAdventurous: (next: boolean) => Promise<void> }
```

Behind it: localStorage read on mount, event subscription, PATCH `/api/settings`, broadcast on change. The `"flipside.adventurous"` key, the event name, and the network call all live inside the module. None of the four consumer files know any of that.

**Locality** — 4 places → 1.
**Leverage** — every call site shrinks to one line; future consumers get the behaviour for free.
**Test surface** — the hook becomes the unit-testable seam: simulate storage changes, assert handlers fired. Today there is no testable point; you'd have to render four components.

**Before / After**

```
BEFORE                              AFTER

explore-client ──┐                  explore-client ──┐
settings-form ──┼─→ localStorage    settings-form ──┼─→ useAdventurousMode() ──┐
app-nav ────────┤   + window event  app-nav ────────┤                          ├─→ ls + event + API
ambient ────────┘   + PATCH /api    ambient ────────┘                          │   (sealed)
                                                                               ┘
                    (4 adapters)                              (1 adapter)
```

**Deletion test** — delete the hook and the four files re-grow identical code. Earns its keep immediately.

⚠ **Contradicts current pattern** — the code intentionally avoids React Context for adventurous mode, choosing a `window` event so unrelated trees can listen. The deepening keeps the event-bus property (the module still dispatches the event for unmounted listeners that haven't migrated) while sealing the coupling. Worth reopening because the duplicated `useEffect` blocks across four files is the actual cost the no-context choice was trying to avoid.

**Recommendation: Strong.**

---

## #2 — Settings form monolith

**File**

- `components/settings/settings-form.tsx` — 815 lines

**Problem**

One client component owns:

- 9 `useState` hooks (threshold, curve, lastfm username, statsfm username, underground mode, deep discovery, adventurous, music platform, delete confirmation)
- 6+ async mutation handlers, each repeating the auth-check + PATCH + toast + invalidate pattern
- An inline `ToggleSwitch` component (lines ~330–363)
- A duplicate of the adventurous toggle logic (see #1)
- Pure helpers for obscurity labels, curve labels, threshold help text (lines ~76–149) — UI presentation that happens to live alongside form state

The interface (props) is small, but the implementation is enormous: this is the shape of a **shallow-on-top, deep-and-tangled-underneath** module. Readers must hold all 11 sections in their head to make any change safely.

**Proposed deepening**

Settings has six natural sections, each with stable inputs and one stable output (a server mutation). Each can be its own deep module:

```
SettingsForm (composition)
├─ ObscurityPanel        — threshold, curve, underground, deep discovery
├─ AdventurousPanel      — wraps useAdventurousMode (#1)
├─ SeedsPanel            — delegates to LibraryEditor (already deep)
├─ ConnectedSourcesPanel — lastfm + statsfm
├─ PlatformPanel         — music platform picker
└─ AccountPanel          — sign out + delete
```

A shared `useSettingsMutation()` hook absorbs the "PATCH /api/settings, toast on failure, optimistic rollback" plumbing that every handler repeats.

Pure helpers (`obscurityLabel`, `obscurityColor`, `popularityCurveLabel`) move to `lib/ui-text.ts` — they're presentation, not React.

**Locality** — every bug is "in the right panel" instead of "somewhere in 815 lines."
**Leverage** — `useSettingsMutation` removes ~10 lines of boilerplate per handler.
**Test surface** — each panel testable in isolation, mutations testable as a unit. Today the whole form must be rendered to test anything.

**Before / After**

```
BEFORE                            AFTER
                                  
┌─ settings-form.tsx (815) ─┐    ┌─ settings-form.tsx (~120) ─┐
│ 9 useState                │    │ assembles 6 panels         │
│ 6 async handlers          │    └─┬──┬──┬──┬──┬──┬───────────┘
│ inline ToggleSwitch       │      │  │  │  │  │  │
│ inline ObscurityPanel UI  │      ▼  ▼  ▼  ▼  ▼  ▼
│ adventurous duplicate     │     [6 panels, ~100–200 LOC each]
│ inline curve preview      │     [useSettingsMutation hook]
│ inline pure helpers       │     [lib/ui-text.ts]
└───────────────────────────┘
```

**Deletion test** — deleting the new panel files re-grows the 815-line form. Each panel earns its keep through clean local change.

**Recommendation: Strong.**

---

## #3 — Cache + invalidation fan-out

**Files**

- `lib/lastfm-cache.ts`
- `lib/user-cache.ts`
- `lib/recommendation/artist-name-cache.ts`
- `lib/recommendation/explore-engine.ts` (exports `invalidateExploreCache`)
- Implicit `artist_search_cache` table reads/writes inlined in `lib/listened-artists.ts`
- Five API routes call `invalidateExploreCache(userId, ...)` directly: `app/api/settings/route.ts`, `app/api/settings/seed-artists/route.ts`, `app/api/feedback/route.ts`, `app/api/dismiss/[artistId]/route.ts`, `app/api/saves/route.ts`

**Problem — two intertwined frictions**

**(a) Three uncoordinated cache styles** — Last.fm responses use a Supabase table with `(kind, key)` composite. Per-request user rows use React `cache()`. Artist-name lookups use a third pattern. Inline `artist_search_cache` reads use a fourth. No shared notion of TTL, miss semantics, or invalidation.

**(b) Explore-cache invalidation is a fan-out across five routes** — each one knows what to invalidate after which write (`/api/settings` even has conditional logic deciding *which* rails to invalidate based on which field changed). The knowledge "field X invalidates rail Y" lives in route handlers, not next to the cache itself.

This is two friction points but one solution: the cache abstraction needs to know its own invalidation rules.

**Proposed deepening**

Two seams:

1. **`CacheLayer<T>`** — a tiny interface (`get(key)`, `set(key, value, ttlMs)`, `delete(key)`) with concrete adapters: `SupabaseCacheLayer`, `MemoryCacheLayer`, `RequestScopedCacheLayer`. The three current caches re-express themselves on top.

2. **Cache events** — writes that affect cached data publish an event (`feedbackChanged(userId)`, `seedsChanged(userId)`, `settingsChanged(userId, fields)`). The explore cache subscribes and decides what to invalidate. Routes no longer import `invalidateExploreCache`; they just call the write API.

**Locality** — invalidation rules live next to the cache they invalidate, not scattered across 5 routes.
**Leverage** — new write paths automatically participate; new caches subscribe to the same event stream.
**Test surface** — invalidation rules become a single unit test (event in → calls out). Today you'd test it by writing through five different API routes.

**Before / After**

```
BEFORE                                    AFTER
                                          
5 API routes ──→ invalidateExploreCache   5 API routes ──→ emit cache event
                                                              │
4 cache styles, scattered                                     ▼
                                          1 CacheLayer<T> contract
                                          ├─ Supabase adapter
                                          ├─ Memory adapter
                                          └─ Request-scoped adapter
                                          
                                          explore cache subscribes ──→ knows its own rules
```

**Deletion test** — delete the `CacheLayer` interface alone and you get four scattered patterns back. Delete the event bus and you get five route-side imports back. Both earn their keep.

⚠ **Partial contradiction** — the current direct-import pattern (`invalidateExploreCache` called from each route) is simple and easy to grep. The event bus adds indirection. Worth reopening because the conditional invalidation logic in `/api/settings/route.ts` is already the second cost of the direct pattern; one more cache joining the system will tip it.

**Recommendation: Worth exploring** — the cache-layer contract is Strong; the event bus is the Worth-exploring half.

---

## #4 — Feedback / mutation handler duplication

**Files**

- `components/feed/feed-client.tsx` (lines ~94–138 — `handleFeedback`)
- `components/explore/explore-client.tsx` (lines ~159–204 — `handleFeedback`)

Plus near-duplicate save handlers, both backed by `createKeyedSerializer()` from `lib/keyed-serializer.ts`.

**Problem**

The two `handleFeedback` functions share ~80% of their logic:

- Check if signal is already set (toggle-off semantics)
- Optimistically update local state
- Enqueue the network call via per-artist serializer (so a rapid tap/tap doesn't race)
- POST `/api/feedback` or DELETE `/api/feedback/[artistId]`
- On error, roll back optimistic state and toast

The two differ only in a few specifics: explore has a `railKey` for cache invalidation, feed has its own "skip" semantics. Otherwise the optimistic + serialized + retryable mutation engine is the same.

**Proposed deepening**

One hook:

```
useArtistFeedback(opts?: { railKey?: string })
  -> { setSignal(artistId, signal | null): void, signals: Map<string, Signal> }
```

The hook owns: the signal map, the serializer, the optimistic update + rollback, the network call. Consumers just call `setSignal(id, "thumbs_up")` and read `signals.get(id)`.

A parallel `useArtistSaves()` does the same for `/api/saves`.

**Locality** — the "what happens when a user taps thumbs up" rule lives in one place.
**Leverage** — any new surface that wants feedback (history page, stats page, future widgets) gets it for free.
**Test surface** — the hook is the test surface: mock fetch, assert optimistic update + rollback. Today both client components must render to test feedback.

**Before / After**

```
BEFORE                              AFTER
                                    
feed-client                         feed-client     ──┐
 ├─ handleFeedback  ──┐                                ├─ useArtistFeedback() ──→ /api/feedback
 ├─ saveQueue        │                                │   useArtistSaves()    ──→ /api/saves
 └─ feedbackQueue    │             explore-client ──┘
                     │
explore-client       │             (one hook, one serializer, one fetch shape)
 ├─ handleFeedback  ──┤
 ├─ saveQueue        │
 └─ feedbackQueue    │
                     │
(2× ~50 LOC, drifting)
```

**Deletion test** — delete the hook, regrow two parallel ~50-line mutation engines, plus a third the next time someone adds a surface.

**Recommendation: Strong.**

---

## #5 — listened-artists triad

**File**

- `lib/listened-artists.ts` — 658 lines

**Problem**

The file does three distinct things:

1. **Spotify history accumulation** (`accumulateSpotifyHistory`, ~lines 46–78)
2. **Last.fm history accumulation** (`accumulateLastFmHistory`, ~lines 463–554)
3. **Name → Spotify ID resolution** (`resolveUnresolvedArtistIds` + batch upsert + inline `artist_search_cache`, ~lines 180–376)

Plus a batch-upsert routine inlined ~100 lines that hard-codes Supabase conflict codes and column names.

These three concerns share a table (`listened_artists`) but nothing else. The implicit ordering (accumulate-then-resolve) is invisible from outside. Adding a third source (e.g., Apple Music) duplicates the batch-upsert plumbing.

**Proposed deepening**

Three modules, all writing to the same table through one batch-upsert helper:

```
lib/history/
├─ spotify-syncer.ts      — owns Spotify top + recently-played sync
├─ lastfm-syncer.ts       — owns Last.fm sync
├─ artist-id-resolver.ts  — owns name-to-id (consumes artist_search_cache)
└─ batch-upsert.ts        — pure utility for chunked upserts with conflict handling
```

Public surface: a coordinator that runs syncers in order, then runs the resolver. Each syncer is independently testable.

**Locality** — adding stats.fm (already partially present in `lib/statsfm-listened-artists.ts`!) means writing one syncer, not editing 658 lines.
**Leverage** — the resolver is reusable: any place that has a name and wants an ID can call it.
**Test surface** — each syncer is one input → one DB effect; the resolver is one name → one ID (cacheable). Today the file's only seam is "run it and read the table."

**Before / After**

```
BEFORE                              AFTER
                                    
listened-artists.ts (658)           coordinator (~80)
├─ Spotify accum                       ├─ SpotifyHistorySyncer (~150)
├─ Last.fm accum                       ├─ LastFmHistorySyncer  (~150)
├─ ID resolution                       ├─ ArtistIdResolver     (~120)
├─ Batch upsert (inlined)              └─ BatchUpsertClient    (~80)  ← shared
└─ artist_search_cache (inlined)
```

**Deletion test** — split files can't merge back without re-tangling. The single file passes only because the file is the seam, not because the concerns are coupled.

**Recommendation: Worth exploring** — the split is clear, but the implicit ordering needs a deliberate redesign (do you fan out, or sequence?). One design conversation away from Strong.

---

## #6 — MusicProvider registry + ghost iTunes adapter

**Files**

- `lib/music-provider/index.ts` (interface)
- `lib/music-provider/spotify-provider.ts`
- `lib/music-provider/itunes.ts` (exists but never instantiated)
- `lib/music-provider/provider.ts` (hardcoded factory)
- `lib/music-provider/types.ts`

**Problem**

The `MusicProvider` interface is the most important seam in the app per `docs/design.md`. The interface itself is reasonable. But:

1. **One adapter is a hypothesis, two are a seam** — `SpotifyProvider` is the only live implementation. `itunes.ts` exists with tests but no caller. Until iTunes is actually instantiated, the seam is asserted by code that never runs through it.
2. **The factory is hardcoded** — `provider.ts` instantiates `SpotifyProvider` directly, so swapping for tests requires editing source.
3. **Result-type leakage** — `searchArtists` returns `Artist[] | RateLimited` and callers use an `isRateLimited()` type guard. The interface mixes successful and degraded results into one union. A `Result` shape (`{ ok: true, data } | { ok: false, reason }`) would be deeper.
4. **`SpotifyProvider._lastFmKeyMissing`** — static class field for warning suppression. Implementation detail leaking through the class shape.

**Proposed deepening**

```
getProvider(name: "spotify" | "itunes"): MusicProvider
```

with two real registered adapters (iTunes actually used in some path — even just as a fallback). The factory becomes a registry, and the iTunes adapter becomes load-bearing rather than aspirational.

Normalise result type to `{ ok, data } | { ok: false, reason: "rate-limited" | ... }`. Drop the type guard.

**Locality** — rate-limit handling lives in one type, not in every consumer's type-narrowing block.
**Leverage** — a future Deezer/Apple adapter slots into the registry with no consumer changes.
**Test surface** — providers can be swapped in tests by registering a fake adapter.

**Before / After**

```
BEFORE                              AFTER
                                    
provider.ts ──→ new SpotifyProvider()    getProvider(name)
                                          ├─ "spotify" → SpotifyProvider
itunes.ts (orphan, tests only)            └─ "itunes"  → ItunesProvider   ← actually used
                                          
returns Artist[] | RateLimited            returns { ok, data } | { ok: false, reason }
isRateLimited() guard in callers           ← no guard; pattern-match the result
```

**Deletion test** — delete the registry, callers paste `new SpotifyProvider()` back. Delete the result type, get the type-guard back at each call site. Both earn their keep, but only once iTunes is real.

**Recommendation: Worth exploring** — the deepening is right, but the trigger is "we actually want iTunes (or another provider) live." Before that, the registry is theoretical.

---

## #7 — ArtistCard split

**File**

- `components/feed/artist-card.tsx` — 497 lines

**Problem**

One client component handles:

- Hero image rendering + color sanitization (calls `lib/color-utils`)
- Track fetch for missing tracks via `/api/artists/[id]/tracks` (lines ~148–173)
- Inline track strip
- Collapsed/expanded animations (framer-motion)
- Thumbs up / down / save / dismiss button handlers
- Track playback (audio context consumer)

The component is reused on Feed and Explore via an adapter (`railArtistToRecommendation()`). The adapter exists because the two surfaces hold artists in slightly different shapes — itself a small signal that the contract is fuzzy.

**Proposed deepening**

```
ArtistCardShell        — layout, animation, prop contract  (~150 LOC)
└─ ArtistCardContent   — image, color, body                (~150 LOC)
    └─ TrackStrip      — track list + playback             (~150 LOC, already separate)

useArtistTracks(artistId)  — owns the /api/artists/[id]/tracks fetch + cache + state
useArtistColor(artist)     — owns the color resolve / fallback-to-name-hash logic
```

The `railArtistToRecommendation()` adapter goes away in favour of one stable `Artist` shape that both surfaces respect.

**Locality** — visual changes touch the shell, behaviour changes touch the hooks. Today both touch one 497-line file.
**Leverage** — the tracks hook becomes usable from history, stats, saved (currently each does its own thing).
**Test surface** — the hooks are unit-testable; the shell is render-snapshotable.

**Before / After**

```
BEFORE                              AFTER
                                    
ArtistCard (497)                    ArtistCardShell (~150)
├─ image + color                     ├─ ArtistCardContent (~150)
├─ track fetch                       │   ├─ useArtistColor()
├─ track strip                       │   └─ TrackStrip (~150)
├─ animation                         │       └─ useArtistTracks()
├─ buttons                           └─ animation
└─ playback                          
                                    (one Artist shape, no adapter)
adapter: railArtistToRecommendation
```

**Deletion test** — delete the hooks and the same fetch+state logic re-grows in artist-card and saved-client and history-client.

**Recommendation: Worth exploring** — the hook extractions are Strong. The shell/content split is Worth exploring — depends on whether the framer-motion ergonomics survive.

---

## #8 — API route auth/validate shell

**Scope**

- 24 route handlers under `app/api/`
- ~18 of them follow the same shape: `auth() → CSRF → JSON parse → validate → DB op → invalidate → respond`

**Problem**

The same prologue ("`auth`, check `session?.user?.id`, then `enforceSameOrigin`, then `await request.json().catch(() => ({}))`, then validate the body shape") appears at the top of nearly every route. The same epilogue (`apiError`, `dbError`, `apiUnauthorized` from `lib/errors.ts`) appears at the bottom.

The patterns are *consistent*, which means the abstraction is genuinely lurking — there's a deep module waiting to be named.

**Proposed deepening**

```
withAuthedRoute(handler: (ctx: { userId, body, supabase }) => Response | Promise<Response>)
```

The wrapper does: `safeAuth()` → 401 if missing → CSRF → JSON parse → catch + wrap in `apiError`. Handlers shrink to the part that's actually theirs.

Plus a small `validate(body, schema)` helper so each route's input contract is one line instead of a manual block.

**Locality** — security checks live in one place. The day you need to add rate limiting per route or a request-id, you do it once.
**Leverage** — every new route is shorter and starts safe-by-default.
**Test surface** — the wrapper is testable independently; route handlers are testable as pure `ctx → response` functions.

**Before / After**

```
BEFORE (per route, ~18×)           AFTER (per route)
                                   
const session = await auth()       export const POST = withAuthedRoute(async (ctx) => {
if (!session?.user?.id)              const body = ctx.validate(MySchema)
  return apiUnauthorized()           // ... business logic
const userId = session.user.id      return Response.json({ ok: true })
const blocked = enforceSameOrigin   })
if (blocked) return blocked
let body = await request.json()
  .catch(() => ({}))
// ... validation
// ... business logic
```

**Deletion test** — delete the wrapper, the 18 routes regrow the same 10-line prologue.

⚠ **Contradicts current pattern** — Next.js App Router conventions push you toward inline route bodies. The deepening is a soft wrapper, not a framework change, but it does swim against "just write the handler" idioms.

**Recommendation: Worth exploring** — the win is large but the abstraction needs to compose with Next.js types cleanly. One design pass away from Strong.

---

## Top recommendation: tackle #1 first

If you only pick one:

**#1 — Adventurous mode seam.**

- Smallest effort, highest information.
- Four files reduce to one + four call sites of `useAdventurousMode()`.
- The pattern this establishes (one hook owns localStorage + window event + API write) is exactly what #2 (Settings monolith) and #4 (Feedback hook) need next.
- No risk: the behaviour is preserved exactly; the event is still emitted; localStorage is still the source of truth for unauthed reads.
- Becomes the **template** for the other deepenings.

Second pick: **#4 (Feedback mutation hook)** — same shape (consolidate a behaviour spread across two-plus surfaces), high reuse, very low risk.

Third pick: **#2 (Settings monolith)** — biggest single readability win in the codebase. Bigger blast radius than #1 or #4, but each panel can be split independently.

---

## Out of scope for this review

These were considered and excluded:

- **Recommendation engine split.** `lib/recommendation/engine.ts` is 948 lines but the depth is genuine — scoring, clustering, filtering, and seed-gathering are tightly coupled by design. The only minor friction (magic-number constants, secondary-batch callback) is too small to recommend.
- **Genre module.** `lib/genre/` is already deep and well-tested.
- **Supabase client factories.** Shallow but appropriately so — they save boilerplate without hiding behaviour.
- **Crypto module.** Deep for its size; nothing to change.

## Descoped during implementation

### #3 Cache layer — descoped after closer reading

On the surface this looked like a clear consolidation candidate (three caches + scattered invalidation). On closer reading, the three caches have **genuinely different semantics**:

- `lib/lastfm-cache.ts` — Supabase-backed TTL read-through, single get/set with in-flight dedup.
- `lib/recommendation/artist-name-cache.ts` — Supabase-backed, **no TTL** (artist identities don't expire), supports **batch reads** of up to 500 names per call.
- `lib/user-cache.ts` — **React per-request `cache()`** for server-component dedup, not a persistent cache at all.

A `CacheLayer<T>` abstraction with `get/set/delete/ttl` would force all three to fit the same shape, but TTL is meaningless for artist-name, batch is meaningless for lastfm, and React `cache()` is fundamentally a different mechanism. The plan's claim that "three caches re-express themselves on top" was wrong on closer inspection — the deletion test fails (deleting the interface concentrates nothing).

The event-bus invalidation half was already deferred in the original plan due to functional-change risk (see #3 entry above).

**Decision:** skip #3 entirely. The friction it described is real but the proposed cure does not earn its keep.

### #6 MusicProvider registry — deferred

`itunes.ts` exists in `lib/music-provider/` but has no live consumer. Per the plan, the registry abstraction is only justified once a second provider is actually wired into production. Revisit when adding a second live provider.

---

## Verification (how to confirm none of this changes app behavior)

This review proposes **zero functional changes**. If any candidate is pursued later, verify with:

- `npm test` — vitest unit tests for genre, recommendation, music-provider, artist-name-cache must still pass
- Manual: sign in → onboarding → feed loads → thumbs up an artist → tab to Explore → toggle Adventurous → tab to Settings → confirm Adventurous reflects, change a setting, return to Feed
- Manual: sign in on tab A and tab B → toggle Adventurous on A → confirm B updates within the same session
- Manual: refresh after each toggle to confirm persistence
- Server logs: no new errors during the manual flow

---

# Candidate #1 — Grilled design: `useAdventurousMode()`

## Decision log

The four-consumer adventurous-mode pattern reduces to one hook. Below is the design after grilling each branch of the decision tree against the existing code in `components/visual/ambient.tsx`, `components/nav/app-nav.tsx`, `components/settings/settings-form.tsx`, and `components/explore/explore-client.tsx`.

### 1. Ownership model — per-instance, synced via window event

Each `useAdventurousMode()` call has its own `useState`. State is kept in sync across consumers via the existing `"flipside:adventurous-change"` window event and the browser-native `storage` event. **No React context.**

**Why** — preserves the current architectural choice (event bus over context), works in any component without provider wrapping, matches today's behavior exactly. Cross-tab sync via `storage` already works in Ambient and AppNav; the hook generalises that.

### 2. Initial value — required prop

```
useAdventurousMode(initial: boolean): { adventurous, setAdventurous }
```

The caller must pass an initial value, typically from `user.adventurous` rendered server-side. The hook does **not** read localStorage on mount as a primary source — that would risk hydration mismatch.

**Why** — Three of the four consumers already receive `initialAdventurous` from the server. Ambient is the lone exception (it has no server-rendered value because it sits in the layout). For Ambient, callers pass `false` as initial and the hook reconciles to localStorage on mount.

### 3. localStorage role — reconciliation cache, not source of truth

On mount, the hook reads localStorage and reconciles if it differs from `initial`. After mount, localStorage is updated on every successful write. Reads from localStorage happen only:
- Once on mount (reconciliation)
- On `"flipside:adventurous-change"` window event (in-tab sync)
- On `"storage"` window event with key `"flipside.adventurous"` (cross-tab sync)

**Why** — preserves current cross-tab semantics; lets unauthenticated paths (if they exist) work without an API; bounded surface for localStorage failure modes (private browsing).

### 4. Writer — single `setAdventurous(next): Promise<void>`

`setAdventurous` performs:
1. Optimistic local state update (immediate)
2. PATCH `/api/settings` with `{ adventurous: next }`
3. On success: write localStorage, dispatch window event
4. On failure: roll back local state, reject the promise

The hook returns the Promise. **Callers decide what to do after success** — e.g., Settings calls `handleRegenerateBoth()`, Explore sets `isAdvDirty=true`. Neither lives inside the hook.

**Why** — the post-success behavior is different in each writer and is legitimately caller-specific (rebuild cache vs. show "Apply" button). Pushing it into the hook would either bloat the interface or hide caller-specific behavior behind the seam.

### 5. Storage key, event name — constants exported from the hook module

```
export const ADVENTUROUS_STORAGE_KEY = "flipside.adventurous"
export const ADVENTUROUS_EVENT_NAME = "flipside:adventurous-change"
```

**Why** — the magic strings exist today, scattered across four files. Centralising them in the hook module is half the value of the refactor. Tests can import the constants instead of hardcoding strings.

### 6. SSR safety — `useEffect` for all browser-only work

All `window` / `localStorage` reads happen inside `useEffect`. The initial render uses only the `initial` prop. **No hydration mismatch.**

### 7. Failure handling — promise rejection, no built-in toast

The hook does not call `toast.error()`. Callers wrap `setAdventurous` in a try/catch and surface failure their own way (Settings and Explore already do this, with subtly different messages: "Failed to save setting" vs "Couldn't toggle — try again").

**Why** — toasts are presentation. The hook owns persistence + sync, not UX.

### 8. Test surface

Vitest + React Testing Library. The hook is the test surface:

| Test | Assertion |
|------|-----------|
| Initial render | `adventurous === initial` |
| `setAdventurous(true)` success | calls fetch with correct body; resolves; sets `adventurous = true`; localStorage = "1"; event dispatched |
| `setAdventurous(true)` failure | rolls back to previous value; rejects; localStorage unchanged; no event |
| Receives `flipside:adventurous-change` event | re-reads localStorage; updates state |
| Receives `storage` event for `"flipside.adventurous"` key | re-reads localStorage; updates state |
| Receives `storage` event for a different key | ignored |
| localStorage throws on read (private mode) | falls back to `initial` silently |
| localStorage throws on write | promise still resolves on PATCH success; state is correct; event still dispatched |

Today none of these are testable — each component would need to be rendered and the global window mocked.

---

## Interface sketch (not implementation)

```
// lib/hooks/use-adventurous-mode.ts
//
// Single seam for "is adventurous mode on?" across the app.
//
// Replaces the duplicated localStorage + window event + PATCH pattern
// that currently lives in:
//   components/visual/ambient.tsx
//   components/nav/app-nav.tsx
//   components/settings/settings-form.tsx
//   components/explore/explore-client.tsx

export const ADVENTUROUS_STORAGE_KEY = "flipside.adventurous"
export const ADVENTUROUS_EVENT_NAME  = "flipside:adventurous-change"

export interface UseAdventurousModeResult {
  adventurous: boolean
  setAdventurous: (next: boolean) => Promise<void>
}

export function useAdventurousMode(initial: boolean): UseAdventurousModeResult
```

**Behavior contract:**

- `adventurous` reflects current state.
- `setAdventurous(next)` optimistically updates state, PATCHes `/api/settings`, writes localStorage + dispatches the event on success, rolls back + rejects on failure.
- State updates whenever `ADVENTUROUS_EVENT_NAME` fires on `window` (in-tab) or a `storage` event for `ADVENTUROUS_STORAGE_KEY` fires (cross-tab).
- localStorage read/write failures are silently ignored (private browsing, blocked storage).

---

# Refactor plan — tiny commits

Each commit is independently verifiable and reversible. The hook is introduced first, then consumers migrate one at a time. No commit changes user-visible behavior.

| # | Commit | Files | Verify |
|---|--------|-------|--------|
| 1 | Add hook + tests | `lib/hooks/use-adventurous-mode.ts` (new), `lib/hooks/use-adventurous-mode.test.ts` (new) | `npm test` — new tests pass; no consumers using it yet |
| 2 | Migrate `Ambient` | `components/visual/ambient.tsx` | Manual: every page still shows correct ambient palette; toggle in Settings still flips it |
| 3 | Migrate `AppNav` | `components/nav/app-nav.tsx` | Manual: nav `.adventurous` class still toggles on Settings toggle |
| 4 | Migrate `SettingsForm` toggle | `components/settings/settings-form.tsx` (only the `handleAdventurousToggle` + `useState(initialAdventurous)` lines) | Manual: toggle in Settings still PATCHes, still rebuilds rails, still shows error toast on failure |
| 5 | Migrate `ExploreClient` toggle | `components/explore/explore-client.tsx` | Manual: toggle in Explore still flips, still gates `isAdvDirty`, still rolls back on failure |
| 6 | (Optional) Cross-tab smoke test | none — just verification | Sign in on tab A and tab B → toggle on A → confirm B reflects without refresh |

**Total surface:** 1 new file + 1 new test + 4 small edits to existing files. ~150 LOC removed, ~120 LOC added (net ~30 lines smaller).

**Risk profile:** Low. Each migration step touches one consumer and preserves the wire contract. The hook is grep-able by name, and the old localStorage/event API is unchanged from the outside (only the implementation moves).

**Rollback:** Revert the relevant commit. The hook can coexist with un-migrated consumers indefinitely.

---

# Verification — manual + automated

**Before merging:**

1. `npm test` — all existing tests + new hook tests pass.
2. `npm run lint` — no new warnings.
3. Manual flow (one pass through the app):
   - Sign in
   - Tab to Settings → toggle Adventurous ON → confirm: Settings toggle visually flips, ambient palette changes, nav `.adventurous` class applied
   - Tab to Explore → confirm Adventurous reflects ON → toggle OFF in Explore header → confirm "Apply" button appears
   - Tap "Apply" → confirm rails rebuild
   - Tab back to Settings → confirm toggle reflects OFF
   - Force a PATCH failure (DevTools → Network → block `/api/settings`) → toggle → confirm error toast + state rollback
4. Cross-tab manual:
   - Open the app in tab A and tab B
   - Toggle Adventurous in tab A
   - Confirm tab B reflects within a second (without refresh)

**No DB migration. No env var. No new dependency.**

