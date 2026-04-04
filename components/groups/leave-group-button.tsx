"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function LeaveGroupButton({ groupId }: { groupId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLeave() {
    if (!confirm("Are you sure you want to leave this group?")) return
    setLoading(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/members/me`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to leave group")
      toast.success("You left the group")
      router.push("/groups")
    } catch {
      toast.error("Could not leave group. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="destructive" onClick={handleLeave} disabled={loading}>
      {loading ? "Leaving…" : "Leave group"}
    </Button>
  )
}
