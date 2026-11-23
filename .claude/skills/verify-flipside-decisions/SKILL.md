---
name: verify-flipside-decisions
description: "Re-check the rules about one artist's decision state (Like, Pass, Dismiss, Save, Undo, History's Return to feed) with a TLA+ model plus a comparison against the real SQL functions, routes and client store. Use before merging any change to rpc_record_feedback_v2 / rpc_delete_feedback_v2 / rpc_clear_dismiss_v2, app/api/feedback, app/api/dismiss, app/api/saves, lib/client/artist-signals.ts, lib/feed/decision.ts, the undo in lib/hooks/use-feed-triage.ts, History's handleUndo, or the queries in feed-query.ts and lib/history/query.ts; and when someone asks to verify, model-check or fix the Feed undo, un-like, or Return to feed."
---

# Verify flipside decisions

One artist's state for one user is spread over three tables (`feedback`, `recommendation_cache`, `saves`) and is changed from several tabs at once by SQL functions, routes and an optimistic client store. Tests check the taps someone thought of. This check tries every order of taps, requests, failures and tabs, inside the bounds below, against eight rules.

## Run it

```sh
.claude/skills/verify-flipside-decisions/check.sh
```

About 50 seconds. It needs `mise` on PATH (it installs a pinned TLC and Java through it the first time) and `npm` (it installs a pinned `embedded-postgres` into `~/.cache/flipside-formal/` the first time; it starts a throwaway Postgres on port 54611 and stops it when done). It writes nothing in the repo. To check another copy of the repo, pass its root: `check.sh /path/to/copy`.

It does three things and exits 0 only if all three match what is recorded:

1. **Model.** TLC checks each rule of `Decisions.tla` in each config and compares with `expected.txt`.
2. **Conformance** (`harness/conformance.check.ts`). The model's tables (what each request does to the rows, what the pages read, which requests each tap sends) are printed by TLC from `Tables.tla` and compared, row by row, with the real code: the migrations applied to a real Postgres, the real route handlers, `getUnseenRecommendations`, `getHistoryPage`, and the real `createArtistFeedback` store and `decide()`.
3. **Replay** (`harness/replay.check.ts`). Each known finding is driven through the real client store, routes and SQL, one call per model step, and must still happen.

## The rules

| Rule | In plain words | Harm if it breaks | At the sync commit |
|---|---|---|---|
| `NoQueuedVerdict` | With nothing in flight, an artist waiting in the Feed queue has no live Like or Pass on record. | A card shown as undecided secretly counts as liked (it seeds recommendations) or passed (the engine treats it as never-show), and History does not list it. | broken (F4, F5, F6) |
| `UndoRestores` | The Feed's Undo, when every request succeeds and no other tab acts, leaves the rows exactly as before the undone tap. | Undo looks like it worked, but after a reload the card is somewhere else. | broken (F9, F10, and after F5; F1 fixed) |
| `UndoOfVerdictRestores` | The plain case of `UndoRestores`: Undo of a Like or Pass tapped on a card with no verdict, on screen and on the server. | Like, Undo, reload: the card is gone from the Feed and History says "Skipped" (F1). | holds (since the F1 fix) |
| `ReturnToFeedWorks` | When History reports that Return to feed worked, the artist is in the queue with no verdict. | The row leaves History and comes back to the Feed still carrying a Like or Pass. | broken (F5, F7) |
| `SavedStaysSaved` | Only Save and Unsave change whether an artist is saved. | A rating or an undo silently drops a saved artist. | holds |
| `NeverStuck` | The artist is always in the Feed queue or listed in History. | A hidden artist with no row anywhere to bring it back from. | holds |
| `ScreenUndecidedIsQueued` | A settled Feed card with no verdict and no save is still in the queue, so a reload shows the same card. | The card vanishes on reload and History files it under "Skipped", which the user never chose. | broken (F2, F3) |
| `ScreenVerdictIsRecorded` | The verdict a settled tab shows is the verdict History shows after a reload. | History lists the artist under a different label from the last one chosen. | broken (F8) |

"Settled" means: nothing of that tab in flight, all its requests succeeded, and no other tab has written since it loaded.

## Known findings (all replayed against the real code)

These are recorded as `broken` in `expected.txt`. They are product decisions waiting for the owner, not noise: do not "fix" the model to hide them.

