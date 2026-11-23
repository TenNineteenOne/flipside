# Issue 06 — Colour Extraction Pipeline

**Type:** AFK
**Blocked by:** None — start immediately

## What to build

Extract a dominant accent colour from each artist's Spotify image at recommendation-generation time and store it globally so every user benefits from a single extraction per artist.

### Schema change

Add an `artist_color TEXT` column (nullable) to the `artist_search_cache` table. No other schema changes.

### New module: `lib/colour-extraction.ts`

Create a module that exports a single function:

```
extractArtistColor(imageUrl: string): Promise<string>
```

- Install `@vibrant/node` (or `node-vibrant`) as a server dependency.
- Extract the dominant vibrant swatch from the image URL.
- Before returning, verify the extracted hex passes WCAG AA contrast against `#000000` (this is the button text colour). The contrast ratio must be ≥ 4.5:1.
- If it fails contrast, lighten the colour incrementally (e.g., increase lightness in HSL space by 5% steps) until it passes or reaches white.
- If extraction throws for any reason, return `#8b5cf6` (the brand accent fallback).
- If the extracted colour is too dark to be lightened to passing contrast, return `#8b5cf6`.

### Integration in the generate route

After the final ranked list of artists is produced:

1. For each artist, check `artist_search_cache` for an existing `artist_color` value.
2. If already set (non-null), use the stored value — no re-extraction.
3. If null, call `extractArtistColor(artist.imageUrl)` and write the result back to `artist_search_cache`.
4. Include `artist_color` in the recommendation payload returned to the client.

Run extractions in parallel (Promise.all) for artists missing a colour, but only for those missing — do not re-extract already-cached values.

### Notes

- Extraction happens server-side only, never in the browser.
- The fallback `#8b5cf6` must be used client-side when `artist_color` is null (e.g., for artists added to the cache before this feature shipped). The client should not wait for extraction.
- Keep `@vibrant/node` out of the client bundle — import only in server files.

## Acceptance criteria

- [ ] `artist_color` column exists on `artist_search_cache`
- [ ] Running recommendation generation populates `artist_color` for all ranked artists
- [ ] Re-running generation does not re-extract colours for artists already in cache
- [ ] A colour that fails WCAG AA contrast against black is lightened until it passes
- [ ] When extraction throws, `#8b5cf6` is returned instead of crashing
- [ ] `artist_color` is included in the recommendation API response payload
- [ ] Unit tests: contrast failure → lightened; extraction error → fallback; very dark colour → fallback

## Blocked by

None — can start immediately.

## User stories addressed

- Story 39: Each artist card/drawer displays a colour derived from the artist's Spotify image
- Story 40: Colour applied to four elements: genre tag, track strip bg+border, play button, Save button
- Story 41: Purple fallback when artist colour is not yet loaded
- Story 42: Colour pre-computed server-side and stored in DB
