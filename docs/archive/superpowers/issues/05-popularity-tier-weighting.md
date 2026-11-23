# Issue 05 — Popularity Tier Weighting

**Type:** AFK
**Blocked by:** Issue 04 (play threshold must be correct before reweighting)

## What to build

Replace the existing hard popularity cap in the recommendation engine with a continuous tier multiplier system that heavily favours underground artists.

### Current behaviour

The engine applies a hard cap: only artists with popularity ≤ 55 are included (≤ 65 as a fallback if fewer than 5 results). This produces acceptable underground bias but excludes mid-tier artists too bluntly.

### New behaviour

After computing the discovery score for each candidate artist, apply a tier multiplier based on Spotify popularity:

| Tier | Popularity range | Multiplier |
|------|-----------------|------------|
| Underground | 0–30 | × 1.0 (full weight) |
| Mid | 31–60 | × 0.25 |
| Mainstream | 61–100 | × 0.02 |

**Weighted score = discovery_score × tier_multiplier**

Sort the candidate list descending by weighted score. Remove the old hard cap logic entirely — the multiplier replaces it with a soft continuous preference.

The existing discovery score formula is unchanged:
```
discoveryScore = (100 - popularity)² / 100² × 0.8 + seedRelevance × 0.2
```

The multiplier is applied after this calculation.

### Notes

- Underground artists (0–30) keep their full score. A mainstream artist (popularity 80) with a perfect seed relevance would score roughly: `((20²/10000) × 0.8 + 1.0 × 0.2) × 0.02 ≈ 0.007` — nearly zero.
- The "at least 5 results" fallback cap logic should be removed. If the pool after filtering is small, return what's available rather than relaxing the cap.

## Acceptance criteria

- [ ] Given a pool of artists spanning all popularity tiers, underground artists rank first
- [ ] Mainstream artists (popularity > 60) appear at or near the bottom of the ranked list
- [ ] The old hard cap (≤ 55 / ≤ 65) is removed from the engine
- [ ] Unit tests cover: underground artist ranks above mainstream artist with equal seed relevance; mid artist ranks below underground but above mainstream

## Blocked by

- Blocked by Issue 04 (play threshold fix)

## User stories addressed

- Story 45: Feed heavily favours artists with popularity 0–30
- Story 46: Mid-tier artists (31–60) appear occasionally
- Story 47: Mainstream artists (> 60) almost never appear
- Story 48: Tier multiplier formula applied correctly
- Story 49: Underground prioritised over Mid in final ranked list
