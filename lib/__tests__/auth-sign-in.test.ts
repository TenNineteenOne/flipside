import { describe, it, expect, vi } from "vitest"
import {
  normalizeUsername,
  parseSignInMode,
  resolveSignIn,
  type UserStore,
} from "../auth-sign-in"

function store(
  existing: Record<string, string>,
  createResult: Awaited<ReturnType<UserStore["create"]>> = { id: "new-id" },
) {
  return {
    findIdByHash: vi.fn(async (hash: string) => existing[hash] ?? null),
    create: vi.fn(async () => createResult),
  }
}

describe("resolveSignIn — existing account", () => {
  it("signs in a known username", async () => {
    const s = store({ h1: "u1" })
    expect(await resolveSignIn("existing", "h1", s)).toEqual({ id: "u1" })
    expect(s.create).not.toHaveBeenCalled()
  })

  it("fails generically for an unknown username and never creates one", async () => {
    const s = store({})
    expect(await resolveSignIn("existing", "nope", s)).toEqual({ error: "failed" })
    expect(s.create).not.toHaveBeenCalled()
  })
})

describe("resolveSignIn — new account", () => {
  it("creates the account when the username is free", async () => {
    const s = store({})
    expect(await resolveSignIn("new", "h1", s)).toEqual({ id: "new-id" })
    expect(s.create).toHaveBeenCalledWith("h1")
  })

  it("refuses a taken username without signing into it", async () => {
    const s = store({ h1: "u1" })
    expect(await resolveSignIn("new", "h1", s)).toEqual({ error: "taken" })
    expect(s.create).not.toHaveBeenCalled()
  })

  it("reports taken when a concurrent create wins the unique index", async () => {
    expect(await resolveSignIn("new", "h1", store({}, { taken: true }))).toEqual({ error: "taken" })
  })

  it("fails generically when the insert fails", async () => {
    expect(await resolveSignIn("new", "h1", store({}, null))).toEqual({ error: "failed" })
  })
})

describe("parseSignInMode", () => {
  it("only 'new' selects new; anything else (incl. missing) is existing", () => {
    expect(parseSignInMode("new")).toBe("new")
    expect(parseSignInMode("existing")).toBe("existing")
    expect(parseSignInMode(undefined)).toBe("existing")
    expect(parseSignInMode("NEW")).toBe("existing")
  })
})

describe("normalizeUsername", () => {
  it("trims and lowercases valid names", () => {
    expect(normalizeUsername("  Nick.B_1-x ")).toBe("nick.b_1-x")
  })

  it("enforces 2–30 chars of [a-z0-9._-]", () => {
    expect(normalizeUsername("a")).toBeNull()
    expect(normalizeUsername("a".repeat(31))).toBeNull()
    expect(normalizeUsername("a".repeat(30))).toBe("a".repeat(30))
    expect(normalizeUsername("bad name")).toBeNull()
    expect(normalizeUsername("emoji🙂")).toBeNull()
    expect(normalizeUsername(undefined)).toBeNull()
    expect(normalizeUsername(42)).toBeNull()
  })
})
