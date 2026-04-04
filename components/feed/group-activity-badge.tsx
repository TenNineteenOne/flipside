"use client"

import { useEffect, useState } from "react"
import { createBrowserClient } from "@supabase/ssr"
import { Badge } from "@/components/ui/badge"

interface GroupActivityBadgeProps {
  spotifyArtistId: string
  initialFriendNames: string[]
}

export function GroupActivityBadge({
  spotifyArtistId,
  initialFriendNames,
}: GroupActivityBadgeProps) {
  const [friendNames, setFriendNames] = useState<string[]>(initialFriendNames)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const channel = supabase
      .channel(`group-activity-${spotifyArtistId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_activity",
          filter: `spotify_artist_id=eq.${spotifyArtistId}`,
        },
        () => {
          // Realtime payload only has user_id, not display_name.
          // Use "A friend" as a placeholder until the next full page load.
          setFriendNames((prev) => {
            const name = "A friend"
            if (prev.includes(name)) return prev
            return [...prev, name]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [spotifyArtistId])

  if (friendNames.length === 0) return null

  let label: string
  if (friendNames.length === 1) {
    label = `👥 ${friendNames[0]} also likes this`
  } else if (friendNames.length === 2) {
    label = `👥 ${friendNames[0]} and ${friendNames[1]} also like this`
  } else {
    label = `👥 ${friendNames[0]} and ${friendNames.length - 1} others also like this`
  }

  return (
    <Badge
      variant="secondary"
      className="rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300"
    >
      {label}
    </Badge>
  )
}
