import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const PREFIX = "enc:v1:"
const ALGO = "aes-256-gcm"
const IV_BYTES = 12
const KEY_BYTES = 32
const TAG_BYTES = 16

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.USERNAME_ENCRYPTION_KEY
  if (!raw) {
    throw new Error("USERNAME_ENCRYPTION_KEY is not set")
  }
  const key = Buffer.from(raw, "base64")
  if (key.length !== KEY_BYTES) {
    throw new Error(`USERNAME_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`)
  }
  cachedKey = key
  return key
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function encryptUsername(plain: string | null | undefined): string | null {
  if (plain == null) return null
  if (plain === "") return null
  if (isEncrypted(plain)) return plain

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, ct, tag]).toString("base64")
}

export function decryptUsername(stored: string | null | undefined): string | null {
  if (stored == null) return null
  if (stored === "") return null
  if (!isEncrypted(stored)) return stored

  const payload = Buffer.from(stored.slice(PREFIX.length), "base64")
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted username payload is too short")
  }
  const iv = payload.subarray(0, IV_BYTES)
  const tag = payload.subarray(payload.length - TAG_BYTES)
  const ct = payload.subarray(IV_BYTES, payload.length - TAG_BYTES)

  const decipher = createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ct), decipher.final()])
  return plain.toString("utf8")
}

export function resetKeyCacheForTests(): void {
  cachedKey = null
}
