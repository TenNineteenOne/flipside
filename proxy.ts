import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  const isProtectedPage = ["/feed", "/explore", "/settings", "/history", "/saved", "/stats", "/onboarding"].some((p) =>
    pathname.startsWith(p)
  )
  const isProtectedApi =
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") &&
    !pathname.startsWith("/api/cron/")

  // Redirect authenticated users away from the landing page and the sign-in
  // form (Back after signing in; "New account" must not silently switch
  // accounts). `?reauth=1` is the pages' escape hatch for a stale JWT whose
  // user row is gone — without it /feed → /sign-in → /feed would loop.
  if (
    session &&
    (pathname === "/" || (pathname === "/sign-in" && !req.nextUrl.searchParams.has("reauth")))
  ) {
    return NextResponse.redirect(new URL("/feed", req.url))
  }

  // Protect pages
  if (!session && isProtectedPage) {
    const from = encodeURIComponent(pathname)
    return NextResponse.redirect(new URL(`/?from=${from}`, req.url))
  }

  // Protect API routes
  if (!session && isProtectedApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
