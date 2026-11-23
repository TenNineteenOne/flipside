------------------------------- MODULE Tables -------------------------------
(* Prints the model's tables so harness/conformance.check.ts can compare them
   with the real code. One line per row; the first field names the table. *)
EXTENDS Decisions

States == [fb : {"none", "up", "down"}, seen : BOOLEAN, skip : BOOLEAN, saved : BOOLEAN]
Row(s) == <<s.fb, s.seen, s.skip, s.saved>>
Vis == {"U", "up", "down", "skip"}

ASSUME \A s \in States : \A r \in Requests :
  PrintT(<<"APPLY", Row(s), r, Row(Apply(s, r))>>)
ASSUME \A s \in States :
  PrintT(<<"READ", Row(s), InQueue(s), InHistory(s), ServerSignal(s)>>)
ASSUME \A cur \in Vis : \A sig \in {"up", "down", "skip"} :
  PrintT(<<"JUDGE", cur, sig, JudgeSteps(cur, sig), JudgeTarget(cur, sig)>>)
ASSUME \A cur \in Vis : \A prev \in Vis :
  PrintT(<<"RESTORE", cur, prev, RestoreSteps(cur, prev), RestoreSoft(cur, prev)>>)
ASSUME \A shown \in {"up", "down", "dismissed", "skip"} :
  PrintT(<<"RTF", shown, RtfFirst(shown)>>)
=============================================================================
