# Issue 15 — Settings Redesign

**Type:** AFK
**Blocked by:** Issue 02 (CSS tokens), Issue 04 (play threshold wired to DB)

## What to build

Apply the new dark chrome visual treatment to the Settings page and make both the play threshold slider and Last.fm username field actually reflect their backend status.

### Visual treatment

Apply new colour tokens throughout `components/settings/settings-form.tsx` and the Settings page:

- Page background: `var(--bg-base)` (`#080808`)
- Section cards/groups: `var(--bg-card)` (`#0f0f0f`) with `1px solid var(--border)` border, `border-radius: 12px`
- Section labels: 9px Inter 600, uppercase, `letter-spacing: 0.12em`, `--text-muted`
- Field labels: 13px Inter 500, `--text-primary`
- Field values / helper text: 12px Inter 400, `--text-secondary`
- Interactive elements (sliders, inputs, buttons): use `--accent` purple for focus rings and active states
- Destructive actions (Sign out): `--text-muted`, not prominent

### Play threshold section

- Label: "Discovery threshold"
- Helper text: "Artists you've played more than this many times won't appear. Lower = more unfamiliar artists."
- Slider: range 0–50 (not 0–100 — most users should never go above 20), current value from `profile.play_threshold`
- Display the current value next to the slider (e.g. "5 plays")
- Save on slider release (debounced or on blur), not on every change
- Remove any Groups-related settings sections

### Last.fm section

- Label: "Last.fm"
- Text input: username, saved to `profile.lastfm_username`
- Sync status indicator below the input. Show one of:
  - "Not connected" — if `lastfm_username` is empty
  - "Syncing…" — if a sync is in progress (can be approximated with a loading state on save)
  - "Connected — synced X artists" — count of `listened_artists` rows where `source = 'lastfm'` for this user
- "Sync now" button: triggers `POST /api/history/accumulate` manually, shows loading state

### Remove

- Any Groups-related settings sections (invite codes, group membership, etc.)

### Notes

- Read the design spec § "Out of Scope" — onboarding and Flipside playlist sections are unchanged.
- The settings form currently has 5 sections; after Groups removal it should have: Profile (read-only), Discovery threshold, Last.fm, Flipside playlist, Account.
- The slider range of 0–50 is intentional — the system defaults to 5 and most users won't need to go higher.

## Acceptance criteria

- [ ] Settings page uses `--bg-base` background and `--bg-card` section cards
- [ ] Play threshold slider reads the real value from the user's profile
- [ ] Changing the slider and releasing saves the new value to the database
- [ ] Last.fm username field saves to `profile.lastfm_username`
- [ ] Last.fm section shows sync status: not connected / syncing / connected with artist count
- [ ] "Sync now" button triggers `/api/history/accumulate` and shows loading state
- [ ] No Groups-related content appears in Settings

## Blocked by

- Blocked by Issue 02 (CSS tokens)
- Blocked by Issue 04 (play threshold fix — so the slider reflects a value that actually works)

## User stories addressed

- Story 53: Play threshold change in Settings affects next recommendation refresh
- Story 58: Last.fm integration status visible in Settings
- Story 67: Settings uses dark base tokens
- Story 68: Play threshold slider with clear description
- Story 69: Last.fm field with sync status indicator
- Story 70: Settings matches full redesign treatment
