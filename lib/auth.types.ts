import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      spotifyId: string
      displayName: string
      avatarUrl: string | null
    } & DefaultSession["user"]
    error?: string
  }
}
