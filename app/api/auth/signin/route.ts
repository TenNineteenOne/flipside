import { signIn } from "@/lib/auth"

export async function GET() {
  await signIn("spotify", { redirectTo: "/feed" })
}
