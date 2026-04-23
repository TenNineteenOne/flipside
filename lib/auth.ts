import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { createHmac } from "crypto"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import { isRateLimited } from "@/lib/rate-limiter"

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { username: { type: "text" } },
      async authorize(credentials, request) {
        // Rate limit by IP
        // Prefer x-real-ip (set by Vercel, not spoofable) over x-forwarded-for (client-controllable leftmost value)
        const headers = request?.headers as Headers | undefined
        const ip = headers?.get?.("x-real-ip")?.trim()
          ?? headers?.get?.("x-forwarded-for")?.split(",").pop()?.trim()
          ?? "unknown"
        if (await isRateLimited(ip)) return null

        const username = (credentials?.username as string | undefined)?.trim()?.toLowerCase()
        if (!username || username.length < 2 || username.length > 30) return null
        if (!/^[a-z0-9._-]+$/.test(username)) return null

        const secret = process.env.USERNAME_HMAC_SECRET
        if (!secret) {
          console.error("[auth] USERNAME_HMAC_SECRET is not set")
          return null
        }

        const hash = createHmac("sha256", secret).update(username).digest("hex")
        const supabase = createServiceClient()

        // Find existing user by hash
        const { data: existing } = await supabase
          .from("users")
          .select("id")
          .eq("username_hash", hash)
          .maybeSingle()

        if (existing) return { id: existing.id }

        // New user — create account
        const { data: created, error } = await supabase
          .from("users")
          .insert({ username_hash: hash })
          .select("id")
          .single()

        if (error || !created) {
          console.error("[auth] failed to create user:", error?.message)
          return null
        }

        return { id: created.id }
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
    console.warn("[auth] session decryption failed, clearing stale cookie:", (err as Error)?.message)
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
