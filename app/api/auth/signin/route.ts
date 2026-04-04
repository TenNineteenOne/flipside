import { signIn } from "@/lib/auth"

export async function GET() {
  try {
    await signIn("spotify", { redirectTo: "/feed" })
  } catch (err: unknown) {
    // next/navigation redirect() throws an object with digest starting with "NEXT_REDIRECT"
    const digest = (err as { digest?: string })?.digest ?? ""
    if (digest.startsWith("NEXT_REDIRECT")) throw err
    console.error("[signin] unexpected error:", err)
    throw err
  }
}
