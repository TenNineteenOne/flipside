import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { createHmac } from "crypto"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import { isRateLimited } from "@/lib/rate-limiter"
import {
  SIGN_IN_CODES,
  normalizeUsername,
  parseSignInMode,
  resolveSignIn,
  type UserStore,
} from "@/lib/auth-sign-in"

class UsernameTakenError extends CredentialsSignin {
  code = SIGN_IN_CODES.taken
}
class RateLimitedError extends CredentialsSignin {
  code = SIGN_IN_CODES.rateLimited
}

function supabaseUserStore(): UserStore {
  const supabase = createServiceClient()
  return {
    async findIdByHash(hash) {
      const { data, error } = await supabase
        .from("users")
        .select("id")
        .eq("username_hash", hash)
        .maybeSingle()
      if (error) throw new Error(`[auth] user lookup failed: ${error.message}`)
      return data?.id ?? null
    },
    async create(hash) {
      const { data, error } = await supabase
        .from("users")
        .insert({ username_hash: hash })
        .select("id")
        .single()
      if (error?.code === "23505") return { taken: true } // users_username_hash_key
      if (error || !data) {
        console.error("[auth] failed to create user:", error?.message)
        return null
      }
      return { id: data.id }
    },
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { username: { type: "text" }, mode: { type: "text" } },
      async authorize(credentials, request) {
        // Rate limit per IP, per IPv6 /64 and globally (lib/rate-limiter.ts).
        // Both modes count. Prefer x-real-ip (set by Vercel, not spoofable)
        // over x-forwarded-for (client-controllable leftmost value)
        const headers = request?.headers as Headers | undefined
        const ip = headers?.get?.("x-real-ip")?.trim()
          ?? headers?.get?.("x-forwarded-for")?.split(",").pop()?.trim()
          ?? "unknown"
        if (await isRateLimited(ip)) throw new RateLimitedError()

        const username = normalizeUsername(credentials?.username)
        if (!username) return null

        const secret = process.env.USERNAME_HMAC_SECRET
        if (!secret) {
          console.error("[auth] USERNAME_HMAC_SECRET is not set")
          return null
        }

        const hash = createHmac("sha256", secret).update(username).digest("hex")
        const result = await resolveSignIn(parseSignInMode(credentials?.mode), hash, supabaseUserStore())

        if ("id" in result) return { id: result.id }
        if (result.error === "taken") throw new UsernameTakenError()
        return null
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On first sign-in, user object is present — store the UUID
      if (user?.id) token.sub = user.id
      return token
    },
    async session({ session, token }) {
      session.user.id = token.sub as string
      return session
    },
  },
  pages: { signIn: "/sign-in" },
})

export async function safeAuth() {
  try {
    return await auth()
  } catch (err) {
    // Next.js control-flow errors must propagate untouched: DYNAMIC_SERVER_USAGE
    // is how a prerender marks the route dynamic (auth() reads headers), and
    // NEXT_* digests are redirects/notFound. Swallowing them here would let a
    // build statically render a page with a null session.
    const digest = (err as { digest?: string })?.digest
    const message = (err as Error)?.message ?? ""
    if (
      (typeof digest === "string" && (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_"))) ||
      message.startsWith("Dynamic server usage")
    ) {
      throw err
    }
    console.warn("[auth] session decryption failed, clearing stale cookie:", message)
    try {
      const store = await cookies()
      store.delete("authjs.session-token")
      store.delete("__Secure-authjs.session-token")
    } catch {
      // cookies() may be read-only in some contexts; best-effort cleanup
    }
    return null
  }
}
