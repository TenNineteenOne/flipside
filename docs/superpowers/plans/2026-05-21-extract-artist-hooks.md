# Extract useArtistTracks and useArtistColor Hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the inline track-fetching effect and color-resolution memo from `ArtistCard` into dedicated, testable hooks, and migrate `SavedClient` to use the shared pure helper.

**Architecture:** Two new hook files in `lib/hooks/` following the established pattern (pure helpers exported alongside the hook for testability). `resolveArtistColor` is a pure function reusable outside React. `useArtistTracks` wraps the existing fetch effect, `useArtistColor` wraps a `useMemo`.

**Tech Stack:** React 18, Next.js, TypeScript, Vitest (node env, no jsdom)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/hooks/use-artist-tracks.ts` | Track-fetching hook + `buildArtistTracksUrl` helper |
| Create | `lib/hooks/use-artist-tracks.test.ts` | Pure-helper tests |
| Create | `lib/hooks/use-artist-color.ts` | Color-resolution hook + `resolveArtistColor` helper |
| Create | `lib/hooks/use-artist-color.test.ts` | Pure-helper tests |
| Modify | `components/feed/artist-card.tsx` | Replace inline useMemo + useState + useEffect with hook calls |
| Modify | `components/saved/saved-client.tsx` | Replace local `resolveColor` fn with `resolveArtistColor` |

---

### Task 1: Create `lib/hooks/use-artist-color.ts`

**Files:**
- Create: `lib/hooks/use-artist-color.ts`

- [ ] **Step 1: Write the file**

```ts
"use client"

import { useMemo } from "react"
import { sanitizeHex, stringToVibrantHex } from "@/lib/color-utils"

// ─── Testable pure helper ─────────────────────────────────────────────────────
// Exported so tests and non-React callers (e.g. saved-client.tsx) can use
// this without a hook wrapper.

/**
 * Resolve the display color for an artist.
 *
 * sanitizeHex returns "#8b5cf6" as its fallback when the stored color is null,
 * undefined, empty, or an invalid hex. We treat that sentinel as "no real color"
 * and fall back to the deterministic name-hash so every artist gets a
 * distinctive tint.
 */
