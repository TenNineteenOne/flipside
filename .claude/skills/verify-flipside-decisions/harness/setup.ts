// Runs before each check file: the real routes and read functions get the
// SQL-backed client and a signed-in user. Nothing else is replaced.
import { vi } from "vitest"

vi.mock("@/lib/supabase/server", async () => ({
  createServiceClient: (await import("./supabase-pg")).createServiceClient,
}))
vi.mock("@/lib/auth", () => ({
  safeAuth: async () => ({ user: { id: "00000000-0000-4000-8000-000000000001" } }),
}))
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {}, dismiss: () => {} }) }))
