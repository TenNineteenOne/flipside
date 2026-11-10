import { ShellDemo } from "./shell-demo"

const PARAGRAPHS = Array.from({ length: 14 }, (_, i) => i + 1)

export default function ShellPreview() {
  return (
    <>
      <ShellDemo />
      <div className="page-head">
        <h1>Shell</h1>
        <span className="sub">preview</span>
      </div>
      <p id="first-line">First line of content: it must sit fully below the top bar.</p>
      {PARAGRAPHS.map((n) => (
        <p key={n} style={{ margin: "16px 0", color: "var(--fg-2)", lineHeight: 1.6 }}>
          Filler paragraph {n}. Flipside finds artists you have never heard and plays a preview in one tap.
          This text exists only to make the page tall enough to scroll, so the end of the page can be checked
          against the tab bar and the top bar at every breakpoint.
        </p>
      ))}
      <p id="last-line" style={{ fontWeight: 600 }}>Last line of content: it must sit fully above the tab bar.</p>
    </>
  )
}
