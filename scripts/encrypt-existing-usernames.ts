/**
 * One-time backfill: encrypt plaintext `lastfm_username` and `statsfm_username`
 * columns on `users`. Idempotent — rows already prefixed `enc:v1:` are skipped.
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-usernames.ts           # full run
 *   npx tsx scripts/encrypt-existing-usernames.ts --dry-run # preview only
 *
 * Env (loaded from .env.local):
 *   USERNAME_ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { config as loadEnv } from "dotenv"
import { createClient } from "@supabase/supabase-js"
// `getKey()` inside ../lib/crypto/username reads USERNAME_ENCRYPTION_KEY lazily
// on first encrypt/decrypt, so hoisting this import above loadEnv() is fine —
// the env is populated before any crypto call runs.
import { encryptUsername, isEncrypted } from "../lib/crypto/username"

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
if (!process.env.USERNAME_ENCRYPTION_KEY) {
  console.error("Missing USERNAME_ENCRYPTION_KEY")
  process.exit(1)
}

const DRY_RUN = process.argv.includes("--dry-run")
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  const { data, error } = await supabase
    .from("users")
    .select("id, lastfm_username, statsfm_username")
    .or("lastfm_username.not.is.null,statsfm_username.not.is.null")

  if (error) {
    console.error(`Query failed: ${error.message}`)
    process.exit(1)
  }
  if (!data || data.length === 0) {
    console.log("No rows with usernames to encrypt.")
    return
  }

  let scanned = 0
  let lfmEncrypted = 0
  let lfmSkipped = 0
  let sfmEncrypted = 0
  let sfmSkipped = 0
  let errors = 0

  for (const row of data) {
    scanned++
    const update: Record<string, string | null> = {}

    if (row.lastfm_username) {
      if (isEncrypted(row.lastfm_username)) {
        lfmSkipped++
      } else {
        update.lastfm_username = encryptUsername(row.lastfm_username)
        lfmEncrypted++
      }
    }
    if (row.statsfm_username) {
      if (isEncrypted(row.statsfm_username)) {
        sfmSkipped++
      } else {
        update.statsfm_username = encryptUsername(row.statsfm_username)
        sfmEncrypted++
      }
    }

    if (Object.keys(update).length === 0) continue

    if (DRY_RUN) {
      console.log(`[dry-run] user=${row.id} would update ${Object.keys(update).join(",")}`)
      continue
    }

    const { error: updateError } = await supabase
      .from("users")
      .update(update)
      .eq("id", row.id)
    if (updateError) {
      console.error(`user=${row.id} update failed: ${updateError.message}`)
      errors++
    }
  }

  console.log("---")
  console.log(`Scanned:         ${scanned} rows`)
  console.log(`Last.fm encrypted: ${lfmEncrypted} (skipped already-encrypted: ${lfmSkipped})`)
  console.log(`stats.fm encrypted: ${sfmEncrypted} (skipped already-encrypted: ${sfmSkipped})`)
  console.log(`Errors:          ${errors}`)
  if (DRY_RUN) console.log("(dry-run — nothing was written)")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
