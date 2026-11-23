import { redirect } from "next/navigation"
import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { HistoryClient } from "@/components/history/history-client"
import { getHistoryPage } from "@/lib/history/query"

export default async function HistoryPage() {
  const session = await safeAuth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  const { history, hasMore } = await getHistoryPage(supabase, userId, { offset: 0, limit: 50 })

  // Keyed by the rows: a refresh that brings a different list (Back after rating in the Feed) remounts
  // the client, whose state is seeded once from these props.
  return <HistoryClient key={history.map((h) => `${h.artist_id}:${h.signal}`).join()} history={history} hasMore={hasMore} />
}
