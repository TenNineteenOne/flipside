import { headers } from "next/headers"
import { FeedClient } from "@/components/feed/feed-client"
import { guessFeedLayout } from "@/lib/feed/layout-guess"
import { previewArtists, previewChallenge, realisticArtists } from "@/lib/dev-preview/fixtures"

/**
 * The production feed exactly as app/(app)/feed/page.tsx renders it, with fixture artists.
 * `?start=N` starts with only the first N (the fetch stub then serves the rest in batches).
 * `?real=1` swaps in rows shaped like real data (popularity 0, long hyphenated genres);
 * `?n=N` repeats the fixtures up to N artists (e.g. 40 or 80) to stress the header strip.
 * The weekly challenge strip shows "Five in a week" at 2/5; `?challenge=done` shows it completed, `?challenge=none` hides it.
 */
export default async function FeedPreview({ searchParams }: { searchParams: Promise<{ start?: string; real?: string; n?: string; challenge?: string }> }) {
  const { start, real, n: count, challenge } = await searchParams
  const base = realisticArtists(real === "1", Number(count) || 0)
  const n = start === undefined ? base.length : Math.max(1, Number(start) || 1)
  return (
    <FeedClient
      recommendations={start === undefined ? base : previewArtists.slice(0, n)}
      musicPlatform="spotify"
      signalCount={0}
      initialLayout={guessFeedLayout(await headers())}
      challengePromise={Promise.resolve(
        challenge === "none" ? null : { ...previewChallenge, ...(challenge === "done" && { progress: 5, completed: true }) },
      )}
    />
  )
}
