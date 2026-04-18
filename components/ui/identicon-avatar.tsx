import React from "react"

// Deterministic 5×5 symmetric identicon seeded from a string (user UUID)
interface IdenticonAvatarProps {
  seed: string
  size?: number
}

export function IdenticonAvatar({ seed = "user", size = 40 }: IdenticonAvatarProps) {
  // Hash the seed to a number
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = seed.charCodeAt(i) + ((h << 5) - h)
  }
  const hue = Math.abs(h) % 360

  // Build 5×5 symmetric grid (only need to compute left half + center)
  const rects: Array<React.ReactElement> = []
  let r = Math.abs(h)
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      r = (r * 1103515245 + 12345) & 0x7fffffff
      if ((r & 1) === 1) {
        rects.push(
          <rect key={`${x}-${y}`} x={x * 20} y={y * 20} width="20" height="20" />
        )
        if (x < 2) {
          rects.push(
            <rect key={`${4 - x}-${y}`} x={(4 - x) * 20} y={y * 20} width="20" height="20" />
          )
        }
      }
    }
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: `hsl(${(hue + 30) % 360} 18% 14%)`,
        border: "1px solid var(--border-strong)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.7}
        height={size * 0.7}
        viewBox="0 0 100 100"
        style={{ color: `hsl(${hue} 70% 65%)`, fill: "currentColor" }}
      >
        {rects}
      </svg>
    </div>
  )
}
