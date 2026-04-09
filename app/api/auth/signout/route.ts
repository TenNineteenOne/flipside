import { signOut } from "@/lib/auth"

export async function POST() {
  try {
    await signOut({ redirectTo: "/" })
  } catch (err: unknown) {
    // next/navigation redirect() throws an object with digest starting with "NEXT_REDIRECT"
    const digest = (err as { digest?: string })?.digest ?? ""
    if (digest.startsWith("NEXT_REDIRECT")) throw err
    console.error("[signout] unexpected error:", err)
    throw err
  }
}
