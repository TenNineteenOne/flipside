# Issue 12 — FeedClient Wiring

**Type:** AFK
**Blocked by:** Issue 10 (ArtistCard), Issue 11 (ArtistDrawer)

## What to build

Update `components/feed/feed-client.tsx` to manage drawer state and the "Not for me" in-memory collapse state, and thread `artist_color` from the recommendation payload through to the card and drawer components.

### Drawer state

Add state to track which artist's drawer is open:

```typescript
const [openArtistId, setOpenArtistId] = useState<string | null>(null)
```

- Opening a card: `setOpenArtistId(artist.spotify_artist_id)`
- Closing the drawer: `setOpenArtistId(null)`
- Only one drawer can be open at a time

Render `<ArtistDrawer>` once (outside the cards loop), passing the currently selected artist's full data. Use `AnimatePresence` to animate it in/out.

### "Not for me" state

Replace the existing `actedIds` Set with a more granular structure:

```typescript
const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
```

- When "Not for me" is tapped on a card: add to `dismissedIds`. The card handles its own collapse animation (Issue 10). The card stays in the DOM (so Undo works).
- When "Undo" is tapped: remove from `dismissedIds`. Card re-expands.
- When the drawer's "Not for me" is tapped (`onDismissAndCollapse`): close drawer + add to `dismissedIds`.
- On page refresh / component mount: `dismissedIds` starts empty — dismissed cards come back.

The existing `actedIds` logic (for Save) should still mark saved artists as acted on and remove them from the feed permanently (this calls the API and is persistent).

### Artist colour threading

The `Recommendation` type already carries artist data. Extend it to include `artist_color: string | null` (populated by Issue 06). Pass `recommendation.artist_color ?? '#8b5cf6'` to both `ArtistCard` and `ArtistDrawer`.

### Feed layout

- Single column, centred, max-width 640px on all viewports (including desktop)
- Cards are stacked vertically with 16px gap
- Add bottom padding (e.g. 80px) so the last card is not obscured by the mobile bottom nav

## Acceptance criteria

- [ ] Tapping a card opens the drawer for that artist
- [ ] Tapping a different card's area while a drawer is open closes the current drawer and opens the new one
- [ ] "Not for me" on a card collapses it to a slim bar (does not remove from DOM)
- [ ] "Undo" on the slim bar re-expands the card
- [ ] Refreshing the page restores all cards to full height
- [ ] "Not for me" from the drawer closes the drawer and collapses the card simultaneously
- [ ] `artist_color` flows from recommendation payload to ArtistCard and ArtistDrawer
- [ ] Feed is max 640px wide, centred on desktop

## Blocked by

- Blocked by Issue 10 (ArtistCard)
- Blocked by Issue 11 (ArtistDrawer)

## User stories addressed

- Story 7: Card tap target opens drawer
- Story 11: "Not for me" state resets on refresh
- Story 12: Undo re-expands card
- Story 26: Simultaneous drawer-close + card-collapse on "Not for me" from drawer
- Story 41: `artist_color` threaded from payload with purple fallback
- Story 42: Colour is available immediately (from payload, no loading state needed)
