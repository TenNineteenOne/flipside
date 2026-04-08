"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Pause, Play, X } from "lucide-react"
import { useAudio } from "@/lib/audio-context"

const ACCENT = "#8b5cf6"

export function MiniPlayer() {
  const { currentTrack, artistName, artistImageUrl, artistColor, isPlaying, pause, resume, stop } = useAudio()

  const dynamicColor = artistColor ?? ACCENT

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          key="mini-player"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="fixed bottom-16 md:bottom-0 left-0 right-0 z-40"
          style={{
            background: "var(--bg-elevated)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-2">
            {/* Album art */}
            <div className="shrink-0">
              {currentTrack.albumImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentTrack.albumImageUrl}
                  alt={currentTrack.albumName}
                  className="size-10 object-cover"
                  style={{
                    borderRadius: 6,
                    border: `2px solid ${dynamicColor}`,
                  }}
                />
              ) : (
                <div
                  className="size-10"
                  style={{
                    borderRadius: 6,
                    border: `2px solid ${dynamicColor}`,
                    background: "var(--bg-card)",
                  }}
                />
              )}
            </div>

            {/* Track info */}
            <div className="min-w-0 flex-1">
              <p
                className="truncate leading-tight"
                style={{
                  fontFamily: "Inter, var(--font-sans), sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                {currentTrack.name}
              </p>
              <p
                className="truncate"
                style={{
                  fontFamily: "Inter, var(--font-sans), sans-serif",
                  fontSize: 11,
                  fontWeight: 400,
                  color: "var(--text-secondary)",
                }}
              >
                {artistName}
              </p>
            </div>

            {/* Controls */}
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={isPlaying ? pause : resume}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex size-9 items-center justify-center rounded-full transition-opacity hover:opacity-80"
                style={{ background: ACCENT, color: "#ffffff" }}
              >
                {isPlaying ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
              <button
                onClick={stop}
                aria-label="Close player"
                className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-muted"
                style={{ color: "var(--text-secondary)" }}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div
            className="h-0.5 w-full"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <div
              className="h-full"
              style={{ width: "40%", background: dynamicColor }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
