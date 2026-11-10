import { StatsClient } from "@/components/stats/stats-client"
import { statsEmpty, statsFull, statsStress } from "@/lib/dev-preview/stats-fixtures"

/**
 * The production Stats page exactly as app/(app)/stats/page.tsx renders it, with fixture data:
 * a full account, `?empty=1` (new account) and `?stress=1` (long genres, large counts, 200 points).
 */
export default async function StatsPreview({ searchParams }: { searchParams: Promise<{ empty?: string; stress?: string }> }) {
  const { empty, stress } = await searchParams
  const stats = empty ? statsEmpty : stress ? statsStress : statsFull
  return (
    <StatsClient
      totalDiscovered={stats.totalDiscovered}
      totalSaves={stats.totalSaves}
      totalLikes={stats.totalLikes}
      totalDislikes={stats.totalDislikes}
      topGenres={stats.topGenres}
      savedArtists={stats.savedArtists}
      likedArtists={stats.likedArtists}
    />
  )
}
