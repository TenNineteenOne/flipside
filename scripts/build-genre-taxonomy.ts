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
}

interface SparqlResult {
  results: {
    bindings: SparqlBinding[]
  }
}

interface Anchor {
  id: string
  label: string
  lastfmTag: string
  match: (string | RegExp)[]
}

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

const SPARQL_QUERY = `
SELECT ?genre ?genreLabel WHERE {
  ?genre wdt:P31 wd:Q188451.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 1000
`

const ANCHORS: Anchor[] = [
  {
    id: 'ANCHOR_rock',
    label: 'Rock',
    lastfmTag: 'rock',
    match: [/\brock\b/i, /\bpunk\b/i, /\bshoegaze\b/i, /\bgrunge\b/i, /\bemo\b/i, /\bindie\b/i, /\bpost[- ]punk\b/i, /\bhardcore\b/i, /\bgarage\b/i, /\bpsychedelic\b/i, /\bscreamo\b/i, /\bsurf\b/i, /\brockabilly\b/i, /\bbritpop\b/i, /\balternative\b/i, /\bzamrock\b/i, /\bzeuhl\b/i, /\b2 tone\b/i, /\btwo[- ]tone\b/i, /\bbritish invasion\b/i, /\bvisual kei\b/i, /\bgoth\b/i, /\bprog\b/i, /\bmath rock\b/i],
  },
  {
    id: 'ANCHOR_pop',
    label: 'Pop',
    lastfmTag: 'pop',
    match: [/\bpop\b/i, /\bsynth[- ]?pop\b/i, /\bdream pop\b/i, /\bbubblegum\b/i, /\bj-pop\b/i, /\bk-pop\b/i, /\belectropop\b/i, /\bnew wave\b/i, /\bnew romantic\b/i, /\bteen pop\b/i, /\bcity pop\b/i, /\bhypnagogic\b/i],
  },
  {
    id: 'ANCHOR_hiphop',
    label: 'Hip-Hop',
    lastfmTag: 'hip-hop',
    match: [/\bhip[- ]?hop\b/i, /\brap\b/i, /\brapping\b/i, /\btrap\b/i, /\bdrill\b/i, /\bgrime\b/i, /\bboom bap\b/i, /\bcloud rap\b/i, /\bmumble\b/i, /\btrip hop\b/i],
  },
  {
    id: 'ANCHOR_rnb',
    label: 'R&B / Soul',
    lastfmTag: 'soul',
    match: [/\bsoul\b/i, /\brhythm and blues\b/i, /\br&b\b/i, /\bfunk\b/i, /\bmotown\b/i, /\bneo[- ]soul\b/i, /\bgospel\b/i, /\bdisco\b/i, /\bblues\b/i, /\bdoo[- ]wop\b/i, /\bnew jack swing\b/i, /\bquiet storm\b/i],
  },
  {
    id: 'ANCHOR_electronic',
    label: 'Electronic',
    lastfmTag: 'electronic',
    match: [/\belectronic\b/i, /\btechno\b/i, /\bhouse\b/i, /\btrance\b/i, /\bambient\b/i, /\bdrum and bass\b/i, /\bdubstep\b/i, /\bbrostep\b/i, /\bidm\b/i, /\belectro\b/i, /\bgarage\b/i, /\bbreakbeat\b/i, /\bchiptune\b/i, /\bsynthwave\b/i, /\bvaporwave\b/i, /\bedm\b/i, /\bjungle\b/i, /\bjump[- ]up\b/i, /\bmoombahton\b/i, /\bbass music\b/i, /\bbigroom\b/i, /\bhardstyle\b/i],
  },
  {
    id: 'ANCHOR_jazz',
    label: 'Jazz',
    lastfmTag: 'jazz',
    match: [/\bjazz\b/i, /\bbebop\b/i, /\bswing\b/i, /\bfusion\b/i, /\bdixieland\b/i, /\bragtime\b/i, /\bbossa\b/i, /\bhard bop\b/i, /\bstride piano\b/i, /\bcool\b/i, /\bpost[- ]bop\b/i, /\bsmooth jazz\b/i],
  },
  {
    id: 'ANCHOR_classical',
    label: 'Classical',
    lastfmTag: 'classical',
    match: [/\bclassical\b/i, /\bbaroque\b/i, /\bromantic\b/i, /\bsymphon/i, /\bopera\b/i, /\boratorio\b/i, /\bconcerto\b/i, /\bsonata\b/i, /\bchoral\b/i, /\bmedieval\b/i, /\brenaissance\b/i, /\bchamber\b/i, /\bancient music\b/i, /\bgregorian\b/i, /\bplainsong\b/i, /\bplainchant\b/i, /\bcavatina\b/i, /\bmadrigal\b/i, /\bhymn\b/i, /\bmotet\b/i, /\bcantata\b/i, /\brequiem\b/i, /\bfugue\b/i, /\betude\b/i, /\bprelude\b/i, /\bmass\b/i, /\bdhrupad\b/i, /\bkhyal\b/i, /\bars antiqua\b/i, /\bars nova\b/i, /\btoccata\b/i, /\bnocturne\b/i, /\bmazurka\b/i, /\bpavane\b/i, /\bthrenody\b/i, /\bfranco[- ]flemish\b/i, /\ba cappella\b/i, /\bvocal music\b/i, /\bwhite voice\b/i, /\blied\b/i, /\belegy\b/i, /\bscherzo\b/i, /\boverture\b/i, /\bberceuse\b/i, /\bcanzona\b/i, /\bétude\b/i, /\bsarabande\b/i, /\bpasodoble\b/i, /\bprogramme music\b/i, /\bmarch\b/i, /\batonal/i, /\bbel canto\b/i, /\bgalliard\b/i, /\bpolonaise\b/i, /\bmenuet\b/i, /\bminuet\b/i, /\bwaltz\b/i, /\bimpromptu\b/i, /\bfantasia\b/i, /\bstudy\b/i],
  },
  {
    id: 'ANCHOR_metal',
    label: 'Metal',
    lastfmTag: 'metal',
    match: [/\bmetal\b/i, /\bmetalcore\b/i, /\bthrash\b/i, /\bdeath\b/i, /\bblack metal\b/i, /\bdoom\b/i, /\bsludge\b/i, /\bgrindcore\b/i, /\bdeathcore\b/i, /\bmathcore\b/i, /\bpower metal\b/i, /\bviking\b/i, /\bpagan\b/i, /\bcrust\b/i],
  },
  {
    id: 'ANCHOR_folk',
    label: 'Folk',
    lastfmTag: 'folk',
    match: [/\bfolk\b/i, /\bacoustic\b/i, /\bbluegrass\b/i, /\bcelt/i, /\bballad\b/i, /\breel\b/i, /\bshanty\b/i, /\bsinger[- ]songwriter\b/i, /\bbagad\b/i, /\bbothy\b/i, /\bappalachian\b/i, /\bsea chant/i, /\blullaby\b/i, /\bskiffle\b/i, /\bdrinking song\b/i],
  },
  {
    id: 'ANCHOR_country',
    label: 'Country',
    lastfmTag: 'country',
    match: [/\bcountry\b/i, /\bhonky[- ]tonk\b/i, /\bwestern\b/i, /\balt[- ]country\b/i, /\bamericana\b/i, /\bouthwestern\b/i, /\bnashville\b/i, /\bbakersfield\b/i, /\boutlaw\b/i, /\btex[- ]mex\b/i, /\bbluegrass\b/i],
  },
  {
    id: 'ANCHOR_world',
    label: 'World',
    lastfmTag: 'world',
    match: [/\bworld\b/i, /\breggae\b/i, /\bska\b/i, /\bdub\b/i, /\bcumbia\b/i, /\bsalsa\b/i, /\bmerengue\b/i, /\btango\b/i, /\bsamba\b/i, /\bafrobeat\b/i, /\bhighlife\b/i, /\bigbo\b/i, /\bmbaqanga\b/i, /\bcuarteto\b/i, /\bzajal\b/i, /\bmantra\b/i, /\bthumri\b/i, /\btappa\b/i, /\bca trù\b/i, /\bukraine\b/i, /\baustrian\b/i, /\bfrench\b/i, /\barabic\b/i, /\blatin\b/i, /\breggaeton\b/i, /\bflamenco\b/i, /\bcarib/i, /\bbhangra\b/i, /\braga\b/i, /\bqawwali\b/i, /\brai\b/i, /\bfado\b/i, /\btarab\b/i, /\bsoukous\b/i, /\bgnawa\b/i, /\bbachata\b/i, /\bbatucada\b/i, /\bchoro\b/i, /\bmusic of\b/i, /\bconjunto\b/i, /\bpolyphony\b/i, /\bmusic from\b/i, /\btraditional\b/i, /\bklezmer\b/i, /\bjarocho\b/i, /\bforró\b/i, /\bpagode\b/i, /\bmpb\b/i, /\bsertanej/i, /\bchanson\b/i, /\benka\b/i, /\bj-rock\b/i, /\bgamelan\b/i, /\bmariachi\b/i, /\bnorteñ/i, /\bbanda\b/i, /\btex[- ]mex\b/i, /\bzouk\b/i, /\bkompa\b/i, /\bchalga\b/i, /\brebetiko\b/i, /\bturkish\b/i, /\bindonesian\b/i, /\bchinese\b/i, /\bgaelic\b/i, /\biranian\b/i, /\bafrican\b/i, /\basian\b/i],
  },
  {
    id: 'ANCHOR_experimental',
    label: 'Experimental',
    lastfmTag: 'experimental',
    match: [/\bexperimental\b/i, /\bnoise\b/i, /\bavant[- ]garde\b/i, /\bdrone\b/i, /\bmusique concr[èe]te\b/i, /\bsound art\b/i, /\bmusical\b/i, /\bacclamatio\b/i, /\bgstanzl\b/i, /\bmashup\b/i, /\bindependent music\b/i, /\bminimalist\b/i, /\bglitch\b/i, /\blowercase\b/i, /\bindustrial\b/i, /\bfilm score\b/i, /\bsoundtrack\b/i],
  },
]

