"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface SettingsFormProps {
  displayName: string | null
  avatarUrl: string | null
  initialPlayThreshold: number
  initialLastfmUsername: string | null
  flipsidePlaylistId: string | null
}

export function SettingsForm({
  displayName,
  avatarUrl,
  initialPlayThreshold,
  initialLastfmUsername,
  flipsidePlaylistId,
}: SettingsFormProps) {
  const [lastfmUsername, setLastfmUsername] = useState(
    initialLastfmUsername ?? ""
  )
  const [isSavingLastfm, setIsSavingLastfm] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function patchSettings(payload: Record<string, unknown>) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? "Failed to save")
    }
  }

  function handleThresholdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const value = parseInt(raw, 10)
      if (isNaN(value) || value < 0 || value > 100) return
      try {
        await patchSettings({ playThreshold: value })
      } catch {
        toast.error("Failed to save play threshold")
      }
    }, 800)
  }

  async function handleSaveLastfm() {
    setIsSavingLastfm(true)
    try {
      await patchSettings({ lastfmUsername: lastfmUsername.trim() })
      toast.success("Last.fm username saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save Last.fm username")
    } finally {
      setIsSavingLastfm(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Profile */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Profile</h2>
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-4">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={displayName ?? "User avatar"}
              width={48}
              height={48}
              className="size-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
              {displayName?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">{displayName ?? "Spotify user"}</p>
            <p className="text-xs text-muted-foreground">
              Profile synced from Spotify
            </p>
          </div>
        </div>
      </section>

      {/* Listening history */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Listening history</h2>
        <div className="rounded-xl border border-border bg-card px-4 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="play-threshold">Play threshold</Label>
              <p className="text-xs text-muted-foreground">
                Artists you&apos;ve played more than this many times will be
                filtered from recommendations.
              </p>
            </div>
            <Input
              id="play-threshold"
              type="number"
              min={0}
              max={100}
              defaultValue={initialPlayThreshold}
              className="w-24"
              onChange={handleThresholdChange}
            />
          </div>
        </div>
      </section>

      {/* Last.fm */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Last.fm</h2>
        <div className="rounded-xl border border-border bg-card px-4 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="lastfm-username">Last.fm username</Label>
              <p className="text-xs text-muted-foreground">
                Connect your Last.fm account to improve filtering accuracy.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                id="lastfm-username"
                type="text"
                placeholder="your-lastfm-username"
                value={lastfmUsername}
                onChange={(e) => setLastfmUsername(e.target.value)}
                className="max-w-xs"
              />
              <Button
                onClick={handleSaveLastfm}
                disabled={isSavingLastfm}
                size="sm"
              >
                {isSavingLastfm ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Flipside playlist */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Flipside playlist</h2>
        <div className="rounded-xl border border-border bg-card px-4 py-4">
          {flipsidePlaylistId ? (
            <a
              href={`https://open.spotify.com/playlist/${flipsidePlaylistId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Your Flipside Discoveries playlist
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              No playlist yet. Save an artist from your feed to create it
              automatically.
            </p>
          )}
        </div>
      </section>

      {/* Account */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Account</h2>
        <div className="rounded-xl border border-border bg-card px-4 py-4">
          <form action="/api/auth/signout" method="POST">
            <Button type="submit" variant="destructive" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </section>
    </div>
  )
}
