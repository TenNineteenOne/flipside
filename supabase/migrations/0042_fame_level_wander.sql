-- #205 Fold Explore into Feed: one "How famous?" slider + "Wander farther".
--
-- fame_level (0–4) replaces popularity_curve + underground_mode as the user
-- control; lib/settings/fame.ts maps it to the engine's curve (0.90 / 0.92 /
-- 0.95 / 0.97 / 0.99) with the popularity <= 50 cap at stop 0 only.
-- popularity_curve, underground_mode, deep_discovery and play_threshold stay
-- one release for rollback; the app no longer reads or writes them except
-- play_threshold, which is now a fixed engine constant (5).
--
-- Re-runnable: the column add and the three one-time data updates run only
-- when fame_level does not exist yet, so a second run changes nothing (it
-- must not re-merge deep_discovery or reset fame_level choices made since).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'fame_level'
  ) THEN
    ALTER TABLE public.users
      ADD COLUMN fame_level SMALLINT NOT NULL DEFAULT 2
      CHECK (fame_level >= 0 AND fame_level <= 4);

    -- Backfill: underground → 0; else the nearest of stops 1..4 by curve
    -- (0.92 / 0.95 / 0.97 / 0.99). A curve of 0.90 / 0.91 maps to 1.
    UPDATE public.users SET fame_level = CASE
      WHEN underground_mode THEN 0
      WHEN popularity_curve < 0.935 THEN 1
      WHEN popularity_curve < 0.960 THEN 2
      WHEN popularity_curve < 0.980 THEN 3
      ELSE 4
    END;

    -- Deep discovery is folded into Wander farther (adventurous).
    UPDATE public.users SET adventurous = adventurous OR deep_discovery;

    -- Play threshold is fixed at 5 for everyone (owner decision 9).
    UPDATE public.users SET play_threshold = 5;
  END IF;
END
$$;
