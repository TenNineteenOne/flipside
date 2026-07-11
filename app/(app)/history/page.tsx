import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { HistoryClient } from "@/components/history/history-client"
import { getHistoryPage } from "@/lib/history/query"

export default async function HistoryPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  const { history, hasMore } = await getHistoryPage(supabase, userId, { offset: 0, limit: 50 })

  return <HistoryClient history={history} hasMore={hasMore} />
}
