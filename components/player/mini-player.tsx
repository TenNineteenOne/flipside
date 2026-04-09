"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Pause, Play, X } from "lucide-react"
import { useAudio } from "@/lib/audio-context"

export function MiniPlayer() {
  const { currentTrack, artistName, artistColor, isPlaying, pause, resume, stop } = useAudio()

  const dynamicColor = artistColor ?? "#8b5cf6"

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
           key="mini-player"
           initial={{ y: "150%", opacity: 0, x: "-50%" }}
           animate={{ y: -24, opacity: 1, x: "-50%" }} // Floating off bottom
           exit={{ y: "150%", opacity: 0, x: "-50%" }}
           transition={{ type: "spring", damping: 30, stiffness: 300 }}
           className="fixed bottom-0 left-1/2 z-50 w-[92%] max-w-[480px] overflow-hidden"
           style={{
             background: "rgba(10, 10, 10, 0.8)",
             backdropFilter: "blur(40px)",
             WebkitBackdropFilter: "blur(40px)",
             borderRadius: "24px",
             border: "1px solid rgba(255, 255, 255, 0.15)",
             boxShadow: `0 20px 40px rgba(0,0,0,0.8), 0 0 40px ${dynamicColor}33`,
           }}
        >
          {/* Progress Indicator pinned to TOP of the float card */}
          <div className="h-[3px] w-full bg-white/5 relative top-0">
            <div
              className="h-full absolute left-0"
              style={{ width: "40%", background: dynamicColor, boxShadow: `0 0 10px ${dynamicColor}` }}
            />
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            {/* Album art */}
            <div className="shrink-0 relative">
              {currentTrack.albumImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentTrack.albumImageUrl}
                  alt={currentTrack.albumName}
                  className="size-12 object-cover shadow-lg"
                  style={{
                    borderRadius: 10,
                  }}
                />
              ) : (
                <div
                  className="size-12 rounded-[10px] bg-black/50"
                  style={{
                    border: `2px solid ${dynamicColor}40`,
                  }}
                />
              )}
            </div>

            {/* Track info */}
            <div className="min-w-0 flex-1">
              <p className="truncate leading-tight font-bold text-white text-[15px]">
                {currentTrack.name}
              </p>
              <p 
                className="truncate font-semibold text-[13px] mt-0.5"
                style={{ color: dynamicColor, filter: "brightness(1.5)" }} // Brighten dynamic color for readability
              >
                {artistName}
              </p>
            </div>

            {/* Controls */}
            <div className="flex shrink-0 items-center gap-2 pr-1">
              <button
                onClick={isPlaying ? pause : resume}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex size-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 shadow-md"
                style={{ background: dynamicColor, color: "#000" }}
              >
                {isPlaying ? (
                  <Pause className="size-5" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play className="size-5" fill="currentColor" strokeWidth={0} />
                )}
              </button>
              
              <button
                onClick={stop}
                aria-label="Close player"
                className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white ml-2 text-gray-400"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