const FALLBACK_CHILDREN: Record<string, string[]> = {
  ANCHOR_rock: ['indie rock', 'post-punk', 'shoegaze', 'garage rock', 'psychedelic rock'],
  ANCHOR_pop: ['synth-pop', 'dream pop', 'j-pop', 'k-pop', 'bubblegum pop'],
  ANCHOR_hiphop: ['boom bap', 'cloud rap', 'trap', 'drill', 'grime'],
  ANCHOR_rnb: ['neo-soul', 'funk', 'motown', 'gospel', 'disco'],
  ANCHOR_electronic: ['house', 'techno', 'ambient', 'drum and bass', 'dubstep'],
  ANCHOR_jazz: ['bebop', 'swing', 'fusion', 'bossa nova', 'ragtime'],
  ANCHOR_classical: ['baroque', 'romantic', 'opera', 'chamber music', 'medieval music'],
  ANCHOR_metal: ['thrash metal', 'death metal', 'black metal', 'doom metal', 'sludge metal'],
  ANCHOR_folk: ['bluegrass', 'celtic', 'acoustic', 'singer-songwriter', 'shanty'],
  ANCHOR_country: ['honky-tonk', 'alt-country', 'americana', 'western', 'outlaw country'],
  ANCHOR_world: ['reggae', 'salsa', 'afrobeat', 'flamenco', 'bhangra'],
  ANCHOR_experimental: ['noise', 'avant-garde', 'drone', 'sound art', 'musique concrète'],
}

