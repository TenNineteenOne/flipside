import { describe, it, expect } from "vitest"
import { artistNameKey, artistNameDbKey } from "./name-key"

/** The pre-#175 normalizer, kept here as the compatibility oracle for ASCII. */
const legacy = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, "").trim()

describe("artistNameKey", () => {
  it.each([
    ["AC/DC", "ACDC"],
    ["Guns N' Roses", "guns n roses"],
    ["  Radiohead ", "RADIOHEAD"],
    ["Sunn O)))", "sunn o"],
    ["Panic! at the Disco", "panic at the disco"],
    ["Mr. Bungle", "mr bungle"],
    ["MØ", "mø"],
  ])("ASCII-punctuation variants that matched before still match: %s ≡ %s", (a, b) => {
    expect(artistNameKey(a)).toBe(artistNameKey(b))
  })

  it.each([
    "AC/DC",
    "Guns N' Roses",
    "Simon & Garfunkel",
    "Simon and Garfunkel",
    "The  Double  Space",
    "  Leading/Trailing!  ",
    "under_score",
    "t.A.T.u.",
  ])("is identical to the legacy normalizer on ASCII names: %s", (name) => {
    expect(artistNameKey(name)).toBe(legacy(name))
  })

  it("invents no new equivalences: & vs and, and internal spacing, stay distinct", () => {
    expect(artistNameKey("Simon & Garfunkel")).not.toBe(artistNameKey("Simon and Garfunkel"))
    expect(artistNameKey("Simon & Garfunkel")).not.toBe(artistNameKey("Simon Garfunkel"))
  })

  it("keeps non-ASCII letters: distinct, non-empty keys", () => {
    const names = ["Björk", "Sigur Rós", "宇多田ヒカル", "Кино", "Beyoncé", "Bjrk", "Beyonc", "हनी सिंह"]
    const keys = names.map(artistNameKey)
    for (const k of keys) expect(k).not.toBe("")
    expect(new Set(keys).size).toBe(names.length)
    expect(artistNameKey("Björk")).toBe("björk")
    expect(artistNameKey("Кино")).toBe("кино")
  })

  it("all-CJK names no longer collapse onto one shared key", () => {
    expect(artistNameKey("宇多田ヒカル")).not.toBe(artistNameKey("椎名林檎"))
  })

  it("is NFKC-stable: composed and decomposed forms share a key", () => {
    expect(artistNameKey("Beyoncé")).toBe(artistNameKey("Beyoncé"))
  })

  it("never returns '' for a non-blank name (all-punctuation falls back to the folded name)", () => {
    expect(artistNameKey("!!!")).toBe("!!!")
    expect(artistNameKey("   ")).toBe("")
  })
})

describe("artistNameDbKey", () => {
  it("is exactly toLowerCase (the stored name_lower) — no stripping, no NFKC", () => {
    for (const n of ["AC/DC", "Björk", "宇多田ヒカル", "  Spaced  ", "Beyoncé"]) {
      expect(artistNameDbKey(n)).toBe(n.toLowerCase())
    }
  })
})
