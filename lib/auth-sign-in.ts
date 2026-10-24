// Username sign-in decision logic, kept free of NextAuth / Supabase / crypto so
// it can be tested directly and imported by the client sign-in page.
//
// Two explicit modes (#175 D3): "existing" never creates an account, "new"
// never signs into one. Before this, every unknown username silently created
// a user, so guessing a friend's name was free and silent.

export type SignInMode = "existing" | "new"

/** Error codes surfaced to the client via `signIn(...).code`. */
export const SIGN_IN_CODES = {
  /** Generic failure. Deliberately the same for "no such user" and bad input. */
  failed: "credentials",
  taken: "username_taken",
  rateLimited: "rate_limited",
} as const

/** Unknown / missing mode falls back to "existing": never create by accident. */
export function parseSignInMode(raw: unknown): SignInMode {
  return raw === "new" ? "new" : "existing"
}

/** Trim + lowercase; null unless 2–30 chars of `[a-z0-9._-]`. */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const username = raw.trim().toLowerCase()
  if (username.length < 2 || username.length > 30) return null
  if (!/^[a-z0-9._-]+$/.test(username)) return null
  return username
}

export interface UserStore {
  findIdByHash(hash: string): Promise<string | null>
  /** Inserts a user. `taken` when the unique index on username_hash rejects it. */
  create(hash: string): Promise<{ id: string } | { taken: true } | null>
}

export type SignInResult = { id: string } | { error: "failed" | "taken" }

export async function resolveSignIn(
  mode: SignInMode,
  usernameHash: string,
  store: UserStore,
): Promise<SignInResult> {
  const existingId = await store.findIdByHash(usernameHash)

  if (mode === "existing") {
    return existingId ? { id: existingId } : { error: "failed" }
  }

  if (existingId) return { error: "taken" }
  const created = await store.create(usernameHash)
  if (!created) return { error: "failed" }
  // A concurrent "new" with the same name won the insert.
  if ("taken" in created) return { error: "taken" }
  return { id: created.id }
}
