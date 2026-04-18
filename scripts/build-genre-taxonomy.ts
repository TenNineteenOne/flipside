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

interface Cluster {
  id: string
  label: string
  lastfmTag: string
  match: (string | RegExp)[]
}

interface Anchor {
  id: string
  label: string
  lastfmTag: string
  match: (string | RegExp)[]
  clusters: Cluster[]
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
    clusters: [
      {
        id: 'CLUSTER_rock_indie',
        label: 'Indie & Alternative',
        lastfmTag: 'indie',
        match: [/\bindie\b/i, /\balternative\b/i, /\bbritpop\b/i, /\blo[- ]fi\b/i, /\bjangle\b/i, /\bmath rock\b/i],
      },
      {
        id: 'CLUSTER_rock_punk',
        label: 'Punk & Hardcore',
        lastfmTag: 'punk',
        match: [/\bpunk\b/i, /\bhardcore\b/i, /\bemo\b/i, /\bscreamo\b/i, /\bstraight edge\b/i, /\banarcho\b/i, /\bcrust\b/i, /\boi!\b/i, /\b2 tone\b/i, /\btwo[- ]tone\b/i],
      },
      {
        id: 'CLUSTER_rock_postpunk',
        label: 'Post-punk & Goth',
        lastfmTag: 'post-punk',
        match: [/\bpost[- ]punk\b/i, /\bpost[- ]rock\b/i, /\bno wave\b/i, /\bcoldwave\b/i, /\bdarkwave\b/i, /\bgoth/i, /\bshoegaze\b/i, /\bdream pop\b/i],
      },
      {
        id: 'CLUSTER_rock_psych',
        label: 'Psychedelic & Space',
        lastfmTag: 'psychedelic-rock',
        match: [/\bpsychedelic\b/i, /\bneo[- ]psychedelia\b/i, /\bacid rock\b/i, /\bspace rock\b/i, /\bstoner\b/i, /\bkrautrock\b/i],
      },
      {
        id: 'CLUSTER_rock_garage',
        label: 'Garage & Retro',
        lastfmTag: 'garage-rock',
        match: [/\bgarage\b/i, /\bsurf\b/i, /\brockabilly\b/i, /\bbritish invasion\b/i, /\brock and roll\b/i, /\brock'n'roll\b/i, /\bdoo[- ]wop\b/i],
      },
      {
        id: 'CLUSTER_rock_prog',
        label: 'Progressive & Art',
        lastfmTag: 'progressive-rock',
        match: [/\bprog/i, /\bart rock\b/i, /\bexperimental rock\b/i, /\bavant[- ]rock\b/i, /\bzeuhl\b/i, /\bcanterbury\b/i],
      },
      {
        id: 'CLUSTER_rock_grunge',
        label: 'Grunge & Alternative-Heavy',
        lastfmTag: 'grunge',
        match: [/\bgrunge\b/i, /\bsludge rock\b/i, /\bnoise rock\b/i, /\bindustrial rock\b/i, /\balternative metal\b/i, /\bnu[- ]metal\b/i],
      },
      {
        id: 'CLUSTER_rock_heavy',
        label: 'Hard & Classic Rock',
        lastfmTag: 'hard-rock',
        match: [/\bhard rock\b/i, /\bheavy\b/i, /\bblues rock\b/i, /\bsouthern rock\b/i, /\barena\b/i, /\bglam\b/i, /\bclassic rock\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_pop',
    label: 'Pop',
    lastfmTag: 'pop',
    match: [/\bpop\b/i, /\bsynth[- ]?pop\b/i, /\bdream pop\b/i, /\bbubblegum\b/i, /\bj-pop\b/i, /\bk-pop\b/i, /\belectropop\b/i, /\bnew wave\b/i, /\bnew romantic\b/i, /\bteen pop\b/i, /\bcity pop\b/i, /\bhypnagogic\b/i],
    clusters: [
      {
        id: 'CLUSTER_pop_mainstream',
        label: 'Mainstream Pop',
        lastfmTag: 'pop',
        match: [/\bteen pop\b/i, /\bbubblegum\b/i, /\bdance[- ]pop\b/i, /\badult contemporary\b/i, /\bchristmas\b/i, /\bhappy\b/i, /\bpower pop\b/i],
      },
      {
        id: 'CLUSTER_pop_synth',
        label: 'Synth & New Wave',
        lastfmTag: 'synth-pop',
        match: [/\bsynth/i, /\belectropop\b/i, /\bnew wave\b/i, /\bnew romantic\b/i, /\belectroclash\b/i],
      },
      {
        id: 'CLUSTER_pop_indie',
        label: 'Indie & Chamber Pop',
        lastfmTag: 'indie-pop',
        match: [/\bindie pop\b/i, /\bchamber pop\b/i, /\bdream pop\b/i, /\bhypnagogic\b/i, /\btwee\b/i, /\bbaroque pop\b/i],
      },
      {
        id: 'CLUSTER_pop_international',
        label: 'International Pop',
        lastfmTag: 'j-pop',
        match: [/\bj-pop\b/i, /\bk-pop\b/i, /\bc-pop\b/i, /\bcity pop\b/i, /\bmandopop\b/i, /\bcanto\b/i, /\blatin pop\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_hiphop',
    label: 'Hip-Hop',
    lastfmTag: 'hip-hop',
    match: [/\bhip[- ]?hop\b/i, /\brap\b/i, /\brapping\b/i, /\btrap\b/i, /\bdrill\b/i, /\bgrime\b/i, /\bboom bap\b/i, /\bcloud rap\b/i, /\bmumble\b/i, /\btrip hop\b/i],
    clusters: [
      {
        id: 'CLUSTER_hiphop_classic',
        label: 'Classic & Boom Bap',
        lastfmTag: 'boom-bap',
        match: [/\bboom bap\b/i, /\bgolden age\b/i, /\beast coast\b/i, /\bwest coast\b/i, /\bg[- ]funk\b/i, /\bgangsta\b/i, /\bold school\b/i],
      },
      {
        id: 'CLUSTER_hiphop_trap',
        label: 'Trap & Drill',
        lastfmTag: 'trap',
        match: [/\btrap\b/i, /\bdrill\b/i, /\bcrunk\b/i, /\bphonk\b/i, /\bmumble\b/i],
      },
      {
        id: 'CLUSTER_hiphop_uk',
        label: 'UK & Grime',
        lastfmTag: 'grime',
        match: [/\bgrime\b/i, /\buk drill\b/i, /\buk garage\b/i, /\buk hip[- ]?hop\b/i],
      },
      {
        id: 'CLUSTER_hiphop_experimental',
        label: 'Experimental & Alt-Rap',
        lastfmTag: 'trip-hop',
        match: [/\bcloud rap\b/i, /\btrip hop\b/i, /\babstract\b/i, /\bexperimental hip[- ]?hop\b/i, /\bart rap\b/i, /\bemo rap\b/i, /\bhorrorcore\b/i],
      },
      {
        id: 'CLUSTER_hiphop_conscious',
        label: 'Conscious & Jazz Rap',
        lastfmTag: 'conscious-hip-hop',
        match: [/\bconscious\b/i, /\bjazz rap\b/i, /\balternative hip[- ]?hop\b/i, /\bpolitical\b/i, /\bchristian hip[- ]?hop\b/i],
      },
      {
        id: 'CLUSTER_hiphop_regional',
        label: 'Regional',
        lastfmTag: 'international-hip-hop',
        match: [/\baustrian\b/i, /\bfrench\b/i, /\bgerman\b/i, /\bitalian\b/i, /\barabic\b/i, /\bjapanese\b/i, /\bkorean\b/i, /\blatin\b/i, /\bafrican\b/i, /\bchristian\b/i, /\bfrancophone\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_rnb',
    label: 'R&B / Soul',
    lastfmTag: 'soul',
    match: [/\bsoul\b/i, /\brhythm and blues\b/i, /\br&b\b/i, /\bfunk\b/i, /\bmotown\b/i, /\bneo[- ]soul\b/i, /\bgospel\b/i, /\bdisco\b/i, /\bblues\b/i, /\bdoo[- ]wop\b/i, /\bnew jack swing\b/i, /\bquiet storm\b/i],
    clusters: [
      {
        id: 'CLUSTER_rnb_soul',
        label: 'Soul',
        lastfmTag: 'soul',
        match: [/\bsoul\b/i, /\bneo[- ]soul\b/i, /\bmotown\b/i, /\bnorthern soul\b/i, /\bsouthern soul\b/i, /\bdeep soul\b/i, /\bphilly\b/i],
      },
      {
        id: 'CLUSTER_rnb_funk',
        label: 'Funk',
        lastfmTag: 'funk',
        match: [/\bfunk\b/i, /\bgo[- ]go\b/i, /\bp[- ]funk\b/i, /\belectro[- ]funk\b/i],
      },
      {
        id: 'CLUSTER_rnb_blues',
        label: 'Blues',
        lastfmTag: 'blues',
        match: [/\bblues\b/i, /\bdelta\b/i, /\bchicago blues\b/i, /\bjump blues\b/i, /\bpiedmont\b/i, /\belectric blues\b/i, /\bblues rock\b/i],
      },
      {
        id: 'CLUSTER_rnb_contemporary',
        label: 'Contemporary R&B',
        lastfmTag: 'r-and-b',
        match: [/\br&b\b/i, /\brhythm and blues\b/i, /\bnew jack swing\b/i, /\bquiet storm\b/i, /\bcontemporary\b/i, /\balternative r&b\b/i],
      },
      {
        id: 'CLUSTER_rnb_dance',
        label: 'Disco & Dance',
        lastfmTag: 'disco',
        match: [/\bdisco\b/i, /\bboogie\b/i, /\bhi[- ]nrg\b/i, /\bitalo\b/i, /\bnu[- ]disco\b/i],
      },
      {
        id: 'CLUSTER_rnb_gospel',
        label: 'Gospel & Doo-wop',
        lastfmTag: 'gospel',
        match: [/\bgospel\b/i, /\bdoo[- ]wop\b/i, /\bchurch\b/i, /\bspiritual\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_electronic',
    label: 'Electronic',
    lastfmTag: 'electronic',
    match: [/\belectronic\b/i, /\btechno\b/i, /\bhouse\b/i, /\btrance\b/i, /\bambient\b/i, /\bdrum and bass\b/i, /\bdubstep\b/i, /\bbrostep\b/i, /\bidm\b/i, /\belectro\b/i, /\bgarage\b/i, /\bbreakbeat\b/i, /\bchiptune\b/i, /\bsynthwave\b/i, /\bvaporwave\b/i, /\bedm\b/i, /\bjungle\b/i, /\bjump[- ]up\b/i, /\bmoombahton\b/i, /\bbass music\b/i, /\bbigroom\b/i, /\bhardstyle\b/i],
    clusters: [
      {
        id: 'CLUSTER_electronic_house',
        label: 'House',
        lastfmTag: 'house',
        match: [/\bhouse\b/i, /\bdeep house\b/i, /\btech house\b/i, /\bgarage house\b/i, /\bacid house\b/i, /\btropical house\b/i],
      },
      {
        id: 'CLUSTER_electronic_techno',
        label: 'Techno',
        lastfmTag: 'techno',
        match: [/\btechno\b/i, /\bminimal\b/i, /\bdetroit\b/i, /\bacid techno\b/i, /\bgoa\b/i],
      },
      {
        id: 'CLUSTER_electronic_ambient',
        label: 'Ambient & Downtempo',
        lastfmTag: 'ambient',
        match: [/\bambient\b/i, /\bchillout\b/i, /\bdowntempo\b/i, /\bchillwave\b/i, /\bnew age\b/i],
      },
      {
        id: 'CLUSTER_electronic_bass',
        label: 'Bass (DnB / Dubstep / Jungle)',
        lastfmTag: 'drum-and-bass',
        match: [/\bdrum and bass\b/i, /\bdrum ?n ?bass\b/i, /\bdubstep\b/i, /\bbrostep\b/i, /\bjungle\b/i, /\bjump[- ]up\b/i, /\bfootwork\b/i, /\bjuke\b/i, /\bbassline\b/i, /\bbass music\b/i],
      },
      {
        id: 'CLUSTER_electronic_trance',
        label: 'Trance & Hardstyle',
        lastfmTag: 'trance',
        match: [/\btrance\b/i, /\bhardstyle\b/i, /\bhardcore techno\b/i, /\bgabber\b/i, /\bpsytrance\b/i],
      },
      {
        id: 'CLUSTER_electronic_breaks',
        label: 'Breaks & Electro',
        lastfmTag: 'breakbeat',
        match: [/\bbreakbeat\b/i, /\bbreaks\b/i, /\belectro\b/i, /\bbig beat\b/i, /\bnu[- ]skool\b/i],
      },
      {
        id: 'CLUSTER_electronic_retro',
        label: 'Retro & Wave',
        lastfmTag: 'synthwave',
        match: [/\bchiptune\b/i, /\bsynthwave\b/i, /\bvaporwave\b/i, /\boutrun\b/i, /\bdarksynth\b/i, /\b8[- ]bit\b/i],
      },
      {
        id: 'CLUSTER_electronic_edm',
        label: 'EDM & Festival',
        lastfmTag: 'edm',
        match: [/\bedm\b/i, /\bbigroom\b/i, /\bmoombahton\b/i, /\belectro house\b/i, /\bfuture house\b/i, /\bfuture bass\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_jazz',
    label: 'Jazz',
    lastfmTag: 'jazz',
    match: [/\bjazz\b/i, /\bbebop\b/i, /\bswing\b/i, /\bfusion\b/i, /\bdixieland\b/i, /\bragtime\b/i, /\bbossa\b/i, /\bhard bop\b/i, /\bstride piano\b/i, /\bcool\b/i, /\bpost[- ]bop\b/i, /\bsmooth jazz\b/i],
    clusters: [
      {
        id: 'CLUSTER_jazz_traditional',
        label: 'Traditional',
        lastfmTag: 'swing',
        match: [/\bdixieland\b/i, /\bswing\b/i, /\bragtime\b/i, /\btrad/i, /\bstride piano\b/i, /\bnew orleans\b/i],
      },
      {
        id: 'CLUSTER_jazz_bebop',
        label: 'Bebop & Hard Bop',
        lastfmTag: 'bebop',
        match: [/\bbebop\b/i, /\bhard bop\b/i, /\bpost[- ]bop\b/i, /\bmodal\b/i],
      },
      {
        id: 'CLUSTER_jazz_cool',
        label: 'Cool & Smooth',
        lastfmTag: 'cool-jazz',
        match: [/\bcool\b/i, /\bsmooth jazz\b/i, /\beasy listening\b/i, /\blounge\b/i, /\bwest coast jazz\b/i],
      },
      {
        id: 'CLUSTER_jazz_fusion',
        label: 'Fusion & Nu-jazz',
        lastfmTag: 'jazz-fusion',
        match: [/\bfusion\b/i, /\bacid jazz\b/i, /\bnu[- ]jazz\b/i, /\belectro[- ]swing\b/i, /\bfunk jazz\b/i],
      },
      {
        id: 'CLUSTER_jazz_latin',
        label: 'Latin Jazz',
        lastfmTag: 'bossa-nova',
        match: [/\bbossa\b/i, /\blatin jazz\b/i, /\bafro[- ]cuban\b/i],
      },
      {
        id: 'CLUSTER_jazz_avant',
        label: 'Free & Avant',
        lastfmTag: 'free-jazz',
        match: [/\bfree\b/i, /\bavant\b/i, /\bspiritual jazz\b/i, /\bloft\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_classical',
    label: 'Classical',
    lastfmTag: 'classical',
    match: [/\bclassical\b/i, /\bbaroque\b/i, /\bromantic\b/i, /\bsymphon/i, /\bopera\b/i, /\boratorio\b/i, /\bconcerto\b/i, /\bsonata\b/i, /\bchoral\b/i, /\bmedieval\b/i, /\brenaissance\b/i, /\bchamber\b/i, /\bancient music\b/i, /\bgregorian\b/i, /\bplainsong\b/i, /\bplainchant\b/i, /\bcavatina\b/i, /\bmadrigal\b/i, /\bhymn\b/i, /\bmotet\b/i, /\bcantata\b/i, /\brequiem\b/i, /\bfugue\b/i, /\betude\b/i, /\bprelude\b/i, /\bmass\b/i, /\bdhrupad\b/i, /\bkhyal\b/i, /\bars antiqua\b/i, /\bars nova\b/i, /\btoccata\b/i, /\bnocturne\b/i, /\bmazurka\b/i, /\bpavane\b/i, /\bthrenody\b/i, /\bfranco[- ]flemish\b/i, /\ba cappella\b/i, /\bvocal music\b/i, /\bwhite voice\b/i, /\blied\b/i, /\belegy\b/i, /\bscherzo\b/i, /\boverture\b/i, /\bberceuse\b/i, /\bcanzona\b/i, /\bétude\b/i, /\bsarabande\b/i, /\bpasodoble\b/i, /\bprogramme music\b/i, /\bmarch\b/i, /\batonal/i, /\bbel canto\b/i, /\bgalliard\b/i, /\bpolonaise\b/i, /\bmenuet\b/i, /\bminuet\b/i, /\bwaltz\b/i, /\bimpromptu\b/i, /\bfantasia\b/i, /\bstudy\b/i],
    clusters: [
      {
        id: 'CLUSTER_classical_early',
        label: 'Medieval & Renaissance',
        lastfmTag: 'early-music',
        match: [/\bmedieval\b/i, /\brenaissance\b/i, /\bgregorian\b/i, /\bars antiqua\b/i, /\bars nova\b/i, /\bplainsong\b/i, /\bplainchant\b/i, /\bmadrigal\b/i, /\bmotet\b/i, /\bfranco[- ]flemish\b/i, /\bancient music\b/i, /\bestampie\b/i, /\border\b/i],
      },
      {
        id: 'CLUSTER_classical_baroque',
        label: 'Baroque',
        lastfmTag: 'baroque',
        match: [/\bbaroque\b/i, /\bconcerto grosso\b/i, /\bsonata\b/i, /\bfugue\b/i, /\btoccata\b/i, /\bcanzona\b/i, /\bsarabande\b/i, /\bgalliard\b/i, /\bpavane\b/i, /\bsuite\b/i, /\binvention\b/i],
      },
      {
        id: 'CLUSTER_classical_romantic',
        label: 'Classical & Romantic',
        lastfmTag: 'romantic',
        match: [/\bclassical period\b/i, /\bromantic\b/i, /\bsymphon/i, /\bchamber\b/i, /\bstring quartet\b/i, /\bnocturne\b/i, /\bmazurka\b/i, /\bpolonaise\b/i, /\bminuet\b/i, /\bmenuet\b/i, /\bwaltz\b/i, /\bimpromptu\b/i, /\bfantasia\b/i, /\bscherzo\b/i, /\bberceuse\b/i, /\betude\b/i, /\bétude\b/i, /\bprelude\b/i],
      },
      {
        id: 'CLUSTER_classical_modern',
        label: 'Modern & Contemporary',
        lastfmTag: 'contemporary-classical',
        match: [/\btwelve[- ]tone\b/i, /\batonal/i, /\bminimalist\b/i, /\bminimalism\b/i, /\bcontemporary\b/i, /\bmodernist\b/i, /\bserialism\b/i, /\bspectral\b/i, /\bpost[- ]minimalism\b/i, /\bthrenody\b/i],
      },
      {
        id: 'CLUSTER_classical_opera',
        label: 'Opera & Choral',
        lastfmTag: 'opera',
        match: [/\bopera\b/i, /\boratorio\b/i, /\bcantata\b/i, /\brequiem\b/i, /\bmass\b/i, /\bhymn\b/i, /\bchoral\b/i, /\ba cappella\b/i, /\bvocal music\b/i, /\bbel canto\b/i, /\blied\b/i, /\bwhite voice\b/i, /\bpsalm\b/i, /\bcanticle\b/i, /\belegy\b/i],
      },
      {
        id: 'CLUSTER_classical_orchestral',
        label: 'Concerto & Orchestral',
        lastfmTag: 'concerto',
        match: [/\bconcerto\b/i, /\boverture\b/i, /\bprogramme music\b/i, /\bmarch\b/i, /\bballet\b/i, /\btone poem\b/i, /\bincidental\b/i],
      },
      {
        id: 'CLUSTER_classical_nonwestern',
        label: 'Non-Western Traditional',
        lastfmTag: 'dhrupad',
        match: [/\bdhrupad\b/i, /\bkhyal\b/i, /\btarab\b/i, /\bmaqam\b/i, /\braga\b/i, /\bnoh\b/i, /\bgagaku\b/i, /\bpansori\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_metal',
    label: 'Metal',
    lastfmTag: 'metal',
    match: [/\bmetal\b/i, /\bmetalcore\b/i, /\bthrash\b/i, /\bdeath\b/i, /\bblack metal\b/i, /\bdoom\b/i, /\bsludge\b/i, /\bgrindcore\b/i, /\bdeathcore\b/i, /\bmathcore\b/i, /\bpower metal\b/i, /\bviking\b/i, /\bpagan\b/i, /\bcrust\b/i],
    clusters: [
      {
        id: 'CLUSTER_metal_classic',
        label: 'Classic & Heavy',
        lastfmTag: 'heavy-metal',
        match: [/\bheavy metal\b/i, /\bnwobhm\b/i, /\btraditional metal\b/i, /\bspeed metal\b/i, /\bglam metal\b/i, /\bhair metal\b/i],
      },
      {
        id: 'CLUSTER_metal_thrash',
        label: 'Thrash & Speed',
        lastfmTag: 'thrash-metal',
        match: [/\bthrash\b/i, /\bspeed\b/i, /\bcrossover\b/i],
      },
      {
        id: 'CLUSTER_metal_death',
        label: 'Death Metal',
        lastfmTag: 'death-metal',
        match: [/\bdeath metal\b/i, /\bmelodic death\b/i, /\btechnical death\b/i, /\bbrutal death\b/i, /\bdeathcore\b/i],
      },
      {
        id: 'CLUSTER_metal_black',
        label: 'Black Metal',
        lastfmTag: 'black-metal',
        match: [/\bblack metal\b/i, /\bviking\b/i, /\bpagan\b/i, /\bdepressive\b/i, /\bdsbm\b/i, /\bsymphonic black\b/i],
      },
      {
        id: 'CLUSTER_metal_doom',
        label: 'Doom & Sludge',
        lastfmTag: 'doom-metal',
        match: [/\bdoom\b/i, /\bsludge\b/i, /\bstoner metal\b/i, /\bfuneral doom\b/i, /\bdrone metal\b/i, /\bpost[- ]metal\b/i],
      },
      {
        id: 'CLUSTER_metal_core',
        label: 'Metalcore & Post',
        lastfmTag: 'metalcore',
        match: [/\bmetalcore\b/i, /\bmathcore\b/i, /\bpost[- ]hardcore\b/i, /\bdjent\b/i, /\bnu[- ]metal\b/i, /\balternative metal\b/i, /\bgroove metal\b/i],
      },
      {
        id: 'CLUSTER_metal_prog',
        label: 'Power & Progressive',
        lastfmTag: 'progressive-metal',
        match: [/\bpower metal\b/i, /\bprogressive metal\b/i, /\bsymphonic metal\b/i, /\bfolk metal\b/i, /\bgothic metal\b/i],
      },
      {
        id: 'CLUSTER_metal_grind',
        label: 'Grind & Crust',
        lastfmTag: 'grindcore',
        match: [/\bgrindcore\b/i, /\bpowerviolence\b/i, /\bcrust\b/i, /\bgoregrind\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_folk',
    label: 'Folk',
    lastfmTag: 'folk',
    match: [/\bfolk\b/i, /\bacoustic\b/i, /\bbluegrass\b/i, /\bcelt/i, /\bballad\b/i, /\breel\b/i, /\bshanty\b/i, /\bsinger[- ]songwriter\b/i, /\bbagad\b/i, /\bbothy\b/i, /\bappalachian\b/i, /\bsea chant/i, /\blullaby\b/i, /\bskiffle\b/i, /\bdrinking song\b/i],
    clusters: [
      {
        id: 'CLUSTER_folk_contemporary',
        label: 'Contemporary & Singer-Songwriter',
        lastfmTag: 'singer-songwriter',
        match: [/\bsinger[- ]songwriter\b/i, /\bcontemporary folk\b/i, /\bacoustic\b/i, /\bindie folk\b/i, /\bfreak folk\b/i, /\bchamber folk\b/i],
      },
      {
        id: 'CLUSTER_folk_traditional',
        label: 'Traditional & Ballads',
        lastfmTag: 'traditional-folk',
        match: [/\btraditional\b/i, /\bballad\b/i, /\blullaby\b/i, /\bdrinking\b/i, /\bskiffle\b/i, /\bshanty\b/i, /\bsea chant/i, /\bbothy\b/i],
      },
      {
        id: 'CLUSTER_folk_celtic',
        label: 'Celtic & British Isles',
        lastfmTag: 'celtic',
        match: [/\bcelt/i, /\birish\b/i, /\bscottish\b/i, /\bwelsh\b/i, /\breel\b/i, /\bbagad\b/i, /\bhighland\b/i, /\bjig\b/i],
      },
      {
        id: 'CLUSTER_folk_americana',
        label: 'Americana & Bluegrass',
        lastfmTag: 'bluegrass',
        match: [/\bbluegrass\b/i, /\bamericana\b/i, /\bappalachian\b/i, /\bold[- ]time\b/i, /\bstring band\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_country',
    label: 'Country',
    lastfmTag: 'country',
    match: [/\bcountry\b/i, /\bhonky[- ]tonk\b/i, /\bwestern\b/i, /\balt[- ]country\b/i, /\bamericana\b/i, /\bouthwestern\b/i, /\bnashville\b/i, /\bbakersfield\b/i, /\boutlaw\b/i],
    clusters: [
      {
        id: 'CLUSTER_country_classic',
        label: 'Classic & Honky-Tonk',
        lastfmTag: 'classic-country',
        match: [/\bhonky[- ]tonk\b/i, /\bnashville\b/i, /\bbakersfield\b/i, /\bwestern swing\b/i, /\btraditional country\b/i],
      },
      {
        id: 'CLUSTER_country_outlaw',
        label: 'Outlaw & Alt-Country',
        lastfmTag: 'outlaw-country',
        match: [/\boutlaw\b/i, /\balt[- ]country\b/i, /\bred dirt\b/i, /\bcowpunk\b/i, /\btexas country\b/i],
      },
      {
        id: 'CLUSTER_country_contemporary',
        label: 'Contemporary & Pop Country',
        lastfmTag: 'contemporary-country',
        match: [/\bcontemporary country\b/i, /\bcountry pop\b/i, /\bcountry rock\b/i, /\bcountry rap\b/i, /\bbro[- ]country\b/i],
      },
      {
        id: 'CLUSTER_country_western',
        label: 'Western & Cowboy',
        lastfmTag: 'western',
        match: [/\bwestern\b/i, /\bcowboy\b/i, /\brodeo\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_world',
    label: 'World',
    lastfmTag: 'world',
    match: [/\bworld\b/i, /\breggae\b/i, /\bska\b/i, /\bdub\b/i, /\bcumbia\b/i, /\bsalsa\b/i, /\bmerengue\b/i, /\btango\b/i, /\bsamba\b/i, /\bafrobeat\b/i, /\bhighlife\b/i, /\bigbo\b/i, /\bmbaqanga\b/i, /\bcuarteto\b/i, /\bzajal\b/i, /\bmantra\b/i, /\bthumri\b/i, /\btappa\b/i, /\bca trù\b/i, /\bukraine\b/i, /\baustrian\b/i, /\bfrench\b/i, /\barabic\b/i, /\blatin\b/i, /\breggaeton\b/i, /\bflamenco\b/i, /\bcarib/i, /\bbhangra\b/i, /\braga\b/i, /\bqawwali\b/i, /\brai\b/i, /\bfado\b/i, /\btarab\b/i, /\bsoukous\b/i, /\bgnawa\b/i, /\bbachata\b/i, /\bbatucada\b/i, /\bchoro\b/i, /\bmusic of\b/i, /\bconjunto\b/i, /\bpolyphony\b/i, /\bmusic from\b/i, /\btraditional\b/i, /\bklezmer\b/i, /\bjarocho\b/i, /\bforró\b/i, /\bpagode\b/i, /\bmpb\b/i, /\bsertanej/i, /\bchanson\b/i, /\benka\b/i, /\bj-rock\b/i, /\bgamelan\b/i, /\bmariachi\b/i, /\bnorteñ/i, /\bbanda\b/i, /\btex[- ]mex\b/i, /\bzouk\b/i, /\bkompa\b/i, /\bchalga\b/i, /\brebetiko\b/i, /\bturkish\b/i, /\bindonesian\b/i, /\bchinese\b/i, /\bgaelic\b/i, /\biranian\b/i, /\bafrican\b/i, /\basian\b/i],
    clusters: [
      {
        id: 'CLUSTER_world_latin',
        label: 'Latin America',
        lastfmTag: 'latin',
        match: [/\bsalsa\b/i, /\bcumbia\b/i, /\bbachata\b/i, /\bmerengue\b/i, /\breggaeton\b/i, /\btango\b/i, /\bmariachi\b/i, /\bnorteñ/i, /\bbanda\b/i, /\btex[- ]mex\b/i, /\bcuarteto\b/i, /\bconjunto\b/i, /\blatin\b/i, /\bjarocho\b/i, /\bchicha\b/i],
      },
      {
        id: 'CLUSTER_world_brazil',
        label: 'Brazilian',
        lastfmTag: 'brazilian',
        match: [/\bsamba\b/i, /\bbossa\b/i, /\bmpb\b/i, /\bforró\b/i, /\bpagode\b/i, /\bchoro\b/i, /\bsertanej/i, /\bbatucada\b/i, /\bbrazil/i, /\btropicália\b/i],
      },
      {
        id: 'CLUSTER_world_caribbean',
        label: 'Caribbean',
        lastfmTag: 'reggae',
        match: [/\breggae\b/i, /\bska\b/i, /\bdub\b/i, /\bzouk\b/i, /\bkompa\b/i, /\bcalypso\b/i, /\bcarib/i, /\bsoca\b/i, /\bmento\b/i, /\bdancehall\b/i],
      },
      {
        id: 'CLUSTER_world_african',
        label: 'African',
        lastfmTag: 'afrobeat',
        match: [/\bafrobeat\b/i, /\bhighlife\b/i, /\bmbaqanga\b/i, /\bsoukous\b/i, /\bgnawa\b/i, /\bigbo\b/i, /\bafrican\b/i, /\bkwaito\b/i, /\bzouglou\b/i, /\bziglibithy\b/i, /\bafro\b/i],
      },
      {
        id: 'CLUSTER_world_middle_east',
        label: 'Middle East & North Africa',
        lastfmTag: 'arabic',
        match: [/\barabic\b/i, /\brai\b/i, /\btarab\b/i, /\bzajal\b/i, /\bmaqam\b/i, /\biranian\b/i, /\bsufi\b/i, /\bmiddle eastern\b/i, /\bnorth african\b/i, /\bturkish\b/i],
      },
      {
        id: 'CLUSTER_world_south_asia',
        label: 'South Asia',
        lastfmTag: 'indian',
        match: [/\bbhangra\b/i, /\braga\b/i, /\bqawwali\b/i, /\bmantra\b/i, /\bthumri\b/i, /\btappa\b/i, /\bhindustani\b/i, /\bcarnatic\b/i, /\bbollywood\b/i, /\bfilmi\b/i, /\bindian\b/i],
      },
      {
        id: 'CLUSTER_world_east_asia',
        label: 'East & Southeast Asia',
        lastfmTag: 'east-asian',
        match: [/\bgamelan\b/i, /\benka\b/i, /\bca trù\b/i, /\bchinese\b/i, /\bjapanese traditional\b/i, /\bkorean traditional\b/i, /\bindonesian\b/i, /\basian\b/i, /\bj-rock\b/i],
      },
      {
        id: 'CLUSTER_world_europe',
        label: 'European Folk & Regional',
        lastfmTag: 'european-folk',
        match: [/\bflamenco\b/i, /\bfado\b/i, /\bchanson\b/i, /\bklezmer\b/i, /\brebetiko\b/i, /\bpolka\b/i, /\bchalga\b/i, /\bgaelic\b/i, /\bfrench\b/i, /\baustrian\b/i, /\bukraine\b/i, /\bmusic of\b/i, /\bmusic from\b/i, /\btraditional\b/i, /\bpolyphony\b/i],
      },
    ],
  },
  {
    id: 'ANCHOR_experimental',
    label: 'Experimental',
    lastfmTag: 'experimental',
    match: [/\bexperimental\b/i, /\bnoise\b/i, /\bavant[- ]garde\b/i, /\bdrone\b/i, /\bmusique concr[èe]te\b/i, /\bsound art\b/i, /\bmusical\b/i, /\bacclamatio\b/i, /\bgstanzl\b/i, /\bmashup\b/i, /\bindependent music\b/i, /\bminimalist\b/i, /\bglitch\b/i, /\blowercase\b/i, /\bindustrial\b/i, /\bfilm score\b/i, /\bsoundtrack\b/i],
    clusters: [
      {
        id: 'CLUSTER_experimental_noise',
        label: 'Noise & Industrial',
        lastfmTag: 'noise',
        match: [/\bnoise\b/i, /\bindustrial\b/i, /\bpower electronics\b/i, /\bharsh\b/i, /\bwall noise\b/i, /\bdeath industrial\b/i],
      },
      {
        id: 'CLUSTER_experimental_avant',
        label: 'Avant-garde & Concrète',
        lastfmTag: 'avant-garde',
        match: [/\bavant[- ]garde\b/i, /\bmusique concr[èe]te\b/i, /\bsound art\b/i, /\belectroacoustic\b/i, /\btape music\b/i],
      },
      {
        id: 'CLUSTER_experimental_drone',
        label: 'Drone & Ambient-Experimental',
        lastfmTag: 'drone',
        match: [/\bdrone\b/i, /\blowercase\b/i, /\bisolationist\b/i, /\bdark ambient\b/i],
      },
      {
        id: 'CLUSTER_experimental_glitch',
        label: 'Glitch & Plunderphonics',
        lastfmTag: 'glitch',
        match: [/\bglitch\b/i, /\bplunderphonics\b/i, /\bmashup\b/i, /\bbreakcore\b/i, /\bidm\b/i],
      },
      {
        id: 'CLUSTER_experimental_score',
        label: 'Film Score & Musical',
        lastfmTag: 'soundtrack',
        match: [/\bfilm score\b/i, /\bsoundtrack\b/i, /\bmusical\b/i, /\bvideo game\b/i, /\bincidental\b/i],
      },
    ],
  },
]

const FALLBACK_CHILDREN: Record<string, string[]> = {
  CLUSTER_rock_indie: ['indie rock', 'post-punk', 'shoegaze'],
  CLUSTER_country_western: ['western swing', 'cowboy ballad', 'rodeo'],
}

function extractQid(uri: string): string {
  return uri.replace('http://www.wikidata.org/entity/', '')
}

function toLastfmTag(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function matchesPatterns(label: string, patterns: (string | RegExp)[]): boolean {
  for (const m of patterns) {
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
    if (matchesPatterns(label, anchor.match)) return anchor
  }
  return null
}

function assignCluster(anchor: Anchor, label: string): Cluster | null {
  for (const cluster of anchor.clusters) {
    if (matchesPatterns(label, cluster.match)) return cluster
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

function buildTree(raw: RawGenre[]): { nodes: GenreNode[]; stats: { assigned: number; dropped: string[] } } {
  const anchorNodes = new Map<string, GenreNode>()
  const clusterNodes = new Map<string, GenreNode>()
  const clusterSeenTags = new Map<string, Set<string>>()
  const otherClusters = new Map<string, GenreNode>()

  for (const anchor of ANCHORS) {
    anchorNodes.set(anchor.id, {
      id: anchor.id,
      label: anchor.label,
      lastfmTag: anchor.lastfmTag,
      parentId: null,
      children: [],
    })
    for (const cluster of anchor.clusters) {
      const node: GenreNode = {
        id: cluster.id,
        label: cluster.label,
        lastfmTag: cluster.lastfmTag,
        parentId: anchor.id,
        children: [],
      }
      clusterNodes.set(cluster.id, node)
      clusterSeenTags.set(cluster.id, new Set([cluster.lastfmTag]))
      anchorNodes.get(anchor.id)!.children.push(node)
    }
  }

  let assigned = 0
  const dropped: string[] = []

  for (const g of raw) {
    const anchor = assignAnchor(g.label)
    if (!anchor) {
      dropped.push(g.label)
      continue
    }
    const cluster = assignCluster(anchor, g.label)
    const tag = toLastfmTag(g.label)

    let bucket: GenreNode
    let seenKey: string
    if (cluster) {
      bucket = clusterNodes.get(cluster.id)!
      seenKey = cluster.id
    } else {
      const otherKey = `${anchor.id}_OTHER`
      if (!otherClusters.has(otherKey)) {
        const otherNode: GenreNode = {
          id: otherKey,
          label: `More ${anchor.label}`,
          lastfmTag: anchor.lastfmTag,
          parentId: anchor.id,
          children: [],
        }
        otherClusters.set(otherKey, otherNode)
        clusterSeenTags.set(otherKey, new Set([anchor.lastfmTag]))
        anchorNodes.get(anchor.id)!.children.push(otherNode)
      }
      bucket = otherClusters.get(otherKey)!
      seenKey = otherKey
    }

    const seen = clusterSeenTags.get(seenKey)!
    if (seen.has(tag)) continue
    seen.add(tag)
    bucket.children.push({
      id: g.id,
      label: g.label,
      lastfmTag: tag,
      parentId: bucket.id,
      children: [],
    })
    assigned++
  }

  // Seed starved clusters from FALLBACK_CHILDREN (only those listed explicitly)
  for (const [clusterId, labels] of Object.entries(FALLBACK_CHILDREN)) {
    const node = clusterNodes.get(clusterId)
    if (!node || node.children.length >= 3) continue
    const seen = clusterSeenTags.get(clusterId)!
    for (const label of labels) {
      const tag = toLastfmTag(label)
      if (seen.has(tag)) continue
      seen.add(tag)
      node.children.push({
        id: `${clusterId}_seed_${tag}`,
        label,
        lastfmTag: tag,
        parentId: clusterId,
        children: [],
      })
      if (node.children.length >= 4) break
    }
  }

  // Prune empty clusters (no children and no matching data)
  for (const anchor of anchorNodes.values()) {
    anchor.children = anchor.children.filter((c) => c.children.length > 0)
    for (const cluster of anchor.children) {
      cluster.children.sort((x, y) => x.label.localeCompare(y.label))
    }
  }

  return { nodes: Array.from(anchorNodes.values()), stats: { assigned, dropped } }
}

function fallbackTree(): GenreNode[] {
  return buildTree([]).nodes
}

async function main() {
  const outputPath = join(process.cwd(), 'data', 'genres.json')
  let nodes: GenreNode[]
  let source: string

  try {
    console.log('Fetching genre taxonomy from Wikidata SPARQL...')
    const raw = await fetchRawGenres()
    console.log(`Fetched ${raw.length} raw genre labels from Wikidata.`)
    const { nodes: tree, stats } = buildTree(raw)
    nodes = tree
    source = 'wikidata+clustered'
    console.log(`Assigned ${stats.assigned} sub-genres across ${tree.length} anchors / clusters.`)
    console.log(`Dropped ${stats.dropped.length} unmatched labels (first 20): ${stats.dropped.slice(0, 20).join(', ')}`)
    for (const anchor of tree) {
      const leafCount = anchor.children.reduce((n, c) => n + c.children.length, 0)
      console.log(`  ${anchor.label}: ${anchor.children.length} clusters, ${leafCount} leaves`)
      for (const c of anchor.children) {
        console.log(`    • ${c.label}: ${c.children.length}`)
      }
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
