import { signOut } from "@/lib/auth"
import { enforceSameOrigin } from "@/lib/csrf"

export async function POST(req: Request) {
  // Same-origin guard: prevents logout-CSRF (an external page auto-submitting a
  // POST here to force-log-out a signed-in user). Matches every other mutating
  // route; this one is excluded from the proxy auth gate (/api/auth/*) so the
  // check must be inline.
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked

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
