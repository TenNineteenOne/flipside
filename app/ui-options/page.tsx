"use client"

import { useState } from "react"
import { Heart, Plus, Check } from "lucide-react"

export default function UIOptionsPage() {
  const [likedOption1, setLikedOption1] = useState(false)
  const [likedOption2, setLikedOption2] = useState(false)
  const [likedOption3, setLikedOption3] = useState(false)

  const [savedOption1, setSavedOption1] = useState(false)
  const [savedOption2, setSavedOption2] = useState(false)
  const [savedOption3, setSavedOption3] = useState(false)

  const mockArtistColor = "#8b5cf6" // A vibrant purple for mock purposes

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 flex flex-col items-center gap-16 pb-32">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-3">UI Configuration Options</h1>
        <p className="text-gray-400">Interact with the tracks and footer buttons below to feel the combinations.</p>
        <p className="text-green-500 mt-2 font-medium">Your Localhost is functional! You can view this live right now.</p>
      </div>

      {/* ───────────────────────────────────────────────────────── */}
      {/* OPTION 1 */}
      <section className="w-full max-w-md bg-[#121212] p-5 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden flex flex-col gap-6">
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ background: 'radial-gradient(circle at top left, rgba(139,92,246,0.1), transparent 70%)' }} />
        
        <div className="z-10 bg-black/40 rounded-lg py-1 px-4 mb-2 max-w-max text-xs font-bold uppercase tracking-wider text-purple-400 border border-purple-500/20">
          Option 1: The Classic Icons
        </div>

        {/* Track Mock */}
        <div className="z-10 flex items-center justify-between p-3 rounded-2xl bg-white/5 border-l-[3px]" style={{ borderColor: mockArtistColor }}>
          <div className="flex flex-col">
            <span className="font-bold text-[15px]">Night Drive</span>
            <span className="text-[13px] text-gray-400">The Midnight</span>
          </div>
          <button 
            onClick={() => setLikedOption1(!likedOption1)}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:bg-white/10"
          >
            {likedOption1 ? (
              <Heart size={20} className="text-[#1db954]" fill="#1db954" strokeWidth={0} />
            ) : (
              <Heart size={20} className="text-gray-400" strokeWidth={2} />
            )}
          </button>
        </div>

        {/* Footer Mock */}
        <div className="z-10 flex flex-col gap-3">
          <button className="w-full h-12 bg-[#1db954] text-black font-bold rounded-2xl flex items-center justify-center gap-2 hover:brightness-110">
            <span className="w-2 h-2 rounded-full bg-black/50" />
            Open in Spotify
          </button>
          <div className="flex gap-3">
            <button className="flex-1 h-14 bg-white/5 border border-white/10 rounded-2xl font-semibold text-gray-300">👎 Pass</button>
            <button 
              onClick={() => setSavedOption1(!savedOption1)}
              className="flex-[1.5] h-14 bg-white/5 border border-white/10 rounded-2xl font-bold flex items-center justify-center transition-colors"
              style={savedOption1 ? { color: '#888' } : { color: '#fff' }}
            >
              {savedOption1 ? "✓ Bookmarked" : "🔖 Bookmark in Flipside"}
            </button>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      {/* OPTION 2 */}
      <section className="w-full max-w-md bg-[#121212] p-5 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden flex flex-col gap-6">
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ background: 'radial-gradient(circle at top left, rgba(139,92,246,0.1), transparent 70%)' }} />
        
        <div className="z-10 bg-black/40 rounded-lg py-1 px-4 mb-2 max-w-max text-xs font-bold uppercase tracking-wider text-purple-400 border border-purple-500/20">
          Option 2: The Explicit Badges
        </div>

        {/* Track Mock */}
        <div className="z-10 flex items-center justify-between p-3 rounded-2xl bg-white/5 border-l-[3px]" style={{ borderColor: mockArtistColor }}>
          <div className="flex flex-col">
            <span className="font-bold text-[15px]">Neon Glow</span>
            <span className="text-[13px] text-gray-400">FM-84</span>
          </div>
          <button 
            onClick={() => setLikedOption2(!likedOption2)}
            className={`px-4 h-9 rounded-full flex items-center gap-2 transition-all font-semibold text-[13px] ${likedOption2 ? 'bg-[#1db954]/20 text-[#1db954]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
          >
            {likedOption2 ? <Check size={14} strokeWidth={3}/> : <Heart size={14} />}
            {likedOption2 ? "Saved" : "Spotify"}
          </button>
        </div>

        {/* Footer Mock */}
        <div className="z-10 flex flex-col gap-3">
          <button className="w-full h-12 bg-[#1db954] text-black font-bold rounded-2xl flex items-center justify-center gap-2 hover:brightness-110">
             <span className="w-2 h-2 rounded-full bg-black/50" />
            Open in Spotify
          </button>
          <div className="flex gap-3">
            <button className="flex-1 h-14 bg-white/5 border border-white/10 rounded-2xl font-semibold text-gray-300">👎 Pass</button>
            <button 
              onClick={() => setSavedOption2(!savedOption2)}
              className="flex-[1.5] h-14 bg-white/5 border border-white/10 rounded-2xl font-bold flex items-center justify-center transition-colors text-white"
              style={savedOption2 ? { color: '#888' } : { color: '#fff' }}
            >
              {savedOption2 ? "✓ Kept" : "+ Keep in Flipside"}
            </button>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      {/* OPTION 3 */}
      <section className="w-full max-w-md bg-[#121212] p-5 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden flex flex-col gap-6">
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ background: 'radial-gradient(circle at top left, rgba(139,92,246,0.1), transparent 70%)' }} />
        
        <div className="z-10 bg-black/40 rounded-lg py-1 px-4 mb-2 max-w-max text-xs font-bold uppercase tracking-wider text-purple-400 border border-purple-500/20">
          Option 3: The Subtle Muted Aura
        </div>

        {/* Track Mock */}
        <div className="z-10 flex items-center justify-between p-3 rounded-2xl bg-white/5 border-l-[3px]" style={{ borderColor: mockArtistColor }}>
          <div className="flex flex-col">
            <span className="font-bold text-[15px]">Out of Time</span>
            <span className="text-[13px] text-gray-400">The Weeknd</span>
          </div>
          <button 
            onClick={() => setLikedOption3(!likedOption3)}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white/5 hover:bg-white/10"
          >
            {likedOption3 ? (
              <Check size={18} className="text-[#1db954]" strokeWidth={3} />
            ) : (
              <Plus size={18} className="text-gray-400" strokeWidth={2.5} />
            )}
          </button>
        </div>

        {/* Footer Mock */}
        <div className="z-10 flex flex-col gap-3">
          <button className="w-full h-12 bg-[#1db954] text-black font-bold rounded-2xl flex items-center justify-center gap-2 hover:brightness-110">
             <span className="w-2 h-2 rounded-full bg-black/50" />
            Open in Spotify
          </button>
          <div className="flex gap-3">
            <button className="flex-1 h-14 bg-white/5 border border-white/10 rounded-2xl font-semibold text-gray-300">👎 Pass</button>
            <button 
              onClick={() => setSavedOption3(!savedOption3)}
              className="flex-[1.5] h-14 font-bold flex items-center justify-center transition-all border rounded-2xl text-white outline-none"
              style={{
                backgroundColor: savedOption3 ? 'rgba(255,255,255,0.05)' : 'rgba(139,92,246,0.15)', // Muted 15% opacity of artistColor
                borderColor: savedOption3 ? 'rgba(255,255,255,0.1)' : 'rgba(139,92,246,0.3)', // Outline artistColor
                color: savedOption3 ? '#888' : '#fff'
              }}
            >
              {savedOption3 ? "✓ Added" : "+ Add to Flipside"}
            </button>
          </div>
        </div>
      </section>

    </div>
  )
}
