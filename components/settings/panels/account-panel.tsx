"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { toast } from "sonner"

export function AccountPanel() {
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  async function handleDeleteAccount() {
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      return
    }
    setIsDeleting(true)
    try {
      const res = await fetch("/api/account", { method: "DELETE" })
      if (!res.ok && !res.redirected) {
        throw new Error("Delete failed")
      }
      window.location.href = "/"
    } catch {
      toast.error("Failed to delete account")
      setIsDeleting(false)
      setDeleteConfirm(false)
    }
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Account</div>
      <div className="fs-card col gap-12">
        <button
          className="btn"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          Sign out
        </button>
        <button
          className="btn"
          onClick={handleDeleteAccount}
          disabled={isDeleting}
          style={{ color: "#ff7b7b", borderColor: "rgba(255,75,75,0.2)" }}
        >
          {isDeleting
            ? "Deleting…"
            : deleteConfirm
            ? "Are you sure? Tap again to confirm"
            : "Forget my account permanently"}
        </button>
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          No email. No password. If you forget your username, your account is gone.
        </div>
      </div>
    </div>
  )
}
