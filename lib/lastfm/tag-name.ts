import pickerData from "@/data/genres-picker.json"
import { decodePickerTree, type PickerData } from "@/lib/genre/picker-data"
import type { GenreNode } from "@/lib/types"

/** Genre-tree leaf tag → the genre's own name. Built on first use. */
let leafNames: Map<string, string> | undefined

/**
 * A genre-tree tag's real name. Tags are slugs, so punctuation is gone and
 * every separator is a hyphen ("r-b", "punk-n-roll", "lo-fi-indie"); a leaf's
 * label keeps the name as written ("r&b", "punk 'n' roll", "lo-fi indie").
 * Any other tag (anchors, clusters, free text): hyphens as spaces.
 */
export function genreTagName(tag: string): string {
  if (!leafNames) {
    const names = new Map<string, string>()
    const walk = (n: GenreNode): void => {
      if (n.children.length) n.children.forEach(walk)
      else names.set(n.lastfmTag, n.label)
    }
    decodePickerTree(pickerData as PickerData).forEach(walk)
    leafNames = names
  }
  return leafNames.get(tag) ?? tag.replace(/-/g, " ")
}
