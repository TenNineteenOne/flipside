/**
 * The `artists.name_lower` column value. Exactly `name.toLowerCase()` — existing
 * rows were written this way and there is no backfill, so the DB key must never
 * change. Use it ONLY for reading/writing `name_lower`; in-code name
 * comparisons use `artistNameKey`.
 */
export function artistNameDbKey(name: string): string {
  return name.toLowerCase()
}