- **F1** (fixed 2026-11-22, client only) Feed: Like (or Less like this), then Undo. The undo only soft-deleted the feedback row; `seen_at` stayed, so after a reload the card was gone from the Feed and History listed it as "Skipped". The undo now sends `DELETE /api/feedback`, then `DELETE /api/dismiss` (best-effort), unless the store knows `seen_at` was stamped before the Like (the card was saved or un-liked in this tab: `seenBefore` in `artist-signals.ts`, `kept` in the model); then it only removes the feedback, which is what puts the rows back. `UndoOfVerdictRestores` guards it; the replays named "fixed (F1)" must keep passing.
- **F2** Feed: Like, then Like again (un-like). The un-like only soft-deletes the feedback row; `seen_at` stays, so after a reload the card is gone from the Feed and History lists it as "Skipped". Migration 0033 chose "session-only undo" for the un-like on purpose; the "Skipped" label is the side effect.
- **F3** Feed: Save, then Save again (unsave). `POST /api/saves` stamps `seen_at`; the unsave does not clear it. Same end state.
- **F4** Two tabs: tab A likes the artist; tab B still shows the card, dismisses it and taps Undo. Queue plus a live Like.
- **F5** History, one tab, no failure: tap Return to feed, then Change to Passed before the first request answers. History drops the row; the artist is in the queue with a live Pass.
- **F6** Feed, one lost answer: Like, Dismiss, Undo, and the answer to the undo's first request is lost. The card shows Dismissed; the server has it queued with a live Like.
- **F7** History row loaded as Dismissed (or Skipped), a Like from another tab lands, then Return to feed. Only the dismissal is cleared: queue plus a live Like.
- **F8** Feed: Like, then Dismiss. The card shows Dismissed; `skip_at` is set but the Like stays live, so History shows "Liked" and the artist keeps counting as liked.
- **F9** Feed: Undo of a Dismiss on a card whose `seen_at` was already stamped: Save, Dismiss, Undo (the saved artist leaves History and is back in the queue), or un-like / unsave (F2, F3), Dismiss, Undo. `DELETE /api/dismiss` clears `seen_at` along with `skip_at`, and no request clears `skip_at` alone. It was always there; F1 was the shorter path to the same broken rule, so TLC never showed it.
- **F10** Feed: Like, Dismiss, Like, Undo (follows from F8). The Like stayed on record under the dismissal; the second Like changes nothing on the server and its Undo (thumbs to skip: `DELETE /api/feedback`) removes the Like that was there before the tap. Also hidden behind F1 until now.
- **F11** Two tabs (new with the F1 fix): tab A likes and taps Undo; tab B, still showing the card, likes it between the undo's two requests. Queue plus a live Like, the same shape as F4. Before the fix this order ended in History as Liked.

After F5 has left the artist queued with a live Pass, a reloaded Feed card shows no verdict; Like then Undo removes that Pass (before and after the F1 fix). `UndoRestores` reports it; it goes away with F5.

## Does my change touch this?

Yes if it edits any of these (the coverage record). Run `git diff --stat f79127b -- <paths>` to see what moved since the sync commit.

| Model part (`Decisions.tla`) | Code |
|---|---|
| `Apply` | `supabase/migrations/` (latest definitions: `rpc_record_feedback_v2`, `rpc_delete_feedback_v2`, `rpc_clear_dismiss_v2` in `0036_artist_identity_additive.sql`; any later migration that touches `feedback`, `recommendation_cache.seen_at/skip_at` or `saves`), `app/api/feedback/route.ts`, `app/api/feedback/[artistId]/route.ts`, `app/api/dismiss/[artistId]/route.ts`, `app/api/saves/route.ts`, `lib/taste-change.ts` (must stay a no-op for feedback, save and undismiss) |
| `InQueue` | `lib/recommendation/feed-query.ts` `getUnseenRecommendations` |
| `InHistory`, `ServerSignal` | `lib/history/query.ts` `getHistoryPage` |
| `JudgeSteps`, `JudgeTarget`, `TapUndo`'s `undoTo` | `lib/client/artist-signals.ts` `classifyFeedbackOp`, `setSignal`; `lib/feed/decision.ts` `decide` |
| `RestoreSteps`, `RestoreSoft`, the tab's `kept` | `lib/client/artist-signals.ts` `restore`, `seenBefore` (set in `setSignal`'s un-like and by `markSeen`, cleared in `undismiss`) |
| `Step`, `SaveStep` (optimistic show, per-artist queue, rollback) | `lib/client/artist-signals.ts` `createOptimisticStore`, `createArtistSaves`; `lib/keyed-serializer.ts` |
| `Judge`, `TapUndo`, `TapSave` (which taps exist, when Undo is on offer); `SaveStep` setting `kept` | `lib/hooks/use-feed-triage.ts` `judge`, `undoLast`, `notify`, `save` (which calls `markSeen` once a save has answered) |
| `ChangeTo`, `TapReturnToFeed`, `RtfFirst`, `Shown` | `components/history/history-client.tsx` `handleChangeSignal`, `handleUndo`, `hasFeedbackRow`, `shown`, and which buttons a row offers |
| `LoadTo` | `app/(app)/feed/page.tsx` and the History page (what a fresh load shows) |

**Sync commit: `f79127b`** (branch `Nick`). The model was confirmed against the code at this commit. Move it forward only after you have re-read the rows above against the code at the new commit and `check.sh` reports unchanged there.

Conformance covers `Apply`, `InQueue`, `InHistory`, `ServerSignal`, `JudgeSteps`, `JudgeTarget`, `RestoreSteps`, `RestoreSoft`, `RtfFirst` and what sets and clears `kept` mechanically. The rows for `Step`/`SaveStep`, the taps in `use-feed-triage.ts` and the History buttons are covered by reading plus the replays, so a change there needs your eyes on the model.

