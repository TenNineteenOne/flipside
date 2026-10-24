import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { StatsClient } from "@/components/stats/stats-client"
import { loadStats } from "./stats-data"

export default async function StatsPage() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const stats = await loadStats(createServiceClient(), session.user.id)

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
