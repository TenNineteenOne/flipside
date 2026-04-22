-- Weekly challenges: a small, rotating per-user quest surfaced on /explore
-- that nudges users toward varied discovery behaviors. One active challenge
-- per user per ISO week. Progress increments atomically via RPC called from
-- rpc_record_feedback on thumbs_up (and optionally other triggers).

CREATE TABLE IF NOT EXISTS user_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_key TEXT NOT NULL,
  week_start DATE NOT NULL,             -- ISO Monday 00:00 UTC
  target_count INT NOT NULL CHECK (target_count > 0),
  progress INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start, challenge_key)
);

CREATE INDEX IF NOT EXISTS idx_user_challenges_user_week
  ON user_challenges(user_id, week_start);

ALTER TABLE user_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_challenges: own rows" ON user_challenges;
CREATE POLICY "user_challenges: own rows" ON user_challenges FOR ALL
  USING (auth.uid() = user_id);

-- Increment progress atomically. Caller passes the week_start (a DATE) so
-- the server and client agree on which week is active. Stamps completed_at
-- on first crossing target_count; subsequent increments leave completed_at
-- alone (idempotent crossing).
CREATE OR REPLACE FUNCTION rpc_increment_challenge_progress(
  p_user_id UUID,
  p_week_start DATE,
  p_signal TEXT,
  p_increment INT DEFAULT 1
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_row user_challenges%ROWTYPE;
  v_matches BOOLEAN;
BEGIN
  SELECT * INTO v_row
  FROM user_challenges
  WHERE user_id = p_user_id AND week_start = p_week_start
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- challenge_key encodes the qualifying signal(s). See lib/challenges/engine.ts
  -- for the canonical mapping. We accept any key prefixed with `<signal>_` OR
  -- the generic `any_` challenges that count all engagement.
  v_matches := v_row.challenge_key LIKE (p_signal || '_%')
            OR v_row.challenge_key LIKE 'any_%';

  IF NOT v_matches THEN
    RETURN;
  END IF;

  UPDATE user_challenges
  SET
    progress = LEAST(target_count, progress + p_increment),
    completed_at = CASE
      WHEN completed_at IS NULL AND progress + p_increment >= target_count THEN NOW()
      ELSE completed_at
    END
  WHERE id = v_row.id;
END;
$$;

-- Re-create rpc_record_feedback so thumbs_up increments the active
-- challenge's progress atomically with the feedback write. Skips and
-- thumbs_down do not increment (challenge semantics are positive-action).
CREATE OR REPLACE FUNCTION rpc_record_feedback(
  p_user_id UUID,
  p_artist_id TEXT,
  p_signal TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted BOOLEAN := FALSE;
  v_week_start DATE;
BEGIN
  IF p_signal NOT IN ('thumbs_up', 'thumbs_down', 'skip') THEN
    RAISE EXCEPTION 'invalid signal: %', p_signal;
  END IF;

  IF p_signal <> 'skip' THEN
    -- Detect first-time insert via (xmax = 0) so we only increment challenge
    -- progress when the feedback row is genuinely new. This prevents a user
    -- toggling thumbs-up repeatedly from gaming the weekly counter.
    WITH up AS (
      INSERT INTO feedback (user_id, spotify_artist_id, signal, deleted_at)
      VALUES (p_user_id, p_artist_id, p_signal, NULL)
      ON CONFLICT (user_id, spotify_artist_id)
      DO UPDATE SET
        signal = EXCLUDED.signal,
        deleted_at = NULL
      RETURNING (xmax = 0) AS inserted
    )
    SELECT inserted INTO v_inserted FROM up;
  END IF;

  UPDATE recommendation_cache
  SET
    seen_at = NOW(),
    skip_at = CASE WHEN p_signal = 'skip' THEN NOW() ELSE skip_at END
  WHERE user_id = p_user_id
    AND spotify_artist_id = p_artist_id;

  -- Increment active challenge only on genuinely new thumbs_up rows.
  IF v_inserted AND p_signal = 'thumbs_up' THEN
    v_week_start := date_trunc('week', (NOW() AT TIME ZONE 'UTC'))::DATE;
    PERFORM rpc_increment_challenge_progress(
      p_user_id,
      v_week_start,
      p_signal,
      1
    );
  END IF;
END;
$$;
