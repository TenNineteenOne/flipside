import "server-only"
import { createClient } from "@supabase/supabase-js";

// Service-role client: server-only, no user session (auth is NextAuth's job).
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
