import type { GenreNode } from '@/lib/types'

/**
 * The genre tree as the onboarding / Settings genre picker needs it: every node's id, label,
 * lastfmTag and children, plus leaf x/y (createGenreGraph's "close" adjacency). Drops parentId,
 * color, fontSize and exemplar, which no client code reads.
 */
export function slimGenreTree(nodes: GenreNode[]): GenreNode[] {
  return nodes.map((n) => {
    const out: GenreNode = { id: n.id, label: n.label, lastfmTag: n.lastfmTag, children: slimGenreTree(n.children) }
    if (n.x !== undefined) out.x = n.x
    if (n.y !== undefined) out.y = n.y
    return out
  })
}

/**
 * data/genres-picker.json is slimGenreTree's output in a compact, lossless encoding (written by
 * `npm run build:genres-picker`; a test keeps it in sync and checks the round trip):
 *   - a leaf (no children, id "sp:" + lastfmTag, x and y set) is its lastfmTag, or
 *     [lastfmTag, label] when the label is not the tag with "-" as spaces;
 *   - any other node is [id, label, lastfmTag, children];
 *   - leaf x and y sit in the `x` / `y` arrays in depth-first order (columns gzip better).
 */
type EncodedNode = string | [string, string] | [string, string, string, EncodedNode[]]
export interface PickerData { t: EncodedNode[]; x: number[]; y: number[] }

const tagLabel = (tag: string) => tag.replace(/-/g, ' ')

export function encodePickerTree(nodes: GenreNode[]): PickerData {
  const x: number[] = []
  const y: number[] = []
  const enc = (n: GenreNode): EncodedNode => {
    if (!n.children.length && n.id === `sp:${n.lastfmTag}` && n.x !== undefined && n.y !== undefined) {
      x.push(n.x)
      y.push(n.y)
      return n.label === tagLabel(n.lastfmTag) ? n.lastfmTag : [n.lastfmTag, n.label]
    }
    if (n.x !== undefined || n.y !== undefined) throw new Error(`picker encoding has no x/y for non-leaf ${n.id}`)
    return [n.id, n.label, n.lastfmTag, n.children.map(enc)]
  }
  return { t: nodes.map(enc), x, y }
}

export function decodePickerTree(data: PickerData): GenreNode[] {
  let i = 0
  const dec = (e: EncodedNode): GenreNode => {
    if (typeof e === 'string' || e.length === 2) {
      const [tag, label] = typeof e === 'string' ? [e, tagLabel(e)] : e
      const node: GenreNode = { id: `sp:${tag}`, label, lastfmTag: tag, children: [], x: data.x[i], y: data.y[i] }
      i++
      return node
    }
    return { id: e[0], label: e[1], lastfmTag: e[2], children: e[3].map(dec) }
  }
  return data.t.map(dec)
}
