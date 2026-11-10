import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

let pathname = "/feed"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }))

import { AppShell } from "./app-shell"

function render(path: string) {
  pathname = path
  return renderToString(
    <AppShell userSeed="seed" initialAdventurous={false}>
      <p>page body</p>
    </AppShell>,
  )
}

/** Inner HTML of the element whose opening tag contains `marker`. */
function block(html: string, marker: string, tag: string) {
  const start = html.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf(`</${tag}>`, start))
}

const LINK = /<a[^>]*>/g

describe("AppShell server render", () => {
  it("rail lists all six sections and marks only the current one", () => {
    const rail = block(render("/history/older"), 'class="shell-nav"', "nav")
    for (const s of ["Feed", "Explore", "History", "Saved", "Stats", "Settings"]) expect(rail).toContain(`>${s}<`)
    const links = rail.match(LINK) ?? []
    expect(links).toHaveLength(6)
    const current = links.filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('href="/history"')
  })

  it("tab bar has five items without Settings, current one marked", () => {
    const tabs = block(render("/saved"), 'class="shell-tabs"', "nav")
    const links = tabs.match(LINK) ?? []
    expect(links).toHaveLength(5)
    expect(tabs).not.toContain("Settings")
    expect(links.filter((a) => a.includes('aria-current="page"'))).toEqual([expect.stringContaining('href="/saved"')])
  })

  it("pathPrefix (dev preview) is stripped before matching the current section", () => {
    pathname = "/dev-preview/feed"
    const html = renderToString(
      <AppShell userSeed="seed" initialAdventurous={false} pathPrefix="/dev-preview"><p /></AppShell>,
    )
    const current = (block(html, 'class="shell-nav"', "nav").match(LINK) ?? []).filter((a) => a.includes('aria-current="page"'))
    expect(current).toEqual([expect.stringContaining('href="/feed"')])
  })

  it("does not mark a section whose path is only a prefix match", () => {
    const html = render("/feedback")
    expect(html).not.toContain('aria-current="page"')
  })

  it("avatar is a closed menu button (no Popover API); page content renders in main", () => {
    const html = render("/settings")
    const avatar = html.match(/<button[^>]*class="shell-avatar"[^>]*>/)?.[0] ?? ""
    expect(avatar).toContain('aria-haspopup="menu"')
    expect(avatar).toContain('aria-expanded="false"')
    expect(avatar).toContain('aria-label="Account and settings"')
    expect(html).not.toMatch(/popover/i)
    // The menu (Settings, Sign out) is rendered only while open.
    expect(html).not.toContain('id="shell-menu"')
    expect(html).not.toContain("Sign out")
    expect(block(html, 'class="shell-main"', "main")).toContain("page body")
  })
})
