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

/** The username rule, shown before submit in New mode (mirrors normalizeUsername). */
export const USERNAME_RULE = "2–30 characters: letters, numbers, dot, underscore, hyphen"

export const SIGN_IN_GENERIC_ERROR = "Something went wrong. Please try again."

/**
 * Client copy for a failed sign-in. "Existing" failures never reveal whether
 * the username exists (same text either way) but point at New account. "New"
 * must say a name is taken; that's the accepted trade-off (#175 D3).
 */
export function signInErrorMessage(mode: SignInMode, code: string | undefined): string {
  if (code === SIGN_IN_CODES.rateLimited) return "Too many attempts. Wait a minute and try again."
  if (code === SIGN_IN_CODES.taken) return "That username is taken. Pick another, or choose Existing account if it’s yours."
  if (code === SIGN_IN_CODES.failed && mode === "existing") return "Couldn’t sign in with that username. New here? Choose New account."
  return SIGN_IN_GENERIC_ERROR
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
