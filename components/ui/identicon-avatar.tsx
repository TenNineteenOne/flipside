import { useMemo } from "react"
import { identiconSvg } from "@/lib/identicon"

interface IdenticonAvatarProps {
  seed: string
  size?: number
}

export function IdenticonAvatar({ seed = "user", size = 40 }: IdenticonAvatarProps) {
  const svg = useMemo(() => identiconSvg(seed, size), [seed, size])

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        border: "1px solid var(--border-strong)",
        flexShrink: 0,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
