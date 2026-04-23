import { ImageResponse } from "next/og"

export const alt = "Flipside — music discovery, without the strings."
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 30% 40%, rgba(139,92,246,0.35), transparent 55%), #0a0a0a",
          padding: "80px 96px",
          color: "#f5f5f5",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            letterSpacing: "0.04em",
            color: "#e6e6e6",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: "#8b5cf6",
              boxShadow: "0 0 24px #8b5cf6",
            }}
          />
          flipside
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 44,
            fontSize: 108,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            fontWeight: 600,
            maxWidth: 980,
          }}
        >
          <span>Music discovery,</span>
          <span>without the strings.</span>
        </div>
        <div
          style={{
            marginTop: 32,
            fontSize: 28,
            color: "rgba(245,245,245,0.6)",
          }}
        >
          Find artists you&rsquo;ll love — on your terms.
        </div>
      </div>
    ),
    size
  )
}
