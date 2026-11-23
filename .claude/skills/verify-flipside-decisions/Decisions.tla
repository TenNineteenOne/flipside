------------------------------ MODULE Decisions ------------------------------
(***************************************************************************)
(* One user's decision about ONE artist in flipside, as the code keeps it. *)
(*                                                                         *)
(* Server state (three tables, one row each for this user + artist):       *)
(*   srv.fb    live feedback signal: feedback.signal where deleted_at IS   *)
(*             NULL ("none" = no row, or a soft-deleted one)               *)
(*   srv.seen  recommendation_cache.seen_at IS NOT NULL                    *)
(*   srv.skip  recommendation_cache.skip_at IS NOT NULL                    *)
(*   srv.saved a saves row exists                                          *)
(*                                                                         *)
(* Every server step below is ONE SQL statement or ONE plpgsql function    *)
(* call, so it is atomic in Postgres. A route or a client that makes two   *)
(* calls is two steps here, and other tabs can run between them.           *)
(*                                                                         *)
(* Code map (repo paths):                                                  *)
(*   Apply          supabase/migrations/0036_artist_identity_additive.sql  *)
(*                  (rpc_record_feedback_v2, rpc_delete_feedback_v2,       *)
(*                  rpc_clear_dismiss_v2), app/api/feedback/route.ts,      *)
(*                  app/api/feedback/[artistId]/route.ts,                  *)
(*                  app/api/dismiss/[artistId]/route.ts,                   *)
(*                  app/api/saves/route.ts                                 *)
(*   InQueue        lib/recommendation/feed-query.ts                       *)
(*   InHistory,     lib/history/query.ts                                   *)
(*   ServerSignal                                                          *)
(*   JudgeSteps     lib/client/artist-signals.ts classifyFeedbackOp,       *)
(*                  setSignal; lib/feed/decision.ts decide                 *)
(*   RestoreSteps   lib/client/artist-signals.ts restore, seenBefore       *)
(*                  (the tab's `kept`), markSeen                           *)
(*   Step, SaveStep lib/client/artist-signals.ts createOptimisticStore     *)
(*                  (optimistic, confirmedOp), lib/keyed-serializer.ts     *)
(*   Undo, Save     lib/hooks/use-feed-triage.ts (undoLast, notify, save;  *)
(*                  save calls markSeen once the save has answered)        *)
(*   ChangeTo,      components/history/history-client.tsx                  *)
(*   ReturnToFeed   (handleChangeSignal, handleUndo, hasFeedbackRow)       *)
(*                                                                         *)
(* harness/conformance.check.ts compares the operators marked TABLE with   *)
(* the real code, so a code change that this model no longer describes     *)
(* fails the check.                                                        *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
  Tabs,      \* browser tabs open for the one user
  MaxFails,  \* how many requests may fail in one run
  MaxQueue,  \* taps one tab may have waiting on the network at once
  Variant,   \* "code" = the app as written; other values are broken variants
  Ghosts     \* TRUE = also track what the single-tab rules need (UndoRestores, Screen*)

VARIABLES
  srv,        \* the database rows
  tab,        \* what each tab shows and has in flight
  fails,      \* failed requests so far
  evt,        \* what the last step just reported to the user (for two rules)
  savedGhost  \* what the user's save / unsave taps add up to

vars == <<srv, tab, fails, evt, savedGhost>>

Fresh == [fb |-> "none", seen |-> FALSE, skip |-> FALSE, saved |-> FALSE]

(***************************************************************************)
(* TABLE: one atomic server step.                                          *)
(***************************************************************************)
Requests == {"postUp", "postDown", "postSkip", "delFeedback", "delDismiss",
             "saveUpsert", "saveSeen", "delSave"}

Apply(s, r) ==
  CASE r = "postUp"      -> [s EXCEPT !.fb = "up", !.seen = TRUE]
    [] r = "postDown"    -> [s EXCEPT !.fb = "down", !.seen = TRUE]
    [] r = "postSkip"    -> [s EXCEPT !.seen = TRUE, !.skip = TRUE]
    [] r = "delFeedback" -> [s EXCEPT !.fb = "none",
                                      !.saved = IF Variant = "deleteFeedbackDropsSave" THEN FALSE ELSE @]
    [] r = "delDismiss"  -> [s EXCEPT !.seen = FALSE,
                                      !.skip = IF Variant = "clearDismissKeepsSkip" THEN @ ELSE FALSE]
    [] r = "saveUpsert"  -> [s EXCEPT !.saved = TRUE]
    [] r = "saveSeen"    -> [s EXCEPT !.seen = TRUE]
    [] r = "delSave"     -> [s EXCEPT !.saved = FALSE]

Post(sig) == CASE sig = "up" -> "postUp" [] sig = "down" -> "postDown" [] sig = "skip" -> "postSkip"

(***************************************************************************)
(* TABLE: what the pages read.                                             *)
(***************************************************************************)
InQueue(s) == ~s.seen /\ ~s.skip
InHistory(s) == s.seen
\* History's `signal` for a row; "skip" is the leftover the page labels "Skipped".
ServerSignal(s) == IF s.fb # "none" THEN s.fb ELSE IF s.skip THEN "dismissed" ELSE "skip"

(***************************************************************************)
(* TABLE: which requests a tap sends, from what the tab shows (`cur`).     *)
(* "U" is the store's undefined: no verdict shown.                         *)
(***************************************************************************)
JudgeSteps(cur, sig) == IF sig = "up" /\ cur = "up" THEN <<"delFeedback">> ELSE <<Post(sig)>>
JudgeTarget(cur, sig) == IF sig = "up" /\ cur = "up" THEN "U" ELSE sig

\* `kept` is the tab's belief that seen was stamped while the card showed no
\* verdict (it was saved or un-liked here): then undoing a Like or Pass must
\* leave seen alone. Otherwise the undo also clears the seen its Like stamped.
RestoreSteps(cur, prev, kept) ==
  IF cur = prev THEN <<>>
  ELSE IF prev = "U" THEN (IF cur = "skip" THEN <<"delDismiss">>
                           ELSE IF kept \/ Variant = "undoLeavesSeen" THEN <<"delFeedback">>
                           ELSE <<"delFeedback", "delDismiss">>)
  ELSE IF cur = "skip" THEN <<"delDismiss", Post(prev)>>
  ELSE IF prev = "skip" /\ cur # "U" THEN <<"delFeedback">>
  ELSE <<Post(prev)>>
\* The second request of skip -> thumbs, and of thumbs -> no verdict, is
\* best-effort: its failure is swallowed.
RestoreSoft(cur, prev, kept) ==
  cur # prev /\ (IF prev = "U" THEN Len(RestoreSteps(cur, prev, kept)) = 2 ELSE cur = "skip")

\* History's "Return to feed": first request, by the label the row shows.
RtfFirst(shown) == IF shown \in {"up", "down"} THEN "delFeedback" ELSE "delDismiss"

(***************************************************************************)
(* Tabs                                                                    *)
(***************************************************************************)
BlankTab ==
  [page |-> "feed", row |-> FALSE, vis |-> "U", conf |-> "U", loaded |-> "skip",
   booked |-> FALSE, savedVis |-> FALSE, savedConf |-> FALSE, q |-> <<>>, sq |-> <<>>,
   undoTo |-> "none", kept |-> FALSE, rtf |-> FALSE, solo |-> Ghosts, snap |-> Fresh,
   snapOk |-> FALSE]

Shown(tb) == IF tb.vis = "U" THEN tb.loaded ELSE tb.vis
Idle(tb) == tb.q = <<>> /\ tb.sq = <<>> /\ ~tb.rtf
AllIdle == \A t \in Tabs : Idle(tab[t])

\* A new toast replaces the old one: queued decisions no longer own the Undo.
Untok(q) == [i \in 1..Len(q) |-> [q[i] EXCEPT !.tok = FALSE]]

\* Tab t becomes `tb`; if a request reached the server, the other tabs are stale.
Bump(t, tb, applied) ==
  [u \in Tabs |-> IF u = t THEN tb ELSE [tab[u] EXCEPT !.solo = @ /\ ~applied]]

Init ==
  /\ srv = Fresh
  /\ tab = [t \in Tabs |-> [BlankTab EXCEPT !.row = TRUE]]
  /\ fails = 0
  /\ evt = "none"
  /\ savedGhost = FALSE

\* Open or reload a page: it shows what the server has now.
LoadTo(t, page) ==
  /\ Idle(tab[t])
  /\ tab' = [tab EXCEPT ![t] =
       IF page = "feed"
       THEN IF InQueue(srv)
            THEN [BlankTab EXCEPT !.row = TRUE, !.savedVis = srv.saved, !.savedConf = srv.saved]
            ELSE BlankTab
       ELSE IF InHistory(srv)
            THEN [BlankTab EXCEPT !.page = "history", !.row = TRUE,
                                  !.loaded = ServerSignal(srv), !.booked = srv.saved]
            ELSE [BlankTab EXCEPT !.page = "history"]]
  /\ evt' = "none"
  /\ UNCHANGED <<srv, fails, savedGhost>>

OpenFeed(t) == LoadTo(t, "feed")
OpenHistory(t) == LoadTo(t, "history")

\* UndoRestores compares against the rows as they were at this tap.
Snapshot(tb, unlike) == Ghosts /\ ~unlike /\ tb.q = <<>> /\ tb.sq = <<>>

\* Feed: More like this / Less like this / Dismiss on the card.
Judge(t, sig) ==
  LET tb == tab[t]
      cur == tb.vis
      unlike == sig = "up" /\ cur = "up"
      op == [steps |-> JudgeSteps(cur, sig), soft |-> FALSE, target |-> JudgeTarget(cur, sig),
             mode |-> "opt", tok |-> ~unlike, tag |-> IF unlike THEN "unlike" ELSE "judge"]
  IN /\ tb.page = "feed" /\ tb.row /\ Len(tb.q) < MaxQueue
     /\ tab' = [tab EXCEPT ![t] =
          [tb EXCEPT !.vis = op.target,
                     !.q = Append(Untok(tb.q), op),
                     !.undoTo = IF unlike THEN "none" ELSE cur,
                     !.snap = IF Snapshot(tb, unlike) THEN srv ELSE Fresh,
                     !.snapOk = Snapshot(tb, unlike)]]
     /\ evt' = "none"
     /\ UNCHANGED <<srv, fails, savedGhost>>

TapLike(t) == Judge(t, "up")
TapPass(t) == Judge(t, "down")
TapDismiss(t) == Judge(t, "skip")

\* Feed: Undo on the toast of the last decision.
TapUndo(t) ==
  LET tb == tab[t]
      prev == tb.undoTo
      cur == tb.vis
      steps == RestoreSteps(cur, prev, tb.kept)
      op == [steps |-> steps, soft |-> RestoreSoft(cur, prev, tb.kept), target |-> prev,
             mode |-> "opt", tok |-> FALSE,
             tag |-> IF prev = "U" /\ cur \in {"up", "down"} THEN "undoVerdict" ELSE "undo"]
  IN /\ tb.page = "feed" /\ tb.row /\ prev # "none" /\ Len(tb.q) < MaxQueue
     /\ tab' = [tab EXCEPT ![t] =
          [tb EXCEPT !.undoTo = "none",
                     !.vis = prev,
                     !.q = IF steps = <<>> THEN Untok(tb.q) ELSE Append(Untok(tb.q), op),
                     !.snapOk = @ /\ steps # <<>>]]
     /\ evt' = "none"
     /\ UNCHANGED <<srv, fails, savedGhost>>

\* Feed: the Save button (saves have their own store and queue).
TapSave(t) ==
  LET tb == tab[t]
      un == tb.savedVis
      op == [steps |-> IF un THEN <<"delSave">> ELSE <<"saveUpsert", "saveSeen">>,
             soft |-> ~un, target |-> ~un]
  IN /\ tb.page = "feed" /\ tb.row /\ tb.sq = <<>>
     /\ tab' = [tab EXCEPT ![t] =
          [tb EXCEPT !.savedVis = ~un, !.sq = <<op>>, !.undoTo = "none",
                     !.q = Untok(tb.q), !.snapOk = FALSE]]
     /\ evt' = "none"
     /\ UNCHANGED <<srv, fails, savedGhost>>

\* History: "Change to Liked" / "Change to Passed".
ChangeTo(t, sig) ==
  LET tb == tab[t]
      op == [steps |-> JudgeSteps(tb.vis, sig), soft |-> FALSE, target |-> JudgeTarget(tb.vis, sig),
             mode |-> "opt", tok |-> FALSE, tag |-> "change"]
  IN /\ tb.page = "history" /\ tb.row /\ Len(tb.q) < MaxQueue
     /\ Shown(tb) \notin {sig, "dismissed"} /\ ~tb.booked
     /\ tab' = [tab EXCEPT ![t] = [tb EXCEPT !.vis = op.target, !.q = Append(tb.q, op)]]
     /\ evt' = "none"
     /\ UNCHANGED <<srv, fails, savedGhost>>

TapChangeToLiked(t) == ChangeTo(t, "up")
TapChangeToPassed(t) == ChangeTo(t, "down")

\* History: "Return to feed" / "Allow in feed again". Its second request is
\* only sent once the first one has answered.
TapReturnToFeed(t) ==
  LET tb == tab[t]
      first == RtfFirst(Shown(tb))
      op == [steps |-> <<first>>, soft |-> FALSE, target |-> "U", mode |-> "conf", tok |-> FALSE,
             tag |-> IF first = "delFeedback" THEN "rtf1" ELSE "rtf2"]
  IN /\ tb.page = "history" /\ tb.row /\ ~tb.rtf /\ Len(tb.q) < MaxQueue
     /\ tab' = [tab EXCEPT ![t] = [tb EXCEPT !.q = Append(tb.q, op), !.rtf = TRUE]]
     /\ evt' = "none"
     /\ UNCHANGED <<srv, fails, savedGhost>>

Rtf2Op == [steps |-> <<"delDismiss">>, soft |-> FALSE, target |-> "U", mode |-> "conf",
           tok |-> FALSE, tag |-> "rtf2"]

\* The next request of tab t's oldest waiting tap.
\*   "ok"   the server applies it and the tab gets the answer
\*   "lost" the server applies it, the tab sees a failure
\*   "fail" the server never applies it, the tab sees a failure
\* The tab updates `kept` from each answer it gets: an un-like leaves seen
\* stamped, the dismiss-clear clears it.
Step(t, outcome) ==
  LET t0 == tab[t]
      o == Head(t0.q)
      r == Head(o.steps)
      tb == [t0 EXCEPT !.kept = IF outcome # "ok" THEN @
                                ELSE IF r = "delDismiss" THEN FALSE
                                ELSE IF o.tag = "unlike" THEN TRUE ELSE @]
      last == Len(o.steps) = 1
      applied == outcome # "fail"
      s2 == IF applied THEN Apply(srv, r) ELSE srv
      good == outcome = "ok" \/ (o.soft /\ last)
      rest == Tail(tb.q)
      optLeft == Cardinality({i \in 1..Len(rest) : rest[i].mode = "opt"})
      solo2 == tb.solo /\ outcome = "ok"
      done ==
        IF o.mode = "opt"
        THEN [tb EXCEPT !.q = rest,
                        !.conf = IF good THEN o.target ELSE @,
                        !.vis = IF ~good /\ optLeft = 0 THEN tb.conf ELSE @,
                        !.undoTo = IF ~good /\ o.tok THEN "none" ELSE @,
                        !.solo = solo2]
        ELSE IF ~good THEN [tb EXCEPT !.q = rest, !.rtf = FALSE, !.solo = solo2]
        ELSE IF o.tag = "rtf1"
             THEN [tb EXCEPT !.q = Append(rest, Rtf2Op), !.conf = "U", !.vis = "U", !.solo = solo2]
             ELSE [tb EXCEPT !.q = rest, !.rtf = FALSE, !.row = FALSE, !.conf = "U", !.vis = "U",
                             !.loaded = "skip", !.booked = FALSE, !.solo = solo2]
  IN /\ t0.q # <<>>
     /\ outcome # "ok" => fails < MaxFails
     /\ srv' = s2
     /\ fails' = IF outcome = "ok" THEN fails ELSE fails + 1
     /\ UNCHANGED savedGhost
     /\ IF good /\ ~last
        THEN /\ tab' = Bump(t, [tb EXCEPT !.q = <<[o EXCEPT !.steps = Tail(@)]>> \o rest,
                                          !.solo = solo2], applied)
             /\ evt' = "none"
        ELSE /\ tab' = Bump(t, done, applied)
             /\ evt' = IF good /\ o.tag \in {"undo", "undoVerdict"} /\ solo2 /\ tb.snapOk /\ s2 # tb.snap
                         THEN (IF o.tag = "undoVerdict" /\ tb.snap.fb = "none"
                               THEN "verdictUndoMismatch" ELSE "undoMismatch")
                       ELSE IF good /\ o.tag = "rtf2" /\ ~(InQueue(s2) /\ s2.fb = "none")
                         THEN "rtfMismatch"
                       ELSE "none"

RequestOk(t) == Step(t, "ok")
RequestLost(t) == Step(t, "lost")
RequestFails(t) == Step(t, "fail")

\* The same for the save queue. POST /api/saves is two statements: the saves
\* upsert, then a seen_at stamp whose failure is only logged. A save that
\* answered OK marks the card `kept` (use-feed-triage.ts save -> markSeen).
SaveStep(t, outcome) ==
  LET tb == tab[t]
      o == Head(tb.sq)
      r == Head(o.steps)
      last == Len(o.steps) = 1
      applied == outcome # "fail"
      s2 == IF applied THEN Apply(srv, r) ELSE srv
      good == outcome = "ok" \/ (o.soft /\ last)
      solo2 == tb.solo /\ outcome = "ok"
  IN /\ tb.sq # <<>>
     /\ outcome # "ok" => fails < MaxFails
     /\ srv' = s2
     /\ fails' = IF outcome = "ok" THEN fails ELSE fails + 1
     /\ savedGhost' = IF applied /\ r \in {"saveUpsert", "delSave"} THEN r = "saveUpsert" ELSE savedGhost
     /\ evt' = "none"
     /\ tab' = Bump(t,
          IF good /\ ~last
          THEN [tb EXCEPT !.sq = <<[o EXCEPT !.steps = Tail(@)]>>, !.solo = solo2]
          ELSE [tb EXCEPT !.sq = <<>>,
                          !.savedConf = IF good THEN o.target ELSE @,
                          !.savedVis = IF good THEN @ ELSE tb.savedConf,
                          !.kept = @ \/ (good /\ o.target),
                          !.solo = solo2],
          applied)

