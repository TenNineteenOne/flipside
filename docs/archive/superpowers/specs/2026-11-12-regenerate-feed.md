# Regenerate the feed

Owner decisions: 2026-11-12.

## Problem
The header refresh button appended a batch (`POST /api/recommendations/generate`). With 60+ unrated cards queued, the server returned 429 "discovery queue is full" and the client toasted it. A tap inside 30s of another generate (including the silent top-up on mount) returned 429 "please wait".

## Behaviour
1. **Every Load more becomes Regenerate.** This covers the phone and tablet header icon, the desktop header button, the end-of-queue button and the end-state button. Each one calls generate with `?replace=true`. The server then deletes the unseen, undismissed queue and builds a fresh batch. Replace mode skips the 60-card cap, so "queue full" can't happen.
2. **Rated artists are untouched.** Likes, passes and saves stay in History and Saved. Only unrated cards are replaced. After a successful regenerate, the feed's list is swapped for the server's fresh list (`GET /api/recommendations`). The background fill poller then keeps appending.
3. **Cooldown is invisible.** The server keeps its 30s per-user cooldown as abuse protection. If a regenerate hits it, the client retries every 3s for up to 35s while the button spins. No toast is shown.
4. **Confirm dialog.** It asks before replacing unrated cards. The title is "Regenerate your feed?", the body is "Your N unrated artists will be replaced.", and the buttons are **Cancel** and **Yes, regenerate**. A **Don't ask again today** checkbox stores today's local date in `localStorage` (`flipside.regen-skip`). Until the date changes, regenerate runs without asking on this device. The dialog is skipped when nothing is unrated, because nothing would be lost. Esc, a backdrop click or Cancel closes it without regenerating.
5. **Look.** The button gets a rainbow fill (`--wander-rainbow`) with a dark icon. Labels are "Regenerate" and "Generating…". The phone shows the icon only, before the avatar. The tablet shows the icon, with the text from 600px wide. The icon spins while generating, unless reduced motion is set.

## Out of scope
- The silent top-up on mount stays an append.
- No server or migration change.
- The cooldown isn't per-device. Skip-today is per-device.

## Tests
- Unit: the replace URL; cooldown retry then success; the retry stops at its deadline; the skip-today date logic; the dialog is skipped when nothing is unrated.
- Render: the dialog markup and every regenerate label.
- Preview, phone (375px) and desktop (1280px): the button shows the rainbow; tapping opens the dialog; Cancel does nothing; Yes regenerates; with the checkbox ticked, the next tap regenerates without the dialog.
