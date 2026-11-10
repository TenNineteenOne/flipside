// Client JS per page route after `next build` (Next 16 with Turbopack prints no First Load JS sizes).
// A route's first load = build-manifest rootMainFiles + every entryJSFiles list in the route's
// page_client-reference-manifest (layouts, error boundaries, loading and the page itself).
// The 15 largest client chunks are listed too; their contents (top packages / source files) come
// from the Turbopack bundle analyzer when `npx next analyze --output` has been run after the build.
//
// Usage: npx next build && npx next analyze --output && npm run measure:bundle
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

const NEXT = ".next"
const ROUTES = {
  "/": "page",
  "/sign-in": "(marketing)/sign-in/page",
  "/onboarding": "(marketing)/onboarding/page",
  "/feed": "(app)/feed/page",
  "/explore": "(app)/explore/page",
  "/history": "(app)/history/page",
  "/saved": "(app)/saved/page",
  "/stats": "(app)/stats/page",
  "/settings": "(app)/settings/page",
}

if (!existsSync(join(NEXT, "build-manifest.json"))) {
  console.error("No .next/build-manifest.json: run `npx next build` first.")
  process.exit(1)
}

const sizes = new Map()
function size(file) {
  if (!sizes.has(file)) {
    const buf = readFileSync(join(NEXT, file))
    sizes.set(file, { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length })
  }
  return sizes.get(file)
}
const kB = (n) => (n / 1000).toFixed(1).padStart(7) + " kB"

const rootMain = JSON.parse(readFileSync(join(NEXT, "build-manifest.json"), "utf8")).rootMainFiles

function routeFiles(entry) {
  const src = readFileSync(join(NEXT, "server/app", `${entry}_client-reference-manifest.js`), "utf8")
  const sandbox = { globalThis: { __RSC_MANIFEST: {} } }
  new Function("globalThis", src)(sandbox.globalThis)
  const manifest = Object.values(sandbox.globalThis.__RSC_MANIFEST)[0]
  const files = new Set(rootMain)
  for (const list of Object.values(manifest.entryJSFiles)) for (const f of list) files.add(f)
  return [...files]
}

console.log("Route        files        raw       gzip")
const usedBy = new Map()
for (const [route, entry] of Object.entries(ROUTES)) {
  const files = routeFiles(entry)
  let raw = 0, gz = 0
  for (const f of files) {
    const s = size(f)
    raw += s.raw
    gz += s.gzip
    usedBy.set(f, [...(usedBy.get(f) ?? []), route])
  }
  console.log(`${route.padEnd(12)} ${String(files.length).padStart(5)} ${kB(raw)} ${kB(gz)}`)
}

const chunks = readdirSync(join(NEXT, "static/chunks"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => `static/chunks/${f}`)
  .map((f) => ({ f, ...size(f) }))
  .sort((a, b) => b.gzip - a.gzip)
  .slice(0, 15)
console.log("\n15 largest client chunks of this build (gzip, raw, page routes that load it first)")
for (const c of chunks) {
  const routes = usedBy.get(c.f)
  console.log(`${c.f.replace("static/chunks/", "").padEnd(20)} ${kB(c.gzip)} ${kB(c.raw)}  ${routes ? routes.join(" ") : "(not on a first load: lazy or polyfill)"}`)
}

// Chunk contents come from the bundle analyzer, which compiles its own copy of the client graph:
// its chunk names differ from the build's, so its chunks are listed by their own names and contents.
if (!existsSync(join(NEXT, "diagnostics/analyze/data"))) {
  console.log("\n(run `npx next analyze --output` after the build to list chunk contents)")
  process.exit(0)
}
const out = execFileSync(join("node_modules", ".bin", "next"), ["analyze", "export"], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "inherit"] })
const ana = new Map() // chunk -> { routes, sources: Map(source -> {size, gz}) }
for (const line of out.split("\n")) {
  if (!line.startsWith('{"type":"part"')) continue
  const p = JSON.parse(line)
  const chunk = p.filename.match(/^\[client-fs\]\/_next\/static\/chunks\/(.+\.js)$/)?.[1]
  if (!chunk) continue
  const c = ana.get(chunk) ?? { routes: new Set(), sources: new Map() }
  if (p.route in ROUTES) c.routes.add(p.route)
  // A part repeats once per route that loads the chunk: keep one.
  const src = p.source_path.replace(/^\[project\]\//, "")
  const pkg = src.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] ?? src
  if (!c.sources.has(src)) c.sources.set(src, { pkg, size: p.size, gz: p.compressed_size })
  ana.set(chunk, c)
}
const ranked = [...ana].map(([name, c]) => {
  const byPkg = new Map()
  let raw = 0, gz = 0
  for (const s of c.sources.values()) {
    raw += s.size
    gz += s.gz
    byPkg.set(s.pkg, (byPkg.get(s.pkg) ?? 0) + s.gz)
  }
  return { name, raw, gz, byPkg, routes: [...c.routes] }
}).sort((a, b) => b.gz - a.gz).slice(0, 15)
console.log("\n15 largest client chunks in the analyzer graph (module gzip sum, raw) with their biggest contents")
for (const c of ranked) {
  console.log(`${c.name.padEnd(28)} ${kB(c.gz)} ${kB(c.raw)}  ${c.routes.join(" ") || "(no page route)"}`)
  const top = [...c.byPkg].sort((a, b) => b[1] - a[1]).slice(0, 6)
  console.log("    " + top.map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}k`).join(", "))
}
