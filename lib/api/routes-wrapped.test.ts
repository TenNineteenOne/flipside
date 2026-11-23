/**
 * Guard rail: proxy.ts only checks for a session on /api/*; the same-origin
 * (CSRF) check lives in withAuthedCsrfRoute / withAuthedJsonRoute. Every
 * mutating handler must therefore be `export const POST = withAuthed…Route(`.
 * Checked on the source text, which is how every route is written.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const API_DIR = path.resolve(__dirname, "../../app/api")

// Routes whose mutating handlers legitimately skip the wrappers. The cron
// routes need no entry: they export GET only (bearer CRON_SECRET, withCronRoute).
const ALLOWLIST = new Set([
  // next-auth's own handlers; its POST actions verify next-auth's CSRF token.
  "auth/[...nextauth]/route.ts",
])

const WRAPPED = /^export const (POST|PATCH|PUT|DELETE) = withAuthed(Csrf|Json)Route\(/
const WRAPPER_IMPORT = /import \{[^}]*\} from "@\/lib\/api\/with-authed-route"/

/** Export lines that expose a mutating method without a CSRF-enforcing wrapper. */
function unwrappedMutations(source: string): string[] {
  const exports = source.split("\n").filter((l) => /^export\b.*\b(POST|PATCH|PUT|DELETE)\b/.test(l))
  // A local function named like a wrapper would pass the line check.
  if (exports.length > 0 && !WRAPPER_IMPORT.test(source)) return exports
  return exports.filter((l) => !WRAPPED.test(l))
}

describe("every mutating API handler is CSRF-wrapped", () => {
  const routes = (readdirSync(API_DIR, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => f.endsWith("/route.ts"))

  it("finds the routes, including the allowlisted ones", () => {
    expect(routes.length).toBeGreaterThan(10)
    for (const f of ALLOWLIST) expect(routes).toContain(f)
  })

  it.each(routes.filter((f) => !ALLOWLIST.has(f)))("%s", (file) => {
    expect(unwrappedMutations(readFileSync(path.join(API_DIR, file), "utf8"))).toEqual([])
  })

  it("the check catches unwrapped handlers", () => {
    const imp = 'import { withAuthedCsrfRoute, withAuthedRoute } from "@/lib/api/with-authed-route"\n'
    expect(unwrappedMutations(imp + "export const POST = withAuthedCsrfRoute(async () => new Response())")).toEqual([])
    expect(unwrappedMutations(imp + "export const GET = withAuthedRoute(async () => new Response())")).toEqual([])
    for (const bad of [
      "export async function POST() {}",
      "export function DELETE() {}",
      "export const PATCH = withAuthedRoute(async () => new Response())", // auth only, no CSRF
      "export const PUT = async () => new Response()",
      "export const { GET, POST } = handlers",
      "export { POST } from './other'",
    ]) {
      expect(unwrappedMutations(imp + bad)).toEqual([bad])
    }
    // Right shape, but the wrapper is not the real one.
    const local = "export const POST = withAuthedCsrfRoute(async () => new Response())"
    expect(unwrappedMutations(local)).toEqual([local])
  })
})
