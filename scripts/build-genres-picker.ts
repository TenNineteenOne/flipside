#!/usr/bin/env tsx
/**
 * Writes data/genres-picker.json, the compact slim genre tree the client-side genre picker ships
 * (lib/genre/picker-data.ts), from data/genres.json. Rerun after regenerating genres.json;
 * lib/genre/picker-data.test.ts fails while the two are out of sync.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { encodePickerTree, slimGenreTree } from "../lib/genre/picker-data"

const full = JSON.parse(readFileSync(resolve("data/genres.json"), "utf8"))
writeFileSync(resolve("data/genres-picker.json"), JSON.stringify(encodePickerTree(slimGenreTree(full.nodes))) + "\n")
console.log("wrote data/genres-picker.json")
