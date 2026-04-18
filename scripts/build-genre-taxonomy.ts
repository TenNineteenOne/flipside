import { writeFileSync } from 'fs'
import { join } from 'path'

interface GenreNode {
  id: string
  label: string
  lastfmTag: string
  parentId: string | null
  children: GenreNode[]
}

interface SparqlBinding {
  genre: { value: string }
  genreLabel: { value: string }
  parent?: { value: string }
  parentLabel?: { value: string }
}

interface SparqlResult {
  results: {
    bindings: SparqlBinding[]
  }
}

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

const SPARQL_QUERY = `
SELECT ?genre ?genreLabel ?parent ?parentLabel WHERE {
  ?genre wdt:P31 wd:Q188451.
  OPTIONAL { ?genre wdt:P279 ?parent. ?parent wdt:P31 wd:Q188451. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 500
`

function extractQid(uri: string): string {
  return uri.replace('http://www.wikidata.org/entity/', '')
}

function toLastfmTag(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-')
}

const FALLBACK_NODES: GenreNode[] = [
  { id: 'Q11399',   label: 'Jazz',         lastfmTag: 'jazz',         parentId: null, children: [] },
  { id: 'Q11366',   label: 'Rock',         lastfmTag: 'rock',         parentId: null, children: [] },
  { id: 'Q9778',    label: 'Electronic',   lastfmTag: 'electronic',   parentId: null, children: [] },
  { id: 'Q11401',   label: 'Hip-Hop',      lastfmTag: 'hip-hop',      parentId: null, children: [] },
  { id: 'Q41057',   label: 'Folk',         lastfmTag: 'folk',         parentId: null, children: [] },
  { id: 'Q38848',   label: 'Metal',        lastfmTag: 'metal',        parentId: null, children: [] },
  { id: 'Q9734',    label: 'Classical',    lastfmTag: 'classical',    parentId: null, children: [] },
  { id: 'Q8341',    label: 'World',        lastfmTag: 'world',        parentId: null, children: [] },
  { id: 'Q1191489', label: 'Experimental', lastfmTag: 'experimental', parentId: null, children: [] },
]

async function fetchGenres(): Promise<GenreNode[]> {
  const url = new URL(SPARQL_ENDPOINT)
  url.searchParams.set('query', SPARQL_QUERY)
  url.searchParams.set('format', 'json')

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'FlipsideGenreTaxonomy/1.0 (https://github.com/flipside)',
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(`Wikidata SPARQL returned ${response.status}: ${response.statusText}`)
  }

  const data = (await response.json()) as SparqlResult
  const bindings = data.results.bindings

  // Build flat map
  const map = new Map<string, GenreNode>()
  for (const binding of bindings) {
    const id = extractQid(binding.genre.value)
    const label = binding.genreLabel.value
    if (!map.has(id)) {
      map.set(id, {
        id,
        label,
        lastfmTag: toLastfmTag(label),
        parentId: null,
        children: [],
      })
    }
    // Set parentId if present
    if (binding.parent) {
      const node = map.get(id)!
      node.parentId = extractQid(binding.parent.value)
    }
  }

  // Link children to parents, collect roots
  const roots: GenreNode[] = []
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      node.parentId = null
      roots.push(node)
    }
  }

  return roots
}

async function main() {
  const outputPath = join(process.cwd(), 'data', 'genres.json')
  let nodes: GenreNode[]
  let source: string

  try {
    console.log('Fetching genre taxonomy from Wikidata SPARQL...')
    nodes = await fetchGenres()
    source = 'wikidata'
    console.log(`Fetched ${nodes.length} root genre nodes from Wikidata.`)
  } catch (err) {
    console.warn('Wikidata unreachable or returned an error — using fallback genres.')
    console.warn(err instanceof Error ? err.message : String(err))
    nodes = FALLBACK_NODES
    source = 'fallback'
  }

  const output = {
    generated: new Date().toISOString(),
    source,
    nodes,
  }

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`Wrote ${outputPath}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
