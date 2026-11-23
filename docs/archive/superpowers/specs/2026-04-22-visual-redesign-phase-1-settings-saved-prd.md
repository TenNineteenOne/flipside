# PRD — Visual Redesign Phase 1: Settings + Saved

**Date**: 2026-04-22
**Branch**: Nick
**Author**: TenNineteenOne
**Supersedes**: N/A — first phase of a 7-phase visual overhaul.

## Context

We're adopting a visual language handoff (`/tmp/flipside-handoff/flipside/project/`) that gives the app a distinct editorial-dark identity: ambient per-page gradients, per-artist color auras, glass cards, editorial serif accents, and a grouped/sectioned information architecture.

Phase 1 covers **Settings + Saved** — small surfaces where we can land the foundation pieces (Instrument Serif, glass card treatment, `Ambient` component, `hexToRgba` helper) before tackling Feed in phase 2.

Order for the full redesign: Settings+Saved → Feed → Explore → Splash → History → Stats → Onboarding.

## Decisions already grilled out

1. **Fonts** — current app already loads Inter / Fraunces (SOFT+WONK) / JetBrains Mono via `next/font`. Add Instrument Serif via `next/font/google` so `.serif` accents render consistently.
2. **Settings information architecture** — re-skin + reorganize (all current features preserved, grouped into design-mock-style sections). No feature removal.
3. **Saved per-artist color** — use the existing DB `artist_color` (album-art-derived) with `stringToHex(name)` as fallback when null.
4. **Ambient backgrounds** — per-page radial-gradient compositions (one per surface). Adventurous toggle switches to the warm palette.
5. **Account deletion** — **skip**. Current Settings has delete logic; leave it untouched visually but don't promote it to the mock's prominent "Forget my account" button. Separate PRD later.
6. **Obscurity grouping** — keep all three current controls (`popularity_curve`, `underground_mode`, `deep_discovery`), grouped under an "Obscurity" section. The color-morphing visual treatment applies to the `play_threshold` slider (which is the existing "how often I've played" control that maps most naturally to the mock's obscurity concept).
7. **Editorial italic** — ship it on phase 1 page headers: Saved *"A quiet list of sounds you want to remember."*, Settings *"Your preferences, politely tuned."*.
8. **Glass cards** — adopt on phase 1. Few cards, low viewport density — safe on all modern devices. Revisit selectively if phase 2 (Feed) shows jank.

## Foundation already in place (do not re-do)

- Design tokens in `app/globals.css` match the handoff almost 1:1 (bg-base, accent, radii, easing, grain-opacity, shell-max).
- Film grain overlay on `body::after` — already wired with correct SVG turbulence.
- `.tabbar` mobile nav + `.topnav` desktop nav — already switch at the 900px breakpoint.
- `.card`, `.btn`, `.field`, `.eyebrow`, `.mono`, `.serif` classes — already defined in `globals.css`.
- `stringToVibrantHex` in `lib/color-utils.ts` — already deterministic.
- `artist_color` DB column — already persisted per artist.

## Foundation work NEW to phase 1

### F1. Load Instrument Serif via `next/font`

`app/layout.tsx` — add the font import alongside existing fonts:

```ts
import { Inter, Fraunces, JetBrains_Mono, Instrument_Serif } from "next/font/google"

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic", "normal"],
})
```

Attach `${instrumentSerif.variable}` to the `html` className.

`app/globals.css:431` — update `.serif` to consume the variable:

```css
.serif { font-family: var(--font-serif), 'Instrument Serif', serif; font-style: italic; }
```

(Keep the literal fallback in case the `next/font` loader fails.)

### F2. Add `hexToRgba` helper

`lib/color-utils.ts` — add alongside `stringToVibrantHex`:

```ts
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return `rgba(139, 92, 246, ${alpha})` // fallback = --accent
  const r = parseInt(m[1], 16)
  const g = parseInt(m[2], 16)
  const b = parseInt(m[3], 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
```

### F3. Introduce an `<Ambient>` component

`components/visual/ambient.tsx` — new shared client component for per-page radial-gradient backdrops.

```tsx
"use client"
import { useEffect, useState } from "react"

interface AmbientProps {
  palette: string       // the default (non-adventurous) gradient composition
  adventurousPalette?: string  // optional override when Adventurous is on
}

export function Ambient({ palette, adventurousPalette }: AmbientProps) {
  const [adventurous, setAdventurous] = useState(false)
  useEffect(() => {
    const read = () => {
      try { setAdventurous(localStorage.getItem('flipside.adventurous') === '1') } catch {}
    }
    read()
    window.addEventListener('flipside:adventurous-change', read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener('flipside:adventurous-change', read)
      window.removeEventListener('storage', read)
    }
  }, [])

  const WARM = `
    radial-gradient(60% 45% at 20% 18%, rgba(245,176,71,0.22) 0%, transparent 70%),
    radial-gradient(55% 40% at 82% 32%, rgba(236,111,181,0.22) 0%, transparent 70%),
    radial-gradient(65% 50% at 50% 75%, rgba(125,217,198,0.18) 0%, transparent 70%),
    radial-gradient(45% 35% at 12% 82%, rgba(168,199,250,0.16) 0%, transparent 70%)
  `

  return (
    <div aria-hidden="true" style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: -1,
      transition: 'background 0.8s var(--easing)',
      background: adventurous ? (adventurousPalette ?? WARM) : palette,
    }}/>
  )
}
```

The `zIndex: -1` sits behind everything; `pointerEvents: 'none'` means it never blocks interaction.

Why a shared component: phase 2/3/4 all need the same adventurous-state synchronization pattern. Writing it once saves duplication and ensures consistency.

### F4. Update `.fs-card` for glass treatment

**Resolved**: the card class is `.fs-card` (not `.card`). Defined in `app/globals.css:373`, used in 10 call sites across `components/settings/settings-form.tsx` (6×), `app/(marketing)/onboarding/page.tsx` (3×), and `app/(marketing)/sign-in/page.tsx` (1×).

Update in place — zero call-site changes needed:

```css
.fs-card {
  background: rgba(15, 15, 15, 0.65);
  backdrop-filter: blur(30px) saturate(1.1);
  -webkit-backdrop-filter: blur(30px) saturate(1.1);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
}

/* Fallback: browsers without backdrop-filter get the opaque bg */
@supports not (backdrop-filter: blur(30px)) {
  .fs-card { background: var(--bg-card); }
}
```

**Blast-radius check**: the 3 non-Settings call sites (onboarding, sign-in) are all behind auth and have the body's film grain + flat bg-base behind them — glass will render as subtle transparency over the grain, which is harmless and matches the design language. No page relies on opaque `.fs-card` for text legibility.

## Saved redesign

### Current state

`app/(app)/saved/page.tsx` fetches saves with `artist_color` already populated. `components/saved/saved-client.tsx` renders artists with `stringToVibrantHex` fallback. The page uses the shared `.page-head` pattern.

### Target state

Grid of color-tinted cards, each card styled by the artist's color (DB-first, name-hash fallback). Ambient backdrop derived from the first two saved artists' colors.

### Changes

`components/saved/saved-client.tsx`:
1. Import `hexToRgba` from `lib/color-utils`.
2. Import `<Ambient>` from `components/visual/ambient`.
3. Compute `palette` from first 1–2 visible artists (fallback to `--accent` when empty).
4. Replace current card markup with the tinted-grid pattern from the mock (`linear-gradient(180deg, tint 0% → var(--bg-card) 70%)`, colored border, colored boxShadow).
5. Update header: keep `<h1>Saved</h1>`, replace subtitle with `<span className="serif">"A quiet list of sounds you want to remember."</span>` + `<span className="sub">N artists · your keeps</span>`.
6. Helper: `resolveColor(artist)` — returns `artist.artistColor` if present and not the default `#8b5cf6`, else `stringToVibrantHex(artist.name)`. Rationale: the default-when-unset is also `#8b5cf6` in the current code, so "default accent" should still route to per-name hash.
7. Platform button color — derive from resolved color (not hardcoded accent), matches the card's tint.

Note: **do not touch the unsave flow** — existing optimistic delete logic stays.

### Non-goals for Saved

- Drag-to-reorder.
- Multi-select / bulk actions.
- Tab switching (current app has tabs? — if yes, preserve; if no, don't add).
- Empty-state copy rewrite (keep current).

## Settings redesign

### Current state

`components/settings/settings-form.tsx` is a ~500+ LOC form with 9+ controls (threshold, popularityCurve, lastfm/statsfm, underground, deepDiscovery, adventurous, selectedGenres, seedArtists, platform, delete). Currently flat layout with all controls stacked.

### Target state

Grouped sections matching the mock, each section styled per its semantic color. All existing controls preserved.

### Section plan

Order from top to bottom:

**1. Profile** (accent-tinted gradient card)
- Avatar (existing `IdenticonAvatar`, seeded by `userSeed`) + green status dot
- **No @username displayed** — resolved: the plaintext username is never persisted to the DB (only `username_hash` via HMAC, by design). Adding it to the JWT session is possible but feels like scope creep and arguably weakens the "zero PII" promise. The mock's `@nick` is a prototype convenience; we replace it with the identicon as the visual identity.
- Primary label: `Your profile` (bold, 15px)
- Subtitle (mono): `zero PII stored · no email · no password` — reinforces the privacy positioning from the current sign-in page.
- (No "joined {month}" line — we don't have a reliable created_at surfaced in the Settings data loader; would require another query. Skip for phase 1.)

**2. Obscurity** (color-morphing, gradient-tinted)

**Label resolution**: user-facing label becomes **"How underground?"** (eyebrow, colored) — a friendlier phrasing than the current "Play threshold" or technical "popularity_curve". DB columns (`play_threshold`, `popularity_curve`, `underground_mode`, `deep_discovery`) are NOT renamed — internal identifiers stay. This is a label-only change.

Adopt the mock's 4-stop ladder for the serif headline:
- `threshold < 5`  → **"Deep underground"** (mint `#7dd9c6`)
- `threshold < 15` → **"Adventurous"** (soft blue `#a8c7fa`)
- `threshold < 30` → **"Curious"** (accent `--accent`)
- else → **"Familiar"** (amber `#f5b047`)

Replaces the current "Nothing familiar" / "Mostly new" / "Some favorites" ladder — the mock's framing is crisper.

Layout:
- Eyebrow: "How underground?" in `obscurityColor`
- Big serif label (`.serif` class, 24px): one of the 4 labels above
- Right-aligned mono caption: `hide if played > {threshold}×` (preserves current semantic)
- Threshold slider — color-morphing via `linear-gradient(to right, ${obscurityColor} ${pct}%, rgba(255,255,255,0.1) ${pct}%)`
- Ladder caption: `← deep underground` | `familiar →` in mono
- Muted help paragraph (derived from threshold value — reuse current help strings)
- Below the main slider (same card): existing `popularity_curve` slider + `CurvePreview` AND `underground_mode` + `deep_discovery` toggles, styled as muted sub-controls. Sub-eyebrow: "Fine-tune".

**3. Taste seeds** (neutral card)
- Eyebrow: "Seeds"
- The existing `LibraryEditor` component — no behavioral change, just wrap in the new card style.
- Existing `selectedGenres` chips stay (or move to its own "Genres" subsection if cluttered).

**4. Connected sources** (per-service tinted)
- Eyebrow: "Connected sources"
- Glass card containing:
  - **Last.fm** row: red-tinted icon tile (`rgba(215,0,0,0.12)`), name, connected-state mono subtitle (mint when connected, muted when not), `Sync now` button
  - divider
  - **StatsFM** row: same pattern, teal/purple accent (existing color from app theme — check)
  - divider
  - **Spotify** row: green-tinted icon tile, "restricted access" subtitle, `locked` pill badge (`#f5b047` tinted)

**5. Preferred platform** (opens/shares picker)
- Eyebrow: "Open tracks in"
- The existing `PlatformPicker` component wrapped in a card.

**6. Adventurous toggle** (full-width card)
- Eyebrow: "Adventurous"
- Toggle + copy explaining what it does (reuse current text).

**7. Account** (neutral card, quiet)
- Eyebrow: "Account"
- `Sign out` button (existing)
- Existing delete-confirm flow — keep as-is structurally, but quiet (no prominent "Forget my account" button; the existing two-tap confirm is fine).
- Muted subtitle: `No email. No password. If you forget your username, your account is gone.`

### Visual system per section

- Each section has an `eyebrow` (uppercase mono tag)
- Sections separated by `gap: 16px` (using existing `col gap-16` class)
- Full-width on mobile, bounded to `--shell-max` on desktop

### Ambient for Settings

```
radial-gradient(50% 40% at 18% 20%, var(--accent) 20% alpha, transparent 70%),
radial-gradient(55% 45% at 82% 35%, #7dd9c6 14% alpha, transparent 70%),
radial-gradient(60% 50% at 50% 95%, #ec6fb5 12% alpha, transparent 70%)
```

(Exact syntax uses `hexToRgba`.)

### Non-goals for Settings

- New features (delete button promotion, email capture, 2FA) — none.
- Changing any API call — none.
- Reworking `LibraryEditor`, `CurvePreview`, `PlatformPicker` internals — these are wrapped, not rewritten.
- Renaming fields in the DB.

## Files touched

### New
1. `components/visual/ambient.tsx` — shared `<Ambient>` component.

### Modified
1. `app/layout.tsx` — add Instrument Serif font loading.
2. `app/globals.css` — update `.card` to glass treatment; confirm `.serif` uses `var(--font-serif)`.
3. `lib/color-utils.ts` — add `hexToRgba` helper.
4. `components/saved/saved-client.tsx` — new tinted-grid layout + Ambient.
5. `components/settings/settings-form.tsx` — section-grouped restructure. (This is the biggest file in the PR.)

### Unchanged (don't touch)
- `app/api/settings/route.ts` — no API change.
- `app/(app)/saved/page.tsx`, `app/(app)/settings/page.tsx` — server components stay as data loaders.
- `components/settings/library-editor.tsx`, `curve-preview.tsx`, `platform-picker.tsx` — wrapped, not rewritten.
- `components/saved/` existing components beyond `saved-client.tsx`.
- Delete-account flow logic — visual quieting only, no behavioral change.

## Testing / verification

Per preview-verification workflow:
1. `preview_start` → load `/settings` and `/saved`.
2. `preview_screenshot` comparing to mock screenshots in `/tmp/flipside-handoff/flipside/project/`.
3. `preview_eval` toggling `flipside.adventurous` in localStorage → verify palette swap on both pages.
4. `preview_fill` the threshold slider → verify color morph on the serif label + slider fill.
5. `preview_click` Sync Last.fm → existing sync flow still works.
6. `preview_resize` to 400px wide → verify responsive behavior.
7. `preview_inspect` on a glass card → confirm `backdrop-filter` computed value is applied.

Golden regressions:
- Settings: save play_threshold, reload → value persists.
- Saved: unsave an artist → optimistic remove still works.
- Both: no new console errors, no network regressions.

## Rollout

Single PR on branch `Nick`. No flag. Low behavioral risk (no API change, no DB change, no data change). Visual-only with careful preservation of every existing control.

If phase 1 review surfaces concerns about the glass-card performance or section IA, we iterate before phase 2 starts.

## Non-goals (for this phase)

- Onboarding / Splash / Feed / Explore / Stats / History visual work — phases 2–7.
- Account deletion UX — separate PRD.
- Envelope encryption of usernames — user declined.
- Animation / framer-motion polish on entrance transitions — keep minimal for phase 1; introduce in phase 2 (Feed has motion-heavy rails).

## Cross-phase scope decisions (2026-04-22)

These affect phases 2–7. Recording here so the subsequent phase PRDs don't re-litigate them.

**Parked for future PRDs (NOT built during the visual redesign):**

1. **Weekly Challenges / `ChallengeCard`** (Explore) — hand-written-or-generated weekly challenges with progress tracking. Its own engagement-loop product. Don't render even a stub; the component is skipped from phase 3.
2. **`SceneReport`** (Feed rhythm interleaving) — genre-essay editorial content with scene scores. Its own editorial-content product. Skip the component entirely from phase 2 — Feed will be a pure ArtistCard list with the magazine rhythm coming from ColdStartBanner + NeighborhoodMap alone.
3. **`SixDegreesChain`** (Explore + possibly Feed) — path-finding through artist similarity graph. Parked as *potential future feature* once we commit to a durable similarity graph. Skip the component from phase 3. Do not even show stubbed bridges.
4. **Account deletion UX promotion** — current two-tap delete flow stays as-is; no prominent "Forget my account" danger button. Separate PRD.

**Kept as full-fidelity features (build real, not stubs):**

1. **`NeighborhoodMap`** (Feed) — SVG constellation of similar artists. Uses existing `lastfm_cache` similar-artist data we already cache. No new data plumbing.
2. **`ColdStartBanner`** (Feed) — renders the existing cold-start state (threshold, liked-count progress). No new data.
3. **Stats scatter plot + popularity tier bands + sortable table** — new visualization on existing `recommendation_cache.artist_data` (popularity already stored).
4. **History signal-colored day-grouped rows** — pure reorganization of existing `feedback` rows.

**Implication for phase 1**: none. Settings + Saved have no dependency on the parked features. Foundation pieces (`Ambient`, `hexToRgba`, Instrument Serif, glass `.fs-card`) benefit every surface regardless.

## Open questions — all resolved 2026-04-22

1. ✅ **Username on profile card**: plaintext username is never persisted (DB stores only HMAC `username_hash`). JWT also carries only `user.id`. Skipping the `@username` display entirely; the identicon is the visual identity. Keeps the privacy design honest.
2. ✅ **Glass card blast radius**: the class is `.fs-card` (not `.card`), used in 10 call sites (Settings + onboarding + sign-in). All under the same shell with the same film-grain + bg-base backdrop. Glass treatment is safe across all of them — no page relies on `.fs-card` being opaque.
3. ✅ **Obscurity label**: user-facing section becomes "How underground?" with a 4-stop ladder ("Deep underground" → "Adventurous" → "Curious" → "Familiar"). DB columns NOT renamed — `play_threshold`, `popularity_curve`, `underground_mode`, `deep_discovery` keep their internal names.
