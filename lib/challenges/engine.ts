/**
 * Weekly challenges — small rotating quests, shown as one line under the Feed
 * header (ChallengeStrip); the feedback and saves routes assign and credit them.
 *
 * Model: one active challenge per user per ISO week. The challenge_key
 * encodes the qualifying feedback signal (prefix before `_`) so the
 * rpc_increment_challenge_progress RPC can match:
 *   thumbs_up_*  → counted on thumbs-up
 *   save_*       → counted on a new save (POST /api/saves)
 *
 * Week boundary: Monday 00:00 UTC. We compute it via ISO-style `date_trunc`
 * in SQL and mirror it in TS with getISOWeekStart().
 *
 * The row must exist before any feedback of the week: the progress RPC
 * no-ops without it. POST /api/feedback assigns it before a thumbs-up
 * (ensureCurrentChallenge).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ChallengeTemplate {
  key: string
  title: string
  description: string
  target: number
}

export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  {
    key: 'thumbs_up_any',
    title: 'Five in a week',
    description: 'Thumbs-up 5 artists',
    target: 5,
  },
  {
    key: 'thumbs_up_deep',
    title: 'Deep dive',
    description: 'Thumbs-up 7 artists this week',
    target: 7,
  },
  ...[
    ['thumbs_up_three', 'Warm-up', 'Thumbs-up 3 artists', 3],
    ['thumbs_up_four', 'Fab four', 'Thumbs-up 4 artists', 4],
    ['thumbs_up_ten', 'Ten out of ten', 'Thumbs-up 10 artists', 10],
    ['thumbs_up_twelve', 'Dozen deep', 'Thumbs-up 12 artists', 12],
    ['save_two', 'Pocket pair', 'Save 2 different artists', 2],
    ['save_three', 'Triple stash', 'Save 3 different artists', 3],
    ['save_four', 'Keepers', 'Save 4 different artists', 4],
    ['save_five', 'Crate digger', 'Save 5 different artists', 5],
    ['save_eight', 'Full shelf', 'Save 8 different artists', 8],
  ].map(([key, title, description, target]) => ({
    key: key as string,
    title: title as string,
    description: description as string,
    target: target as number,
  })),
]

/**
 * ISO-week Monday 00:00 UTC as a YYYY-MM-DD date string, matching the
 * Postgres `date_trunc('week', ...)` rollup used server-side.
 */
export function getISOWeekStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1 // days back to Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

// Only templates the RPC credits honestly: thumbs_up_* counts any thumbs-up, save_* any new save.
// No rail-specific thumbs_up_* templates (the RPC can't tell rails apart).
// Order interleaves thumbs/save so neighbours differ in kind too.
const ROTATING_KEYS = [
  'thumbs_up_any', 'save_three', 'thumbs_up_deep', 'save_two', 'thumbs_up_three', 'save_five',
  'thumbs_up_ten', 'save_four', 'thumbs_up_four', 'save_eight', 'thumbs_up_twelve',
]

/**
 * This week's template: ROTATING_KEYS indexed by weeks since 1970-01-05 (a Monday).
 * Consecutive weeks never repeat, and the pick is stable within a week (reloads and
 * the feedback/saves routes' pre-RPC ensure agree).
 */
export function pickWeeklyTemplate(weekStart: string): ChallengeTemplate {
  const week = Math.round((Date.parse(weekStart) / 86400000 - 4) / 7)
  const n = ROTATING_KEYS.length
  const key = ROTATING_KEYS[((week % n) + n) % n]
  return CHALLENGE_TEMPLATES.find((t) => t.key === key)!
}

/**
 * Fetch (or assign) the user's active challenge for this ISO week.
 *
 * Assignment rule: pickWeeklyTemplate. The
 * UNIQUE (user_id, week_start, challenge_key) index keeps the row idempotent:
 * concurrent assigns on Monday morning can't spawn duplicates.
 */
export async function ensureCurrentChallenge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  now: Date = new Date(),
): Promise<UserChallenge | null> {
  const weekStart = getISOWeekStart(now)

  const read = () =>
    supabase
      .from('user_challenges')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .limit(1)
      .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toChallenge = (row: any): UserChallenge => ({
    id: row.id as string,
    key: row.challenge_key as string,
    weekStart: row.week_start as string,
    target: row.target_count as number,
    progress: row.progress as number,
    completedAt: (row.completed_at as string | null) ?? null,
    // null for a key no longer in CHALLENGE_TEMPLATES: the Feed then hides the strip.
    template: CHALLENGE_TEMPLATES.find((t) => t.key === row.challenge_key) ?? null,
  })

  const { data: existing } = await read()
  if (existing) return toChallenge(existing)

  const pick = pickWeeklyTemplate(weekStart)

  const { data: inserted, error } = await supabase
    .from('user_challenges')
    .insert({
      user_id: userId,
      challenge_key: pick.key,
      week_start: weekStart,
      target_count: pick.target,
    })
    .select('*')
    .single()

  // Lost a concurrent assign: the winner's row is this week's challenge.
  if (error?.code === '23505') {
    const { data: winner } = await read()
    return winner ? toChallenge(winner) : null
  }
  if (error || !inserted) return null
  return toChallenge(inserted)
}

export interface UserChallenge {
  id: string
  key: string
  weekStart: string
  target: number
  progress: number
  completedAt: string | null
  template: ChallengeTemplate | null
}