export function resolveArtistColor(rawColor: string | null | undefined, artistName: string): string {
  const sanitized = sanitizeHex(rawColor)
  if (sanitized === "#8b5cf6") return stringToVibrantHex(artistName)
  return sanitized
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Memoized artist color resolution.
 *
 * Returns the sanitized hex when valid (non-default), or a deterministic
 * vibrant color derived from the artist name when the stored color is absent
 * or the default sentinel (#8b5cf6).
 */
export function useArtistColor(rawColor: string | null | undefined, artistName: string): string {
  return useMemo(
    () => resolveArtistColor(rawColor, artistName),
    [rawColor, artistName],
  )
}
```

- [ ] **Step 2: Verify file was written**

```bash
wc -l lib/hooks/use-artist-color.ts
```

---

### Task 2: Create `lib/hooks/use-artist-color.test.ts`

**Files:**
- Create: `lib/hooks/use-artist-color.test.ts`

- [ ] **Step 1: Write the test file**

```ts
/**
 * Tests for use-artist-color hook helpers.
 *
 * The vitest environment is "node" (no DOM / jsdom), so we test the exported
 * pure helper resolveArtistColor rather than rendering the hook via renderHook.
 *
 * sanitizeHex contract (from lib/color-utils.ts):
 *   - Valid 6-digit hex with "#" prefix → returned as-is.
 *   - null / undefined / empty / invalid → returns "#8b5cf6" (the fallback).
 *
 * resolveArtistColor contract:
 *   - When sanitizeHex returns "#8b5cf6" → return stringToVibrantHex(artistName).
 *   - When sanitizeHex returns a valid non-default hex → return that hex.
 */

import { describe, it, expect } from "vitest"
import { resolveArtistColor } from "./use-artist-color"
import { stringToVibrantHex } from "@/lib/color-utils"

const DEFAULT_SENTINEL = "#8b5cf6"

describe("resolveArtistColor", () => {
  it("returns name-hash color when rawColor is null", () => {
    const result = resolveArtistColor(null, "Radiohead")
    expect(result).toBe(stringToVibrantHex("Radiohead"))
    expect(result).not.toBe(DEFAULT_SENTINEL)
  })

  it("returns name-hash color when rawColor is undefined", () => {
    const result = resolveArtistColor(undefined, "Björk")
    expect(result).toBe(stringToVibrantHex("Björk"))
  })

  it("returns name-hash color when rawColor is empty string", () => {
    const result = resolveArtistColor("", "FKA twigs")
    expect(result).toBe(stringToVibrantHex("FKA twigs"))
  })

  it("returns name-hash color when rawColor is an invalid hex (sanitizeHex returns sentinel)", () => {
    const result = resolveArtistColor("notahex", "Portishead")
    expect(result).toBe(stringToVibrantHex("Portishead"))
  })

  it("returns name-hash color when rawColor is the default sentinel #8b5cf6 itself", () => {
    // The DB stores this sentinel when album art hasn't been processed yet.
    const result = resolveArtistColor("#8b5cf6", "Massive Attack")
    expect(result).toBe(stringToVibrantHex("Massive Attack"))
  })

  it("returns the sanitized color when rawColor is a valid non-default hex", () => {
    const result = resolveArtistColor("#1db954", "Spotify Test")
    expect(result).toBe("#1db954")
  })

  it("returns the sanitized color for another valid non-default hex", () => {
    const result = resolveArtistColor("#ff6b35", "The National")
    expect(result).toBe("#ff6b35")
  })

  it("is case-preserving for valid hex (sanitizeHex returns input as-is when valid)", () => {
    // sanitizeHex accepts uppercase hex and returns it unchanged
    const result = resolveArtistColor("#AABBCC", "Beach House")
    expect(result).toBe("#AABBCC")
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run lib/hooks/use-artist-color.test.ts
```

Expected: all tests pass.

---

### Task 3: Create `lib/hooks/use-artist-tracks.ts`

**Files:**
- Create: `lib/hooks/use-artist-tracks.ts`

- [ ] **Step 1: Write the file**

```ts
"use client"

import { useEffect, useState } from "react"
import type { Track } from "@/lib/music-provider/types"

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseArtistTracksOptions {
  artistId: string
  artistName: string
  initialTracks: Track[]
}

export interface UseArtistTracksResult {
  tracks: Track[]
  isFetching: boolean
}

// ─── Testable pure helpers ────────────────────────────────────────────────────
// Exported so tests can call them without React.

/**
 * Build the URL for fetching tracks for a given artist.
 */
export function buildArtistTracksUrl(artistId: string, artistName: string): string {
  return `/api/artists/${artistId}/tracks?name=${encodeURIComponent(artistName)}`
}

/**
 * Given a fetch response body, return the tracks array if it is non-empty,
 * or null if there is nothing worth setting (empty or missing).
 */
export function extractTracksFromResponse(data: unknown): Track[] | null {
  if (
    data !== null &&
    typeof data === "object" &&
    "tracks" in data &&
    Array.isArray((data as { tracks: unknown }).tracks) &&
    (data as { tracks: Track[] }).tracks.length > 0
  ) {
    return (data as { tracks: Track[] }).tracks
  }
  return null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages local track state for an artist card, fetching from the API when
 * the artist has no pre-fetched tracks.
 *
 * Mirrors the inline effect that previously lived in ArtistCard (lines 144–173).
 * The eslint-disable comment below is intentional: the effect only depends on
 * the three values that gate the fetch — not on isFetchingTracks — to avoid
 * re-running the effect after the state update that sets isFetchingTracks=true.
 */
export function useArtistTracks({
  artistId,
  artistName,
  initialTracks,
}: UseArtistTracksOptions): UseArtistTracksResult {
  const [tracks, setTracks] = useState<Track[]>(initialTracks)
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    if (initialTracks.length === 0 && tracks.length === 0 && !isFetching) {
      const ctrl = new AbortController()
      setIsFetching(true)
      fetch(buildArtistTracksUrl(artistId, artistName), { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error("fetch failed")
          return r.json()
        })
        .then((data) => {
          if (ctrl.signal.aborted) return
          const extracted = extractTracksFromResponse(data)
          if (extracted) setTracks(extracted)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return
          // Silent — caller shows "No tracks available" fallback.
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setIsFetching(false)
        })
      return () => ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fetch once when tracks are empty
  }, [initialTracks.length, artistName, artistId])

  return { tracks, isFetching }
}
```

- [ ] **Step 2: Verify file was written**

```bash
wc -l lib/hooks/use-artist-tracks.ts
```

---

### Task 4: Create `lib/hooks/use-artist-tracks.test.ts`

**Files:**
- Create: `lib/hooks/use-artist-tracks.test.ts`

- [ ] **Step 1: Write the test file**

```ts
/**
 * Tests for use-artist-tracks hook helpers.
 *
 * The vitest environment is "node" (no DOM / jsdom), so we test the exported
 * pure helpers that the hook composes rather than rendering the hook.
 *
 *   buildArtistTracksUrl     — URL construction, encoding
 *   extractTracksFromResponse — response shape parsing
 */

import { describe, it, expect } from "vitest"
import { buildArtistTracksUrl, extractTracksFromResponse } from "./use-artist-tracks"
import type { Track } from "@/lib/music-provider/types"

// ─── buildArtistTracksUrl ─────────────────────────────────────────────────────

describe("buildArtistTracksUrl", () => {
  it("builds the correct URL for a plain artist ID and name", () => {
    expect(buildArtistTracksUrl("abc123", "Radiohead")).toBe(
      "/api/artists/abc123/tracks?name=Radiohead",
    )
  })

  it("URL-encodes the artist name (spaces)", () => {
    expect(buildArtistTracksUrl("xyz", "Nine Inch Nails")).toBe(
      "/api/artists/xyz/tracks?name=Nine%20Inch%20Nails",
    )
  })

  it("URL-encodes special characters in the artist name (ampersand, accents)", () => {
    expect(buildArtistTracksUrl("id1", "Sigur Rós")).toBe(
      "/api/artists/id1/tracks?name=Sigur%20R%C3%B3s",
    )
  })

  it("URL-encodes artist name with plus sign and slash", () => {
    const url = buildArtistTracksUrl("id2", "AC/DC")
    expect(url).toBe("/api/artists/id2/tracks?name=AC%2FDC")
  })
})

// ─── extractTracksFromResponse ────────────────────────────────────────────────

const sampleTrack: Track = {
  id: "t1",
  spotifyTrackId: null,
  name: "Creep",
  previewUrl: null,
  durationMs: 238000,
  albumName: "Pablo Honey",
  albumImageUrl: null,
  source: "spotify",
}

describe("extractTracksFromResponse", () => {
  it("returns the tracks array when data.tracks is non-empty", () => {
    const data = { tracks: [sampleTrack] }
    expect(extractTracksFromResponse(data)).toEqual([sampleTrack])
  })

  it("returns null when data.tracks is an empty array", () => {
    expect(extractTracksFromResponse({ tracks: [] })).toBeNull()
  })

  it("returns null when data has no tracks key", () => {
    expect(extractTracksFromResponse({ other: "stuff" })).toBeNull()
  })

  it("returns null when data is null", () => {
    expect(extractTracksFromResponse(null)).toBeNull()
  })

  it("returns null when data is a string", () => {
    expect(extractTracksFromResponse("not-an-object")).toBeNull()
  })

  it("returns null when data.tracks is not an array", () => {
    expect(extractTracksFromResponse({ tracks: "bad" })).toBeNull()
  })

  it("returns all tracks when data.tracks has multiple entries", () => {
    const track2: Track = { ...sampleTrack, id: "t2", name: "Karma Police" }
    const data = { tracks: [sampleTrack, track2] }
    const result = extractTracksFromResponse(data)
    expect(result).toHaveLength(2)
    expect(result![0].id).toBe("t1")
    expect(result![1].id).toBe("t2")
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run lib/hooks/use-artist-tracks.test.ts
```

Expected: all tests pass.

---

### Task 5: Migrate `components/feed/artist-card.tsx`

**Files:**
- Modify: `components/feed/artist-card.tsx`

- [ ] **Step 1: Update imports**

Replace the existing import block at the top of the file. Change:

```ts
import { memo, useCallback, useState, useEffect, useMemo } from "react"
```

To:

```ts
import { memo, useCallback } from "react"
```

And add these two imports (alongside existing hook imports):

```ts
import { useArtistTracks } from "@/lib/hooks/use-artist-tracks"
import { useArtistColor } from "@/lib/hooks/use-artist-color"
```

Also remove `stringToVibrantHex` and `sanitizeHex` from the color-utils import since they are no longer called directly in the component. Change:

```ts
import { stringToVibrantHex, hexToRgba, sanitizeHex } from "@/lib/color-utils"
```

To:

```ts
import { hexToRgba } from "@/lib/color-utils"
```

- [ ] **Step 2: Replace the useMemo for artistColor (lines ~136–140)**

Remove:

```ts
  const artistColor = useMemo(() => {
    const c = sanitizeHex(artist_color)
    if (c === "#8b5cf6") return stringToVibrantHex(artist_data.name)
    return c
  }, [artist_color, artist_data.name])
```

Replace with:

```ts
  const artistColor = useArtistColor(artist_color, artist_data.name)
```

- [ ] **Step 3: Replace the useState + useEffect for tracks (lines ~144–173)**

Remove:

```ts
  const [localTracks, setLocalTracks] = useState<Track[]>(artist_data.topTracks)
  const [isFetchingTracks, setIsFetchingTracks] = useState(false)

  useEffect(() => {
    if (artist_data.topTracks.length === 0 && localTracks.length === 0 && !isFetchingTracks) {
      const ctrl = new AbortController()
      setIsFetchingTracks(true)
      fetch(
        `/api/artists/${recommendation.spotify_artist_id}/tracks?name=${encodeURIComponent(artist_data.name)}`,
        { signal: ctrl.signal },
      )
        .then((r) => {
          if (!r.ok) throw new Error("fetch failed")
          return r.json()
        })
        .then((data) => {
          if (ctrl.signal.aborted) return
          if (data.tracks?.length > 0) setLocalTracks(data.tracks)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return
          // Silent — user still sees "No tracks available" fallback.
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setIsFetchingTracks(false)
        })
      return () => ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fetch once when tracks are empty
  }, [artist_data.topTracks.length, artist_data.name, recommendation.spotify_artist_id])
```

Replace with:

```ts
  const { tracks: localTracks, isFetching: isFetchingTracks } = useArtistTracks({
    artistId: recommendation.spotify_artist_id,
    artistName: artist_data.name,
    initialTracks: artist_data.topTracks,
  })
```

- [ ] **Step 4: Remove unused Track import if it's no longer needed**

Check if `Track` is still used elsewhere in the file. If not, remove it from:

```ts
import type { Track } from "@/lib/music-provider/types"
```

- [ ] **Step 5: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: no errors related to artist-card.tsx.

---

### Task 6: Migrate `components/saved/saved-client.tsx`

**Files:**
- Modify: `components/saved/saved-client.tsx`

- [ ] **Step 1: Update imports**

Add the import for `resolveArtistColor`:

```ts
import { resolveArtistColor } from "@/lib/hooks/use-artist-color"
```

Remove `stringToVibrantHex` and `sanitizeHex` from color-utils import since they're no longer called directly. Change:

```ts
import { stringToVibrantHex, sanitizeHex, hexToRgba } from "@/lib/color-utils"
```

To:

```ts
import { hexToRgba } from "@/lib/color-utils"
```

- [ ] **Step 2: Remove the local resolveColor function (lines 35–40)**

Remove:

```ts
// DB stores #8b5cf6 as the default artist_color when album art hasn't been
// processed yet. Treat that sentinel as "no real color" and fall back to the
// deterministic name-hash so every artist gets a distinctive tint.
const DEFAULT_SENTINEL = "#8b5cf6"
function resolveColor(artist: SavedArtistRow): string {
  const sanitized = sanitizeHex(artist.artistColor)
  if (sanitized && sanitized.toLowerCase() !== DEFAULT_SENTINEL) return sanitized
  return stringToVibrantHex(artist.name)
}
```

- [ ] **Step 3: Update all three call sites**

Replace all three `resolveColor(...)` calls with `resolveArtistColor(artist.artistColor, artist.name)` (or `resolveArtistColor(visible[N].artistColor, visible[N].name)` for the `c1`/`c2` cases).

Change:
```ts
  const c1 = visible[0] ? resolveColor(visible[0]) : accent
  const c2 = visible[1] ? resolveColor(visible[1]) : "#ec6fb5"
```

To:
```ts
  const c1 = visible[0] ? resolveArtistColor(visible[0].artistColor, visible[0].name) : accent
  const c2 = visible[1] ? resolveArtistColor(visible[1].artistColor, visible[1].name) : "#ec6fb5"
```

Change (inside the `.map()` callback):
```ts
            const color = resolveColor(artist)
```

To:
```ts
            const color = resolveArtistColor(artist.artistColor, artist.name)
```

- [ ] **Step 4: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: no errors related to saved-client.tsx.

---

### Task 7: Run full test + lint suite

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass, including the two new test files.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no new errors or warnings.

- [ ] **Step 3: Run full type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.
