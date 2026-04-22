#!/usr/bin/env tsx
/**
 * Builds data/genres.json v2 from the existing 12×80 hierarchy plus the
 * scraped everynoise.com snapshot. Each everynoise leaf (6,291 total) is
 * slotted into an existing cluster by:
 *   1. exact match against current leaf lastfmTag/label,
 *   2. keyword match against anchor ids (rock, metal, pop, etc),
 *   3. keyword match against cluster ids within the matched anchor,
 *   4. fallback to ANCHOR_*_OTHER or experimental_OTHER.
 *
 * Leaves retain x/y/color/fontSize/exemplar so lib/genre/adjacency.ts can
 * switch from discrete tiers to continuous 2D Euclidean distance.
 *
 * Input:  /tmp/taxonomy-build/everynoise.json (scraped, 6,291 entries)
 *         data/genres.json (current, 12×80×511)
 * Output: data/genres.json (rewritten, 12×80×6,291)
 *         scripts/build-genres-v2.report.json (match-quality report)
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const EVERYNOISE_PATH = "/tmp/taxonomy-build/everynoise.json"
const CURRENT_PATH = resolve("data/genres.json")
const OUT_PATH = resolve("data/genres.json")
const REPORT_PATH = resolve("scripts/build-genres-v2.report.json")

type EverynoiseEntry = {
  name: string
  spotifyKey: string
  x: number
  y: number
  color: string
  fontSize: number
  exemplar: string
}

type Node = {
  id: string
  label: string
  lastfmTag: string
  parentId: string | null
  children: Node[]
  // v2 additions (leaves only):
  x?: number
  y?: number
  color?: string
  fontSize?: number
  exemplar?: string
}

type Genres = {
  generated: string
  source: string
  nodes: Node[]
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

function toTag(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function walkLeaves(node: Node, cb: (leaf: Node, cluster: Node, anchor: Node) => void, cluster?: Node, anchor?: Node) {
  if (!anchor) anchor = node
  if (!node.children || node.children.length === 0) {
    if (cluster && anchor) cb(node, cluster, anchor)
    return
  }
  const nextCluster = cluster ?? node // when descending from anchor, the node IS the anchor; its children are clusters
  for (const c of node.children) {
    // If this node is the anchor, the child is a cluster; otherwise, the child is a leaf.
    if (node === anchor) {
      walkLeaves(c, cb, c, anchor) // c is the cluster
    } else {
      walkLeaves(c, cb, nextCluster, anchor)
    }
  }
}

// -------------------- Load inputs --------------------

const everynoise: EverynoiseEntry[] = JSON.parse(readFileSync(EVERYNOISE_PATH, "utf8"))
const current: Genres = JSON.parse(readFileSync(CURRENT_PATH, "utf8"))

// -------------------- Build existing lookups --------------------

// normalized leaf name -> cluster id
const leafToCluster = new Map<string, string>()
// all anchors (id -> Node)
const anchors = new Map<string, Node>()
// all clusters (id -> { cluster, anchor })
const clusters = new Map<string, { cluster: Node; anchor: Node }>()

for (const anchor of current.nodes) {
  anchors.set(anchor.id, anchor)
  for (const cluster of anchor.children) {
    clusters.set(cluster.id, { cluster, anchor })
    for (const leaf of cluster.children) {
      leafToCluster.set(norm(leaf.label), cluster.id)
      leafToCluster.set(norm(leaf.lastfmTag), cluster.id)
    }
  }
}

// -------------------- Keyword maps --------------------

// Anchor keyword patterns — first match wins. Order = priority.
// Each entry: regex of keywords; if it matches the normalized genre name, route to that anchor.
const ANCHOR_ROUTES: { anchor: string; re: RegExp }[] = [
  { anchor: "ANCHOR_metal", re: /\b(metal|grindcore|deathcore|mathcore|djent|black gaze|blackgaze|sludge|sludgecore|metalcore|usbm|nsbm|kawaii metal|nu-metal|nu metal|dungeon synth|thrash|deathgrind|goregrind|pornogrind|brutal death|slam|cyber metal)\b/ },
  { anchor: "ANCHOR_classical", re: /\b(classical|baroque|romantic(?! pop)|symphon(y|ic)|opera|operetta|aria|concerto|chamber|orchestra|orchestral|sonata|requiem|cantata|gregorian|renaissance|medieval|early music|choral|oratorio|minimalism|minimal wave|hindustani|carnatic|dhrupad|khyal|thumri|tarana|raga|piano|harpsichord|organ|violin|cello|lute|zither|lullaby)\b/ },
  { anchor: "ANCHOR_hiphop", re: /\b(hip hop|hip-hop|hiphop|rap|trap|boom bap|drill|phonk|grime|crunk|plugg|pluggnb|hyphy|jersey club|mumble|traprun)\b/ },
  { anchor: "ANCHOR_jazz", re: /\b(jazz|bebop|swing|bossa|dixieland|ragtime|fusion|hard bop|cool jazz|free jazz|gypsy jazz|stride|big band|vocal jazz|adult standards|easy listening|lounge|nightclub)\b/ },
  { anchor: "ANCHOR_experimental", re: /\b(experimental|noise(?!\s?rock)|musique concrete|field recording|drone(?!\s?rock)|glitch|avant garde|avant-garde|lowercase|ambient industrial|dark ambient|power electronics|harsh noise|soundscape|sound collage|tape music|spoken word|poetry|soundtrack|score|video game|film score|library music|a cappella|barbershop|comedy|audiobook|hoerspiel|asmr|mantra|meditation|sleep|sleepy|rain|white noise|pink noise|new age|healing|yoga|bardcore|medieval revival|ritual|movie tunes|children|children's|kindermusik|talent show|sigilkore|escape room|otacore|sped up|nightcore)\b/ },
  { anchor: "ANCHOR_world", re: /\b(latin|latino|reggaeton|tropical|cumbia|salsa|merengue|bachata|mariachi|ranchera|musica mexicana|bolero|tango|bossa nova|samba|mpb|brazil|brazilian|forro|sertanejo|pagode|axe|capoeira|reggae|dancehall|ska|rocksteady|dub|soca|calypso|afro|afrobeat|afrobeats|afrofuturism|azonto|azontobeats|highlife|juju|amapiano|kwaito|gqom|african|ethiopian|zulu|benga|soukous|mbaqanga|rai|arabic|arab|turkish|persian|iranian|kurdish|indian|bollywood|bhangra|ghazal|qawwali|sitar|filmi|thai|khmer|vietnam|cantopop|mandopop|k-pop|j-pop|c-pop|korean|japanese|anime|enka|kayokyoku|shibuya kei|gamelan|khoomei|balkan|klezmer|flamenco|fado|celtic|morna|zouk|kompa|french|italian|spanish|german|russian|polish|ukrainian|czech|slovak|hungarian|greek|bulgarian|scandinavian|nordic|finnish|swedish|norwegian|italo|chanson|corrido|corridos|norteno|sierreno|banda|grupera|gruperas|cumbia|tejano|duranguense|regional mexican|musica popular|musica tropical|musica costena|musica occitana|musica espiritas|cancion|cancionero|cantautor|adoracao|adoracion|traditional|folklore|musica|world|afropop|afro pop|afrobeat|ethio|morna|opm|pilipino|tagalog|indonesian|malaysian|singaporean|burmese|lao|mongolian|tibetan|bhutanese|nepali|sri lankan|kazakh|uzbek|tajik|kyrgyz|azerbaijani|georgian|armenian|albanian|serbian|macedonian|croatian|bosnian|slovenian|dombra|zampogna|harmonikka|gamelan|hoerspiel|seemannslieder|oktoberfest|volksmusik|schlager|chason|dangdut|morna|mambo|rumba|guaracha|son cubano|habanera|plena|bomba|joropo|vallenato|chamame|chicha|huayno|milonga|carnaval|frevo|forro|kiramba|afrobeat|gnawa|pinoy|opm|khaliji|karaoke|iskelma|trot|fado|kizomba|taarab|rai|chalga|arabesk|laiko|entechno|rebetiko|kurdish|berber|kabyle|soukous|makossa|bongo flava|juju|highlife|mbalax|kora|griot|kuduro|semba|reggaeton|ethiopique|bhajan|kirtan|dhrupad|indian classical|hindustani|carnatic|urbano|urbana|arrocha|agronejo|tarling|campursari|kindermusik|kinderlieder|australian dance|aussie dance|nz dance|canadian|venezuelan|peruvian|colombian|chilean|argentine|uruguayan|paraguayan|bolivian|ecuadorian)\b/ },
  { anchor: "ANCHOR_rnb", re: /\b(r&b|rnb|r and b|soul|funk|disco|gospel|doo wop|doo-wop|quiet storm|new jack|neo soul|motown|philly soul|northern soul|deep soul|smooth jazz|smooth soul|urban|quiet storm|christian|ccm|worship|praise|hymn|spiritual|psalm|psalmen|hillsong)\b/ },
  { anchor: "ANCHOR_folk", re: /\b(folk|singer songwriter|singer-songwriter|americana|bluegrass|old time|hillbilly|appalachian|sea shanty|sea-shanty|troubadour|chanson|canzone|chorale|roots|country blues|stomp and holler|mellow gold|neo mellow|permanent wave|dad rock|yacht rock)\b/ },
  { anchor: "ANCHOR_country", re: /\b(country|western|outlaw|honky tonk|nashville|rockabilly|alt-country|alt country|cowboy|cowpunk|bakersfield|redneck|trucker|yodel|texas country|countrygaze)\b/ },
  { anchor: "ANCHOR_electronic", re: /\b(edm|electronic|electronica|electro|house|techno|trance|dubstep|drum and bass|dnb|d&b|ambient|idm|breakbeat|big beat|big room|acid|rave|hardcore|hardstyle|gabber|footwork|juke|jungle|garage|grime|grimewave|nightcore|lo-fi|lofi|vaporwave|chillwave|chillstep|chillhop|synthwave|future bass|future funk|moombahton|dub techno|tech house|deep house|microhouse|witch house|hyperpop|complextro|electroclash|synth|synthpop|synth pop|eurodance|trip hop|downtempo|glitch hop|nu disco|disco house|filter house|french house|electro house|progressive house|trance|psychill|2-step|2 step|uk dance|uk garage|bassline|wave|indietronica|hi-nrg|hi nrg|acid house)\b/ },
  { anchor: "ANCHOR_rock", re: /\b(rock|punk|grunge|shoegaze|shoegazer|post-rock|post rock|post-punk|post punk|emo|emoviolence|screamo|hardcore punk|indie|alternative|alt-rock|alt rock|alt z|garage|psych|psychedelic|surf|prog|progressive rock|stoner|doom|drone rock|noise rock|math rock|math-rock|britpop|new wave|power pop|dream pop|jangle|mod|ska|ska punk|melodic hardcore|post-hardcore|pop punk|pop-punk|madchester|freakbeat|beatlesque|merseybeat|deathrock|voidgaze|slowcore|slacker|twee|riot grrrl|egg punk|dance-punk|garage punk|skate punk)\b/ },
  { anchor: "ANCHOR_pop", re: /\b(pop|bubblegum|teen pop|dance pop|electropop|indie pop|hyperpop|art pop|baroque pop|sunshine pop|chamber pop|bedroom pop|pov|pov: indie|boy band|girl group|europop|metropopolis|modern uplift|j-poprock)\b/ },
]

// Cluster keyword patterns keyed by anchor. First match within the anchor wins.
const CLUSTER_ROUTES: Record<string, { cluster: string; re: RegExp }[]> = {
  ANCHOR_rock: [
    { cluster: "CLUSTER_rock_punk", re: /\b(punk|hardcore|emo|screamo|ska|oi|street|riot grrl|riot grrrl)\b/ },
    { cluster: "CLUSTER_rock_postpunk", re: /\b(post-punk|post punk|goth|gothic|shoegaze|post-rock|post rock|dream pop|ethereal)\b/ },
    { cluster: "CLUSTER_rock_psych", re: /\b(psych|psychedelic|space rock|stoner|acid rock|neo-psychedelic)\b/ },
    { cluster: "CLUSTER_rock_garage", re: /\b(garage|surf|rockabilly|british invasion|freakbeat|beat|mod|rock and roll|rock 'n' roll)\b/ },
    { cluster: "CLUSTER_rock_prog", re: /\b(prog|progressive rock|art rock|zeuhl|canterbury)\b/ },
    { cluster: "CLUSTER_rock_grunge", re: /\b(grunge|noise rock|industrial rock|post-grunge|sludge rock)\b/ },
    { cluster: "CLUSTER_rock_heavy", re: /\b(hard rock|glam rock|blues rock|southern rock|arena rock|classic rock|aor|album-oriented|boogie rock)\b/ },
    { cluster: "CLUSTER_rock_indie", re: /\b(indie|alternative|alt|britpop|math rock|math-rock|power pop|lo-fi indie|slowcore|slacker|twee|jangle)\b/ },
  ],
  ANCHOR_pop: [
    { cluster: "CLUSTER_pop_synth", re: /\b(synth pop|synth-pop|synthpop|electropop|electro pop|new wave)\b/ },
    { cluster: "CLUSTER_pop_indie", re: /\b(indie pop|chamber pop|twee|baroque pop|art pop|bedroom pop)\b/ },
    { cluster: "CLUSTER_pop_international", re: /\b(k-pop|j-pop|c-pop|mandopop|cantopop|anime|korean pop|japanese pop|chinese pop|latin pop|italo pop|europop|eurobeat)\b/ },
    { cluster: "CLUSTER_pop_mainstream", re: /\b(dance pop|teen pop|bubblegum|adult contemporary|contemporary pop|mainstream pop)\b/ },
  ],
  ANCHOR_hiphop: [
    { cluster: "CLUSTER_hiphop_classic", re: /\b(boom bap|boom-bap|old school|golden age|east coast|rap east|east coast rap|hardcore hip hop|hardcore hip-hop)\b/ },
    { cluster: "CLUSTER_hiphop_trap", re: /\b(trap|drill|phonk|crunk|ratchet|mumble|atlanta rap|plugg|sigilkore)\b/ },
    { cluster: "CLUSTER_hiphop_conscious", re: /\b(conscious|political hip hop|political rap|alternative hip hop|alternative rap|abstract|jazz rap|underground hip hop)\b/ },
    { cluster: "CLUSTER_hiphop_regional", re: /\b(french hip hop|german hip hop|latin hip hop|rap latino|desi hip hop|japanese hip hop|brazilian hip hop|spanish hip hop|russian hip hop|italian hip hop|uk hip hop|uk rap|korean hip hop|asian hip hop|dutch rap|international|memphis rap|new orleans rap|houston rap|bay area|detroit rap|chicago rap|midwest|southern rap|west coast|brooklyn drill|uk drill|chicago drill|canadian|african rap|polish rap|afroswing)\b/ },
  ],
  ANCHOR_rnb: [
    { cluster: "CLUSTER_rnb_soul", re: /\b(soul|motown|philly soul|northern soul|deep soul|neo soul|southern soul|blue-eyed soul|blue eyed soul|psychedelic soul)\b/ },
    { cluster: "CLUSTER_rnb_funk", re: /\b(funk|p-funk|g-funk|funk rock|funky|boogie|electro-funk|jazz funk)\b/ },
    { cluster: "CLUSTER_rnb_blues", re: /\b(blues|delta blues|chicago blues|electric blues|jump blues|country blues|piedmont blues|texas blues|zydeco|harmonica blues|rhythm and blues)\b/ },
    { cluster: "CLUSTER_rnb_contemporary", re: /\b(contemporary r&b|contemporary rnb|alternative r&b|alternative rnb|urban contemporary|new jack swing|quiet storm)\b/ },
    { cluster: "CLUSTER_rnb_dance", re: /\b(disco|nu disco|nu-disco|boogie|dance-punk|post-disco|hi-nrg|hi nrg|italo disco|eurodisco)\b/ },
    { cluster: "CLUSTER_rnb_gospel", re: /\b(gospel|christian r&b|contemporary christian|southern gospel|christian hip hop|spiritual|worship|praise)\b/ },
  ],
  ANCHOR_electronic: [
    { cluster: "CLUSTER_electronic_house", re: /\b(house|deep house|tech house|acid house|chicago house|detroit house|progressive house|electro house|french house|filter house|tropical house|disco house|soulful house|afro house|microhouse|hard house)\b/ },
    { cluster: "CLUSTER_electronic_techno", re: /\b(techno|minimal techno|detroit techno|acid techno|dub techno|industrial techno|berlin techno)\b/ },
    { cluster: "CLUSTER_electronic_ambient", re: /\b(ambient|dark ambient|isolationist|new age|drone|lowercase|ambient industrial|chillout|chill-out|chillwave|space music|atmospheric)\b/ },
    { cluster: "CLUSTER_electronic_bass", re: /\b(drum and bass|d&b|dnb|jungle|dubstep|neurofunk|liquid dnb|breakcore|future bass|trap edm|glitch hop|riddim|bassline|bass music|garage)\b/ },
    { cluster: "CLUSTER_electronic_trance", re: /\b(trance|psytrance|psychedelic trance|goa|uplifting trance|hard trance|vocal trance|progressive trance)\b/ },
    { cluster: "CLUSTER_electronic_breaks", re: /\b(breakbeat|big beat|nu skool breaks|broken beat|florida breaks)\b/ },
    { cluster: "CLUSTER_electronic_retro", re: /\b(synthwave|retrowave|outrun|vaporwave|future funk|darkwave|coldwave|chillsynth|dreamwave)\b/ },
    { cluster: "CLUSTER_electronic_edm", re: /\b(edm|electro|electronic dance music|complextro|melbourne bounce|moombahton|dutch house|bigroom|big room|festival)\b/ },
  ],
  ANCHOR_jazz: [
    { cluster: "CLUSTER_jazz_traditional", re: /\b(swing|big band|dixieland|stride|trad jazz|new orleans jazz|vaudeville|ragtime)\b/ },
    { cluster: "CLUSTER_jazz_bebop", re: /\b(bebop|hard bop|post-bop|post bop)\b/ },
    { cluster: "CLUSTER_jazz_cool", re: /\b(cool jazz|west coast jazz|modal jazz|third stream)\b/ },
    { cluster: "CLUSTER_jazz_fusion", re: /\b(fusion|jazz fusion|jazz-funk|jazz funk|nu jazz|acid jazz|jazz rap|soul jazz|jazztronica)\b/ },
    { cluster: "CLUSTER_jazz_latin", re: /\b(bossa|bossa nova|latin jazz|afro cuban jazz|mpb jazz|brazilian jazz)\b/ },
    { cluster: "CLUSTER_jazz_avant", re: /\b(free jazz|avant-garde jazz|avant garde jazz|spiritual jazz|creative music)\b/ },
  ],
  ANCHOR_classical: [
    { cluster: "CLUSTER_classical_early", re: /\b(gregorian|medieval|renaissance|early music|ars nova|early baroque|monastic)\b/ },
    { cluster: "CLUSTER_classical_baroque", re: /\b(baroque|harpsichord|concerto grosso|fugue|vivaldi|bach|handel)\b/ },
    { cluster: "CLUSTER_classical_romantic", re: /\b(romantic|romantic era|late romantic|impressionist|nationalist|lieder|art song)\b/ },
    { cluster: "CLUSTER_classical_modern", re: /\b(contemporary classical|post-minimalism|spectral|serial|twelve-tone|modernist|neoclassical|new music|modern classical)\b/ },
    { cluster: "CLUSTER_classical_opera", re: /\b(opera|operetta|aria|lied|cantata|oratorio|zarzuela|bel canto|verismo)\b/ },
    { cluster: "CLUSTER_classical_orchestral", re: /\b(orchestra|orchestral|symphony|symphonic|concerto|chamber|string quartet|soundtrack)\b/ },
    { cluster: "CLUSTER_classical_nonwestern", re: /\b(hindustani|carnatic|dhrupad|khyal|thumri|tarana|raga|gamelan|chinese classical|japanese classical|persian classical|arabic classical)\b/ },
  ],
  ANCHOR_metal: [
    { cluster: "CLUSTER_metal_classic", re: /\b(heavy metal|classic metal|nwobhm|hair metal|glam metal|traditional metal|power metal)\b/ },
    { cluster: "CLUSTER_metal_thrash", re: /\b(thrash|crossover thrash|speed metal|bay area thrash)\b/ },
    { cluster: "CLUSTER_metal_death", re: /\b(death metal|melodic death|technical death|brutal death|slam|deathgrind|goregrind|grindcore|deathcore|old school death)\b/ },
    { cluster: "CLUSTER_metal_black", re: /\b(black metal|blackgaze|atmospheric black|symphonic black|raw black|pagan|viking|nsbm)\b/ },
    { cluster: "CLUSTER_metal_doom", re: /\b(doom|stoner doom|funeral doom|sludge|drone metal|post-metal|post metal|atmospheric doom)\b/ },
    { cluster: "CLUSTER_metal_core", re: /\b(metalcore|mathcore|post-hardcore|deathcore|melodic metalcore|djent|progressive metalcore|easycore)\b/ },
    { cluster: "CLUSTER_metal_prog", re: /\b(prog metal|progressive metal|technical metal|avant-garde metal|art metal)\b/ },
  ],
  ANCHOR_folk: [
    { cluster: "CLUSTER_folk_contemporary", re: /\b(singer-songwriter|singer songwriter|contemporary folk|neo folk|neo-folk|anti-folk|anti folk|indie folk|freak folk|chamber folk)\b/ },
    { cluster: "CLUSTER_folk_traditional", re: /\b(traditional folk|trad folk|english folk|appalachian|old time|field holler|work song)\b/ },
    { cluster: "CLUSTER_folk_celtic", re: /\b(celtic|irish|scottish|welsh|breton|cornish|gaelic|scots|irish folk|scottish folk|highland)\b/ },
    { cluster: "CLUSTER_folk_americana", re: /\b(bluegrass|americana|alt-country|alt country|newgrass|string band|folk revival|hillbilly|country blues)\b/ },
  ],
  ANCHOR_country: [
    { cluster: "CLUSTER_country_classic", re: /\b(classic country|traditional country|honky tonk|nashville sound|countrypolitan|bakersfield|outlaw country)\b/ },
    { cluster: "CLUSTER_country_western", re: /\b(western|western swing|cowboy|texas country|red dirt|rancho|western music)\b/ },
  ],
  ANCHOR_world: [
    { cluster: "CLUSTER_world_latin", re: /\b(latin|latino|reggaeton|tropical|cumbia|salsa|merengue|bachata|bolero|tango|latin pop|musica mexicana|mariachi|ranchera|corrido|nortena|norteno|tejano|banda|grupera|tropipop|chicha)\b/ },
    { cluster: "CLUSTER_world_brazil", re: /\b(brazil|brazilian|samba|bossa nova|mpb|forro|sertanejo|pagode|axe|baile funk|funk carioca|funk brasileiro|capoeira|choro|tropicalia|frevo)\b/ },
    { cluster: "CLUSTER_world_caribbean", re: /\b(reggae|dancehall|ska|rocksteady|dub|soca|calypso|mento|bouyon|zouk|kompa|merengue|bachata|caribbean|jamaican|haitian|trinidadian)\b/ },
    { cluster: "CLUSTER_world_african", re: /\b(afrobeat|afrobeats|highlife|juju|amapiano|kwaito|gqom|african|soukous|mbaqanga|makossa|mbalax|kizomba|benga|chimurenga|ethiopian|south african|nigerian|ghanaian|zulu|congolese|kenyan|afro house|afro pop|afropop)\b/ },
    { cluster: "CLUSTER_world_middle_east", re: /\b(arabic|arab|middle eastern|egyptian|lebanese|syrian|iraqi|palestinian|turkish|persian|iranian|kurdish|israeli|hebrew|sephardic|mizrahi|rai|dabke)\b/ },
    { cluster: "CLUSTER_world_south_asia", re: /\b(indian|bollywood|bhangra|ghazal|qawwali|filmi|hindustani|carnatic|desi|pakistani|bangladeshi|nepali|sri lankan|tamil|punjabi|marathi|bengali)\b/ },
    { cluster: "CLUSTER_world_east_asia", re: /\b(chinese|japanese|korean|vietnamese|thai|khmer|cambodian|mongolian|taiwanese|cantopop|mandopop|k-pop|j-pop|c-pop|anime|enka|kayokyoku|shibuya kei|min'yo|gamelan|khoomei|east asian|asian underground)\b/ },
    { cluster: "CLUSTER_world_europe", re: /\b(celtic|french|italian|italo|spanish|german|russian|polish|ukrainian|czech|slovak|hungarian|romanian|greek|bulgarian|serbian|croatian|bosnian|slovenian|macedonian|albanian|scandinavian|nordic|finnish|swedish|norwegian|danish|icelandic|dutch|flemish|belgian|austrian|swiss|balkan|klezmer|flamenco|fado|chanson|canzone|volksmusik|schlager|liedermacher|greek folk|russian folk|polish folk|irish folk|scottish folk|european folk)\b/ },
  ],
  ANCHOR_experimental: [
    { cluster: "CLUSTER_experimental_noise", re: /\b(noise|harsh noise|power electronics|japanoise|wall of noise|power noise)\b/ },
    { cluster: "CLUSTER_experimental_avant", re: /\b(avant-garde|avant garde|musique concrete|tape music|sound art|academic|serialism)\b/ },
    { cluster: "CLUSTER_experimental_drone", re: /\b(drone|dark drone|ambient drone|isolationist|lowercase|minimal drone)\b/ },
    { cluster: "CLUSTER_experimental_glitch", re: /\b(glitch|clicks and cuts|microsound|idm|intelligent dance|bit music|chiptune|8bit|8-bit)\b/ },
    { cluster: "CLUSTER_experimental_score", re: /\b(soundtrack|score|film score|video game|game music|library music|production music|theme|trailer music)\b/ },
  ],
}

// -------------------- Match each everynoise entry --------------------

type MatchMethod = "exact" | "cluster_keyword" | "anchor_keyword" | "fallback_other"
type Match = { genre: EverynoiseEntry; clusterId: string; anchorId: string; method: MatchMethod }

const matches: Match[] = []
const counters: Record<MatchMethod, number> = {
  exact: 0,
  cluster_keyword: 0,
  anchor_keyword: 0,
  fallback_other: 0,
}

function assign(genre: EverynoiseEntry): Match {
  const n = norm(genre.name)

  // 1. exact match against existing leaves
  const existingClusterId = leafToCluster.get(n)
  if (existingClusterId) {
    const anchor = clusters.get(existingClusterId)!.anchor
    return { genre, clusterId: existingClusterId, anchorId: anchor.id, method: "exact" }
  }

  // 2. anchor keyword — first match wins (priority order)
  let matchedAnchor: string | null = null
  for (const route of ANCHOR_ROUTES) {
    if (route.re.test(n)) {
      matchedAnchor = route.anchor
      break
    }
  }

  if (!matchedAnchor) {
    return { genre, clusterId: "ANCHOR_experimental_OTHER", anchorId: "ANCHOR_experimental", method: "fallback_other" }
  }

  // 3. cluster keyword within the matched anchor
  const clusterRoutes = CLUSTER_ROUTES[matchedAnchor] || []
  for (const cr of clusterRoutes) {
    if (cr.re.test(n)) {
      return { genre, clusterId: cr.cluster, anchorId: matchedAnchor, method: "cluster_keyword" }
    }
  }

  // 4. fallback to _OTHER within the anchor
  const otherId = matchedAnchor === "ANCHOR_rnb"
    ? "CLUSTER_rnb_contemporary" // rnb has no _OTHER; use contemporary as catch-all
    : `${matchedAnchor}_OTHER`
  // but wait — _OTHER cluster ids actually look like `ANCHOR_rock_OTHER` in the data. Check.
  return { genre, clusterId: otherId, anchorId: matchedAnchor, method: "anchor_keyword" }
}

for (const entry of everynoise) {
  const m = assign(entry)
  matches.push(m)
  counters[m.method]++
}

// -------------------- Validate that every clusterId exists --------------------

const missingClusters = new Set<string>()
for (const m of matches) {
  if (!clusters.has(m.clusterId)) missingClusters.add(m.clusterId)
}
if (missingClusters.size > 0) {
  console.error("WARNING: these cluster ids do not exist in the tree — assignments will need fixing:")
  for (const id of missingClusters) console.error("  - " + id)
}

// -------------------- Build the new tree --------------------

// Reset every cluster's children array; we're fully rebuilding the leaf layer.
for (const anchor of current.nodes) {
  for (const cluster of anchor.children) {
    cluster.children = []
  }
}

// Bucket matches by cluster id
const byCluster = new Map<string, Match[]>()
for (const m of matches) {
  if (!byCluster.has(m.clusterId)) byCluster.set(m.clusterId, [])
  byCluster.get(m.clusterId)!.push(m)
}

// Attach leaves
for (const [clusterId, ms] of byCluster) {
  const c = clusters.get(clusterId)
  if (!c) continue
  // Sort alphabetically by name for stable output
  ms.sort((a, b) => a.genre.name.localeCompare(b.genre.name))
  for (const m of ms) {
    const g = m.genre
    c.cluster.children.push({
      id: `sp:${toTag(g.spotifyKey)}`,
      label: g.name,
      lastfmTag: toTag(g.name),
      parentId: clusterId,
      children: [],
      x: g.x,
      y: g.y,
      color: g.color,
      fontSize: g.fontSize,
      exemplar: g.exemplar,
    })
  }
}

// -------------------- Write output --------------------

const out: Genres = {
  generated: new Date().toISOString(),
  source: "everynoise+hierarchy-fitted-2026-04-21",
  nodes: current.nodes,
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))

// Report
const sampleFallbacks = matches
  .filter((m) => m.method === "fallback_other")
  .slice(0, 30)
  .map((m) => m.genre.name)

const anchorKeywordByAnchor: Record<string, number> = {}
for (const m of matches) {
  if (m.method === "anchor_keyword") {
    anchorKeywordByAnchor[m.anchorId] = (anchorKeywordByAnchor[m.anchorId] || 0) + 1
  }
}

const clusterCounts: Record<string, number> = {}
for (const m of matches) {
  clusterCounts[m.clusterId] = (clusterCounts[m.clusterId] || 0) + 1
}
const topClusters = Object.entries(clusterCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)

const report = {
  total: matches.length,
  by_method: counters,
  anchor_keyword_fallbacks_by_anchor: anchorKeywordByAnchor,
  top_20_clusters_by_size: topClusters,
  sample_experimental_fallbacks: sampleFallbacks,
  missing_cluster_ids: [...missingClusters],
}

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

// -------------------- Console summary --------------------

console.log(`Processed ${matches.length} everynoise entries`)
console.log(`  exact leaf match: ${counters.exact}`)
console.log(`  matched cluster by keyword: ${counters.cluster_keyword}`)
console.log(`  matched anchor only (→ _OTHER): ${counters.anchor_keyword}`)
console.log(`  no anchor matched (→ experimental_OTHER): ${counters.fallback_other}`)
console.log(`\nTop 20 clusters by leaf count:`)
for (const [id, n] of topClusters) console.log(`  ${n.toString().padStart(5)}  ${id}`)
console.log(`\nSample experimental-fallbacks (first 30):`)
for (const name of sampleFallbacks) console.log(`  - ${name}`)
console.log(`\nReport written to ${REPORT_PATH}`)
console.log(`Output written to ${OUT_PATH}`)