SaveRequestOk(t) == SaveStep(t, "ok")
SaveRequestLost(t) == SaveStep(t, "lost")
SaveRequestFails(t) == SaveStep(t, "fail")

Next ==
  \E t \in Tabs :
    \/ OpenFeed(t) \/ OpenHistory(t)
    \/ TapLike(t) \/ TapPass(t) \/ TapDismiss(t) \/ TapUndo(t) \/ TapSave(t)
    \/ TapChangeToLiked(t) \/ TapChangeToPassed(t) \/ TapReturnToFeed(t)
    \/ RequestOk(t) \/ RequestLost(t) \/ RequestFails(t)
    \/ SaveRequestOk(t) \/ SaveRequestLost(t) \/ SaveRequestFails(t)

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* The rules                                                               *)
(***************************************************************************)

\* With nothing in flight, an artist waiting in the Feed queue has no live
\* Like or Pass on record.
NoQueuedVerdict == AllIdle => ~(InQueue(srv) /\ srv.fb # "none")

\* Feed Undo, when every request succeeded and no other tab did anything,
\* leaves the rows exactly as they were before the undone tap.
UndoRestores == evt \notin {"undoMismatch", "verdictUndoMismatch"}

\* The part of UndoRestores for the plain case: Undo of a Like or Pass that was
\* tapped on a card with no verdict, on screen and on the server.
UndoOfVerdictRestores == evt # "verdictUndoMismatch"

\* When History reports that "Return to feed" worked, the artist is in the
\* queue with no verdict.
ReturnToFeedWorks == evt # "rtfMismatch"

\* Only Save and Unsave change whether the artist is saved.
SavedStaysSaved == srv.saved = savedGhost

\* The artist is always reachable: in the Feed queue or listed in History.
NeverStuck == InQueue(srv) \/ InHistory(srv)

\* A tab whose requests all succeeded, with nothing in flight and no other tab
\* having written since it loaded.
Settled(tb) == Idle(tb) /\ tb.solo

\* A settled Feed card with no verdict and no save is still in the queue, so
\* a reload shows the same card.
ScreenUndecidedIsQueued ==
  \A t \in Tabs :
    LET tb == tab[t]
    IN Settled(tb) /\ tb.page = "feed" /\ tb.row /\ tb.vis = "U" /\ ~tb.savedVis
         => InQueue(srv) /\ srv.fb = "none"

\* The verdict a settled tab shows is the verdict History shows after a
\* reload (History shows "Saved" over any verdict, so saved artists are left out).
ScreenSignal(tb) ==
  IF tb.page = "feed"
  THEN (CASE tb.vis = "skip" -> "dismissed" [] tb.vis = "U" -> "none" [] OTHER -> tb.vis)
  ELSE Shown(tb)

ScreenVerdictIsRecorded ==
  \A t \in Tabs :
    LET tb == tab[t]
    IN Settled(tb) /\ tb.row /\ ScreenSignal(tb) # "none" /\ ~srv.saved
         => InHistory(srv) /\ ServerSignal(srv) = ScreenSignal(tb)

Sym == Permutations(Tabs)

\* chart.cfg only: leave saving out, so the whole graph is small enough to draw.
NoSaves == ~srv.saved /\ \A t \in Tabs : tab[t].sq = <<>>
=============================================================================
