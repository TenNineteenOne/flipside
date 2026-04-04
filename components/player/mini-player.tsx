"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Pause, Play, X } from "lucide-react"
import { useAudio } from "@/lib/audio-context"

export function MiniPlayer() {
  const { currentTrack, artistName, artistImageUrl, isPlaying, pause, resume, stop } = useAudio()

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          key="mini-player"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="fixed bottom-16 md:bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur"
        >
          <div className="flex items-center gap-3 px-4 py-2">
            {/* Album art */}
            <div className="shrink-0">
              {currentTrack.albumImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentTrack.albumImageUrl}
                  alt={currentTrack.albumName}
                  className="size-10 rounded object-cover"
                />
              ) : (
                <div className="size-10 rounded bg-muted" />
              )}
            </div>

            {/* Track info */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">
                {currentTrack.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {artistName}
              </p>
            </div>

            {/* Controls */}
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={isPlaying ? pause : resume}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
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
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
