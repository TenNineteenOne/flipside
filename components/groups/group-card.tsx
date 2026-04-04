"use client"

import Link from "next/link"
import { Users, Check, Copy } from "lucide-react"
import { useState } from "react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface GroupCardProps {
  id: string
  name: string
  memberCount: number
  inviteUrl: string
}

export function GroupCard({ id, name, memberCount, inviteUrl }: GroupCardProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable — ignore
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link
            href={`/groups/${id}`}
            className="hover:text-primary transition-colors"
          >
            {name}
          </Link>
        </CardTitle>
        <CardDescription className="flex items-center gap-1">
          <Users className="size-3.5" />
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {inviteUrl}
        </code>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={handleCopy}
          aria-label="Copy invite link"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </CardContent>
    </Card>
  )
}