## Reading a result

Read every TLC result with the `/statechart` skill: run it on `Decisions.tla` with the config in question and `view.mjs` as the view. It gives the shortest path to each broken rule in plain words (what you tap, what the screen shows, what the server has). When nothing breaks it draws the chart; `chart.cfg` with `chart-view.mjs` is the small configuration made for that (one tab, no failures, saving left out). `/statechart` checks all rules of a config in one go; to see one rule's own shortest path in the two-tab configs, give it a copy of the config with only that `INVARIANT` line.

`check.sh` prints one line per rule and config:

- `ok ... holds`, `finding ... broken`: as recorded.
- `ok ... broken in variant X, as it must`: the three rules that hold are shown failing on a deliberately broken model (`Variant` in `Decisions.tla`), so they are known to be able to fail.
- `CHANGED`: the result differs from `expected.txt`. The line names the TLC output file, which is kept.

## When a result changes

Work out which of these it is before touching anything.

1. **Conformance fails.** The code no longer does what the model says. If the code change was intended, change the matching operator in `Decisions.tla` (the failing assertion names the table: APPLY, READ, JUDGE, RESTORE, RTF), then run again and look at the model results: that is the answer to "is my change safe". If it was not intended, you found a bug in the change.
2. **A rule that held is now broken** (after you updated the model, or because you changed the model). Read the path with `/statechart`, then replay it: add a test to `harness/replay.check.ts` that makes one call per step of the path (`openTab()`, `feedCard(tab).tap(...)`, `tab.server("ok" | "lost" | "fail")`, `pages()`). If the replay shows the bad end state, it is a real bug: report it, with the path, and leave the rule alone. If the replay does not reproduce it, the model is wrong: find the step where model and code part ways and fix the model.
3. **A finding no longer breaks, or its replay test fails.** Something fixed it (or changed the path). Confirm with the replay, set the rule to `holds` in `expected.txt` once no config breaks it, remove or invert its replay test, and update the tables above.
4. **TLC error.** A syntax or evaluation error in the spec; the kept output file says where.

Never weaken a rule, shrink a bound or remove a tap from the model to get back to "unchanged". If a rule is wrong for the product, say so to the owner and change it with their agreement.

## Bounds and assumptions

- One user, one artist (artists do not interact in this code: every statement is keyed by user and artist).
- `solo` / `solo-nofail`: one tab, up to 2 taps waiting on the network, up to 2 / 0 failed requests. All eight rules.
- `tabs2` / `tabs2-nofail`: two tabs, 1 tap waiting per tab, up to 1 / 0 failed requests. The four rules that do not depend on a single tab's view.
- A request can succeed, fail before the server applies it, or be applied with the answer lost. There is no automatic retry in the code; a retry is the user tapping again.
- One SQL function call or one statement is one step. `POST /api/saves` is two (upsert, then the `seen_at` stamp, whose failure is only logged). Return to feed, the undo of skip to thumbs and the undo of thumbs to no verdict are two requests each. `DELETE /api/dismiss` first stamps the row's `created_at` and `expires_at` (so the returned card outlives the nightly cron) and answers 500 without calling the SQL function if that fails; the model has no time, so the stamp is not a step and a failed one is the request failing before the server applies it. Conformance checks the stamp and its order against the real route.
- The recommendation row exists and has not expired; time does not pass (the 7-day cooldown never runs out).

## Not covered

- Regenerate, the engine's `writeScored` re-queue, the nightly cron, expiry and the 7-day cooldown running out (`app/api/recommendations/generate/route.ts`, `lib/recommendation/engine.ts`, `app/api/cron/recommendations/route.ts`). This is the suggested second target.
- More than two tabs, more than one artist, deeper request queues, a reload while requests are still in flight, the Snap swipe (no toggle), the Saved page (its unsave is the same request as the Feed's).
- Auth, CSRF, the weekly challenge counter, RLS and grants.
- React rendering: which buttons are on screen is modelled from the JSX by reading, and the hook lines that send requests (`judge`, `undoLast`, `save`) and History's `handleUndo` line are repeated in the harness (`conformance.check.ts` fails if the `handleUndo` line or the `save` line changes).
- The Supabase client and PostgREST: the harness uses a small SQL-backed stand-in (`harness/supabase-pg.ts`) and plain Postgres 17 with stand-ins for the Supabase roles and `auth.uid()`.

## Files

- `Decisions.tla` the model and the rules; `Tables.tla`, `tables.cfg` print its tables.
- `solo.cfg`, `solo-nofail.cfg`, `tabs2.cfg`, `tabs2-nofail.cfg` the bounds; `expected.txt` the recorded results; `chart.cfg` the small chart configuration.
- `view.mjs`, `chart-view.mjs` the reader's words for paths and for the overview chart.
- `check.sh` the one command. `harness/` the real-code side: `pg.mjs` (Postgres + migrations), `supabase-pg.ts`, `world.ts`, `conformance.check.ts`, `replay.check.ts`.

To bring this back in line after changes that did not re-run it, use `/maintain-formal-verification-skill`.
