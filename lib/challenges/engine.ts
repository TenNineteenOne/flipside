/**
 * Weekly challenges — small rotating quests surfaced on /explore.
 *
 * Model: one active challenge per user per ISO week. The challenge_key
 * encodes the qualifying feedback signal (prefix before `_`) so the
 * rpc_increment_challenge_progress RPC can match:
 *   thumbs_up_*  → counted on thumbs-up
 *   any_*        → counted on any positive feedback (reserved; unused for now)
 *
 * Week boundary: Monday 00:00 UTC. We compute it via ISO-style `date_trunc`
 * in SQL and mirror it in TS with getISOWeekStart().
 *
 * Adaptive fairness: on assignment, applicableFor(user) filters out
 * challenges that can't meaningfully apply to the current user state (e.g.
 * the "new anchor" challenge when every anchor is already touched). If all
 * templates are skipped, we fall back to the default `thumbs_up_any`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listAnchors, genreToAnchor } from '@/lib/genre/adjacency'

export interface ChallengeTemplate {
  key: string
  title: string
  description: string
  target: number
  /** Returns true when this template makes sense for the user's current state. */
  applicableFor: (ctx: ChallengeApplicabilityCtx) => boolean
}

export interface ChallengeApplicabilityCtx {
  touchedAnchors: Set<string>
  totalAnchors: number
  selectedGenres: string[]
  hasThumbsUp: boolean
}

export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  {
    key: 'thumbs_up_any',
    title: 'Five in a week',
    description: 'Thumbs-up 5 artists',
    target: 5,
    applicableFor: () => true,
  },
  {
    key: 'thumbs_up_new_anchor',
    title: 'Cross the streams',
    description: 'Thumbs-up 3 artists from an anchor you haven\u2019t touched',
    target: 3,
    applicableFor: (c) => c.touchedAnchors.size < c.totalAnchors,
  },
  {
    key: 'thumbs_up_wildcards',
    title: 'Embrace chaos',
    description: 'Thumbs-up 3 artists from Left-field wildcards',
    target: 3,
    applicableFor: () => true,
  },
  {
    key: 'thumbs_up_adjacent',
    title: 'Stretch your taste',
    description: 'Thumbs-up 4 artists from Adjacent rails',
    target: 4,
    applicableFor: (c) => c.selectedGenres.length > 0,
  },
  {
    key: 'thumbs_up_wildcard_seed',
    title: 'Second act',
    description: 'Thumbs-up 3 artists from your wildcard rail',
    target: 3,
    applicableFor: (c) => c.hasThumbsUp,
  },
  {
    key: 'thumbs_up_deep',
    title: 'Deep dive',
    description: 'Thumbs-up 7 artists this week',
    target: 7,
    applicableFor: () => true,
  },
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

/**
 * Fetch (or assign) the user's active challenge for this ISO week.
 *
 * Assignment rule: first applicable template (by declared order) that the
 * user hasn't been assigned this week. The UNIQUE (user_id, week_start,
 * challenge_key) index keeps the row idempotent — concurrent /explore
 * loads on Monday morning can't spawn duplicates.
 */
export async function ensureWeeklyChallenge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  ctx: ChallengeApplicabilityCtx,
  now: Date = new Date(),
): Promise<UserChallenge | null> {
  const weekStart = getISOWeekStart(now)

  const { data: existing } = await supabase
    .from('user_challenges')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return {
      id: existing.id as string,
      key: existing.challenge_key as string,
      weekStart: existing.week_start as string,
      target: existing.target_count as number,
      progress: existing.progress as number,
      completedAt: (existing.completed_at as string | null) ?? null,
      template: CHALLENGE_TEMPLATES.find((t) => t.key === existing.challenge_key) ?? null,
    }
  }

  const pick =
    CHALLENGE_TEMPLATES.find((t) => t.applicableFor(ctx)) ??
    CHALLENGE_TEMPLATES[0]

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

  if (error || !inserted) return null
  return {
    id: inserted.id as string,
    key: inserted.challenge_key as string,
    weekStart: inserted.week_start as string,
    target: inserted.target_count as number,
    progress: inserted.progress as number,
    completedAt: (inserted.completed_at as string | null) ?? null,
    template: pick,
  }
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

/**
 * Build the ChallengeApplicabilityCtx from the same pieces loadUserContext
 * pulls for rail generation. Keeping this synchronous + pure makes it
 * cheap to call from the /explore page.
 */
export function buildApplicabilityCtx(args: {
  selectedGenres: string[]
  listened: Array<{ genres: string[] }>
  hasThumbsUp: boolean
}): ChallengeApplicabilityCtx {
  const touched = new Set<string>()
  for (const g of args.selectedGenres) {
    const a = genreToAnchor(g)
    if (a) touched.add(a)
  }
  for (const row of args.listened) {
    const primary = row.genres[0]
    if (!primary) continue
    const a = genreToAnchor(primary)
    if (a) touched.add(a)
  }
  return {
    touchedAnchors: touched,
    totalAnchors: listAnchors().length,
    selectedGenres: args.selectedGenres,
    hasThumbsUp: args.hasThumbsUp,
  }
}
