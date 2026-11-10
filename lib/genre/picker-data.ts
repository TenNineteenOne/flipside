import type { GenreNode } from '@/lib/types'

/**
 * The genre tree as the onboarding / Settings genre picker needs it: every node's id, label,
 * lastfmTag and children, plus leaf x/y (createGenreGraph's "close" adjacency). Drops parentId,
 * color, fontSize and exemplar, which no client code reads. Written to data/genres-picker.json by
 * `npm run build:genres-picker`; a test keeps that file equal to this function's output.
 */
export function slimGenreTree(nodes: GenreNode[]): GenreNode[] {
  return nodes.map((n) => {
    const out: GenreNode = { id: n.id, label: n.label, lastfmTag: n.lastfmTag, children: slimGenreTree(n.children) }
    if (n.x !== undefined) out.x = n.x
    if (n.y !== undefined) out.y = n.y
    return out
  })
}
