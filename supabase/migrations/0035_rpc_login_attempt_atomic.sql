-- Atomic login-attempt rate limiting.
--
-- The previous flow (lib/rate-limiter.ts) did SELECT → evaluate-in-JS → UPSERT,
-- which is a read-then-write TOCTOU: N concurrent requests from one IP all read
-- the same count and each pass the check, so the effective cap was MAX_ATTEMPTS
-- × concurrency instead of MAX_ATTEMPTS. On Vercel (horizontal scaling, separate
-- function instances + DB connections) that race is reachable.
--
-- This RPC collapses the whole decision into a single INSERT … ON CONFLICT …
-- RETURNING, which takes a row lock and serializes concurrent callers, making
-- the increment atomic. Semantics match evaluateRateLimit():
--   * no row / expired window  → count resets to 1, allowed
--   * within window            → count + 1; limited once it exceeds p_max_attempts
-- Returns TRUE when the request should be rejected (rate-limited).

CREATE OR REPLACE FUNCTION rpc_register_login_attempt(
  p_ip_hash TEXT,
  p_window_ms INTEGER,
  p_max_attempts INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_now      TIMESTAMPTZ := now();
  v_expiry   INTERVAL := make_interval(secs => p_window_ms / 1000.0);
  v_count    INTEGER;
BEGIN
  INSERT INTO login_attempts (ip_hash, attempt_count, window_start)
  VALUES (p_ip_hash, 1, v_now)
  ON CONFLICT (ip_hash) DO UPDATE
    SET
      attempt_count = CASE
        WHEN login_attempts.window_start < v_now - v_expiry THEN 1
        ELSE login_attempts.attempt_count + 1
      END,
      window_start = CASE
        WHEN login_attempts.window_start < v_now - v_expiry THEN v_now
        ELSE login_attempts.window_start
      END
  RETURNING attempt_count INTO v_count;

  RETURN v_count > p_max_attempts;
END;
$$;

-- Server-only: called via the service-role client from lib/rate-limiter.ts.
REVOKE EXECUTE ON FUNCTION rpc_register_login_attempt(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_register_login_attempt(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_register_login_attempt(TEXT, INTEGER, INTEGER) FROM authenticated;
