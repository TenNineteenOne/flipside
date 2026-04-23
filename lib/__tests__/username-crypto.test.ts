import { describe, it, expect, beforeEach } from "vitest"
import { randomBytes } from "node:crypto"
import {
  encryptUsername,
  decryptUsername,
  isEncrypted,
  resetKeyCacheForTests,
} from "../crypto/username"

function setKey(bytes = 32): string {
  const key = randomBytes(bytes).toString("base64")
  process.env.USERNAME_ENCRYPTION_KEY = key
  resetKeyCacheForTests()
  return key
}

describe("username crypto", () => {
  beforeEach(() => {
    setKey()
  })

  it("round-trips plaintext through encrypt/decrypt", () => {
    const plain = "flux_listener"
    const ct = encryptUsername(plain)
    expect(ct).not.toBeNull()
    expect(ct!.startsWith("enc:v1:")).toBe(true)
    expect(ct).not.toContain(plain)
    expect(decryptUsername(ct)).toBe(plain)
  })

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encryptUsername("same-user")
    const b = encryptUsername("same-user")
    expect(a).not.toBe(b)
  })

  it("is idempotent: encrypting already-encrypted value returns it unchanged", () => {
    const once = encryptUsername("already-enc")
    const twice = encryptUsername(once)
    expect(twice).toBe(once)
  })

  it("passes plaintext through decrypt unchanged (dual-read behavior)", () => {
    expect(decryptUsername("plaintext-user")).toBe("plaintext-user")
    expect(isEncrypted("plaintext-user")).toBe(false)
  })

  it("returns null for null/empty values on both sides", () => {
    expect(encryptUsername(null)).toBeNull()
    expect(encryptUsername(undefined)).toBeNull()
    expect(encryptUsername("")).toBeNull()
    expect(decryptUsername(null)).toBeNull()
    expect(decryptUsername(undefined)).toBeNull()
    expect(decryptUsername("")).toBeNull()
  })

  it("throws on tampered ciphertext", () => {
    const ct = encryptUsername("tamper-me")!
    const bad = ct.slice(0, -2) + (ct.endsWith("=") ? "Aa" : "==")
    expect(() => decryptUsername(bad)).toThrow()
  })

  it("throws on wrong key", () => {
    const ct = encryptUsername("rotate-me")!
    setKey()
    expect(() => decryptUsername(ct)).toThrow()
  })

  it("throws when key is missing on first use", () => {
    delete process.env.USERNAME_ENCRYPTION_KEY
    resetKeyCacheForTests()
    expect(() => encryptUsername("x")).toThrow(/USERNAME_ENCRYPTION_KEY/)
  })

  it("throws when key is not 32 bytes decoded", () => {
    process.env.USERNAME_ENCRYPTION_KEY = randomBytes(16).toString("base64")
    resetKeyCacheForTests()
    expect(() => encryptUsername("x")).toThrow(/32 bytes/)
  })
})