function extractQid(uri: string): string {
  return uri.replace('http://www.wikidata.org/entity/', '')
}

function toLastfmTag(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function matchesAnchor(label: string, anchor: Anchor): boolean {
  for (const m of anchor.match) {
    if (typeof m === 'string') {
      if (label.toLowerCase().includes(m.toLowerCase())) return true
    } else if (m.test(label)) {
      return true
    }
  }
  return false
}

function assignAnchor(label: string): Anchor | null {
  for (const anchor of ANCHORS) {
    if (matchesAnchor(label, anchor)) return anchor
  }
  return null
}

interface RawGenre { id: string; label: string }

async function fetchRawGenres(): Promise<RawGenre[]> {
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
  const seen = new Set<string>()
  const out: RawGenre[] = []
  for (const b of data.results.bindings) {
    const id = extractQid(b.genre.value)
    const label = b.genreLabel.value
    if (!label || label === id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label })
  }
  return out
}

function buildAnchoredTree(raw: RawGenre[]): { nodes: GenreNode[]; assigned: number; dropped: string[] } {
  const anchorNodes = new Map<string, GenreNode>()
  for (const a of ANCHORS) {
    anchorNodes.set(a.id, {
      id: a.id,
      label: a.label,
      lastfmTag: a.lastfmTag,
      parentId: null,
      children: [],
    })
  }

  const childrenSeenTags = new Map<string, Set<string>>()
  for (const a of ANCHORS) childrenSeenTags.set(a.id, new Set([a.lastfmTag]))

  let assigned = 0
  const dropped: string[] = []

  for (const g of raw) {
    const anchor = assignAnchor(g.label)
    if (!anchor) {
      dropped.push(g.label)
      continue
    }
    const tag = toLastfmTag(g.label)
    const seen = childrenSeenTags.get(anchor.id)!
    if (seen.has(tag)) continue
    seen.add(tag)
    anchorNodes.get(anchor.id)!.children.push({
      id: g.id,
      label: g.label,
      lastfmTag: tag,
      parentId: anchor.id,
      children: [],
    })
    assigned++
  }

  // Hand-seed starved anchors (<3 children) from FALLBACK_CHILDREN.
  for (const a of ANCHORS) {
    const node = anchorNodes.get(a.id)!
    const seen = childrenSeenTags.get(a.id)!
    if (node.children.length < 3) {
      const fallback = FALLBACK_CHILDREN[a.id] ?? []
      for (const label of fallback) {
        const tag = toLastfmTag(label)
        if (seen.has(tag)) continue
        seen.add(tag)
        node.children.push({
          id: `${a.id}_seed_${tag}`,
          label,
          lastfmTag: tag,
          parentId: a.id,
          children: [],
        })
        if (node.children.length >= 6) break
      }
    }
    node.children.sort((x, y) => x.label.localeCompare(y.label))
  }

  return { nodes: Array.from(anchorNodes.values()), assigned, dropped }
}

function fallbackTree(): GenreNode[] {
  return buildAnchoredTree([]).nodes
}

async function main() {
  const outputPath = join(process.cwd(), 'data', 'genres.json')
  let nodes: GenreNode[]
  let source: string

  try {
    console.log('Fetching genre taxonomy from Wikidata SPARQL...')
    const raw = await fetchRawGenres()
    console.log(`Fetched ${raw.length} raw genre labels from Wikidata.`)
    const { nodes: tree, assigned, dropped } = buildAnchoredTree(raw)
    nodes = tree
    source = 'wikidata+anchored'
    console.log(`Assigned ${assigned} sub-genres across ${tree.length} anchors.`)
    console.log(`Dropped ${dropped.length} unmatched labels (first 20): ${dropped.slice(0, 20).join(', ')}`)
    for (const a of tree) {
      console.log(`  ${a.label}: ${a.children.length} sub-genres`)
    }
  } catch (err) {
    console.warn('Wikidata unreachable or returned an error — using fallback anchors only.')
    console.warn(err instanceof Error ? err.message : String(err))
    nodes = fallbackTree()
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
