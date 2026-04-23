/**
 * Sub-cluster keyword dictionary for `scripts/build-subclusters.ts`.
 *
 * For each cluster id whose leaf count exceeds the split threshold, the
 * builder routes leaves into named sub-buckets using the regex patterns
 * below. Leaves that match nothing drop into a sibling "Other in …" bucket.
 *
 * ## Two-layer strategy
 *
 * 1. **Style buckets** — per-cluster regex lists defined in CLUSTER_STYLES.
 *    These run FIRST so "deep house" routes to the House style bucket even
 *    if its tag happens to contain a country name.
 * 2. **Regional fallback** — if a cluster is big enough that a second split
 *    is warranted AND style matches are sparse, REGIONAL_BUCKETS routes by
 *    country / region. Used for the *_OTHER mega-buckets where geography
 *    is the dominant axis.
 *
 * ## File format
 *
 * This is a .ts file (rather than .json, as the PRD originally called for)
 * so regex literals can be written directly and reviewed without backslash
 * soup. The build script imports this file.
 */

export interface KeywordBucket {
  /** Short id suffix, appended to parent id to form the sub-cluster id */
  id: string
  /** Human-readable label shown in the picker */
  label: string
  /** First pattern to match wins — order matters, more specific first */
  pattern: RegExp
}

// ── Shared regional buckets (used for *_OTHER mega-buckets) ───────────────

export const REGIONAL_BUCKETS: KeywordBucket[] = [
  {
    id: 'northam',
    label: 'North American',
    pattern:
      /\b(american|canadian|quebec|quebecois|boricua|alabama|alaska|albany|albuquerque|arkansas|atlanta|atl|austin|baltimore|baton-rouge|bay-area|berkeley|birmingham-al|bloomington|boston|brisbane-canada|bronx|brooklyn|brockton|buffalo|california|cambridge|chicago|cincinnati|cleveland|colorado|columbus|connecticut|dallas|dc|denver|detroit|florida|fort-wayne|fort-worth|georgia|hawaii|hawaiian|honolulu|houston|idaho|illinois|indiana|indianapolis|iowa|jersey|kansas|kentucky|la|las-vegas|lexington|long-island|louisiana|louisville|maine|maryland|massachusetts|memphis|miami|michigan|midwest|milwaukee|minneapolis|minnesota|mississippi|missouri|montana|nashville|nebraska|nevada|new-england|new-hampshire|new-jersey|new-mexico|new-orleans|new-york|ny|nyc|north-carolina|north-dakota|oakland|ohio|oklahoma|oregon|orlando|pacific-northwest|pennsylvania|philadelphia|philly|phoenix|pittsburgh|portland|providence|raleigh|richmond|sacramento|san-antonio|san-diego|san-francisco|san-jose|seattle|south-carolina|south-dakota|southern-us|st-louis|st-paul|tampa|tennessee|texas|toronto|tulsa|usa|utah|vancouver|vermont|virginia|washington|west-coast|wisconsin|wyoming|montreal|asbury-park|alabama|appalachian|appalachia|deep-south)\b/,
  },
  {
    id: 'europe',
    label: 'European',
    pattern:
      /\b(european|uk|british|english|british-isles|london|manchester|liverpool|bristol|birmingham-uk|sheffield|leeds|glasgow|edinburgh|scottish|welsh|irish|ireland|dublin|french|francais|france|paris|german|germany|berlin|hamburg|munich|koln|cologne|italian|italy|italia|rome|milan|napoli|spanish|espanol|spain|madrid|barcelona|portuguese|portugal|dutch|netherlands|amsterdam|belgian|belgium|brussels|swedish|sweden|stockholm|norwegian|norway|oslo|danish|denmark|copenhagen|finnish|finland|helsinki|icelandic|iceland|reykjavik|polish|poland|warsaw|czech|czsk|prague|slovak|slovakia|slovenian|slovenia|croatian|croatia|serbian|serbia|hungarian|hungary|budapest|romanian|romania|bucharest|bulgarian|bulgaria|greek|greece|athens|russian|russia|moscow|ukrainian|ukraine|kiev|belarusian|belarus|lithuanian|lithuania|latvian|latvia|estonian|estonia|albanian|albania|bosnian|bosnia|macedonian|north-macedonia|swiss|switzerland|zurich|austrian|austria|vienna|luxembourgish|luxembourg|maltese|malta|cypriot|cyprus|faroese|manx|flemish|walloon|breton|galician|basque|euskal|catalan|catala|occitan|corsican|chanson|balkan|celtic|aarhus|odense|baltic|scandinavian|nordic|uk-garage|uk-hip-hop|uk-drill|glasgow|aarhus)\b/,
  },
  {
    id: 'latin',
    label: 'Latin American',
    pattern:
      /\b(latin|latino|latina|mexican|mexicano|mexicana|mexico|df|chilango|argentine|argentino|argentina|brazilian|brasileiro|brasileira|brasil|brazil|chilean|chileno|chile|colombian|colombiano|colombia|peruvian|peruano|peru|venezuelan|venezolano|venezuela|ecuadorian|ecuatoriano|ecuador|bolivian|boliviano|bolivia|paraguayan|paraguayo|paraguay|uruguayan|uruguayo|uruguay|costa-rican|costa-rica|guatemalan|guatemala|honduran|honduras|nicaraguan|nicaragua|panamanian|panama|salvadoran|salvador|puerto-rican|puertorriqueno|cuban|cubano|cuba|dominican|dominicano|haitian|haiti|jamaican|trinidadian|trinidad|bahamian|reggaeton|bachata|bolero|cumbia|banda|corrido|norteno|ranchera|mariachi|samba|bossa|forro|sertanejo|funk-carioca|neoperreo|latin-trap|latin-pop|latin-rock|latin-alternative|latin-indie|perreo|pagode|axe|arrocha|frevo|maracatu|merengue|plena|soca|calypso|zouk|kompa|chicha|cuarteto|son-cubano|trova|timba|tejano|grupero|sierreno|regional-mexicano|marimba|candombe|milonga|tango|murga)\b/,
  },
  {
    id: 'eastasia',
    label: 'East & Southeast Asia',
    pattern:
      /\b(japanese|j-pop|j-rock|j-rap|j-reggae|japan|jpop|jrock|chinese|china|mandarin|cantonese|cantopop|mandopop|taiwanese|taiwan|hong-kong|hongkong|korean|k-pop|k-rock|k-rap|k-indie|kpop|krock|korea|vietnamese|vietnam|thai|thailand|indonesian|indonesia|malaysian|malaysia|filipino|philippines|tagalog|pinoy|cambodian|cambodia|laotian|burmese|myanmar|mongolian|mongolia|singapore|singaporean|anime|enka|gamelan|opm|c-pop|v-pop|m-pop|balinese|javanese|borneo|bisaya|visayan|tausug|chamorro|kazakh|kyrgyz|uzbek|tajik|turkmen|central-asian)\b/,
  },
  {
    id: 'southasia',
    label: 'South Asian',
    pattern:
      /\b(indian|india|hindi|bollywood|tamil|telugu|kannada|malayalam|marathi|punjabi|bengali|bangla|gujarati|rajasthani|bhojpuri|assamese|oriya|odia|urdu|sanskrit|carnatic|hindustani|pakistani|pakistan|bangladeshi|bangladesh|sri-lankan|sinhala|nepali|nepal|bhutanese|bhutan|afghan|afghanistan|desi|bhajan|qawwali|ghazal|sufi|dhrupad|kirtan|thumri|chakma|adivasi|assam|bodo|garhwali|kumaoni|maithili|banjara|sindhi|dogri|konkani|tulu|haryanvi)\b/,
  },
  {
    id: 'mena',
    label: 'Middle East & North Africa',
    pattern:
      /\b(arabic|arab|egyptian|egypt|moroccan|morocco|algerian|algeria|tunisian|tunisia|libyan|libya|sudanese|sudan|lebanese|lebanon|syrian|syria|palestinian|palestine|iraqi|iraq|iranian|iran|persian|farsi|kurdish|kurdistan|turkish|turkey|anadolu|israeli|israel|hebrew|yiddish|mizrahi|sephardic|assyrian|armenian|armenia|azeri|azerbaijan|georgian|georgia|saudi|emirati|kuwaiti|bahraini|qatari|yemeni|omani|rai|arabesk|aghani|adhan|maqam|chaabi|dabke|dabkeh)\b/,
  },
  {
    id: 'africa',
    label: 'Sub-Saharan African',
    pattern:
      /\b(african|afrikaans|south-african|afrikaner|zulu|xhosa|sotho|tswana|swazi|venda|kwaito|amapiano|bongo-flava|hausa|yoruba|igbo|nigerian|nigeria|afrobeats|afrobeat|highlife|ghanaian|ghana|kenyan|kenya|tanzanian|tanzania|ugandan|uganda|ethiopian|ethiopia|ethio|eritrean|eritrea|somali|somalia|congolese|congo|soukous|lingala|angolan|angola|kuduro|senegalese|senegal|mbalax|malian|mali|cameroonian|cameroon|makossa|ivorian|cote-divoire|coupe-decale|zouk|zimbabwean|zimbabwe|chimurenga|mozambican|mozambique|marrabenta|namibian|namibia|botswana|rwandan|rwanda|burkinabe|burkina|beninese|benin|liberian|liberia|zambian|zambia|malagasy|madagascar|cape-verdean|cape-verde|morna|gqom|shangaan|pygmy|afro-fusion|afro-cuban|afro-psych|afro-soul|afro-funk|afrofuturism|afrofuturismo|chad|gabon|mauritian|mauritius|sesotho|twi|ewe|wolof)\b/,
  },
  {
    id: 'oceania',
    label: 'Australia, NZ & Pacific',
    pattern:
      /\b(australian|aussie|sydney|melbourne|perth|adelaide|canberra|hobart|tasmanian|new-zealand|nz|kiwi|auckland|wellington|christchurch|polynesian|hawaiian|maori|samoan|tongan|fijian|papuan|micronesian|torres-strait|aboriginal|indigenous-australian)\b/,
  },
]

// ── Per-cluster style dictionaries ────────────────────────────────────────
// Keys are the cluster id. Patterns are tested in order — first match wins.
// Buckets are designed to be mostly orthogonal; when that fails, order gives
// the correct precedence.

export const CLUSTER_STYLES: Record<string, KeywordBucket[]> = {
  // ═══════════════════════════════════════════════════════════════════════
  // ROCK
  // ═══════════════════════════════════════════════════════════════════════

  CLUSTER_rock_indie: [
    { id: 'altrock', label: 'Alternative Rock', pattern: /\b(alternative-rock|alternative-pop-rock|alt-rock|alt-country|alternative-country|alt-metal|alternative-metal|alt-z|alt-pop|alternative-pop|alternative-dance|alternative-hip-hop|alternative-emo|alternative-r-b|mainstream|mainstream-rock|modern-rock)\b/ },
    { id: 'dream', label: 'Dream Pop & Shoegaze', pattern: /\b(dream-pop|dreampop|shoegaze|ethereal|chillwave)\b/ },
    { id: 'jangle', label: 'Jangle, Slacker & Twee', pattern: /\b(jangle|twee|slacker|midwest-emo)\b/ },
    { id: 'noise', label: 'Noise & Fuzz', pattern: /\b(noise-pop|noise-rock|fuzz|math-rock)\b/ },
    { id: 'lofi', label: 'Lo-Fi & Bedroom', pattern: /\b(lo.?fi|bedroom|diy)\b/ },
    { id: 'garage', label: 'Garage & Surf', pattern: /\b(garage|surf)\b/ },
    { id: 'ukirish', label: 'UK & Irish Indie', pattern: /\b(british-indie|uk-indie|london-indie|manchester-indie|glasgow-indie|liverpool-indie|bristol-indie|sheffield-indie|leeds-indie|brit-pop|britpop|madchester|irish-indie|dublin-indie)\b/ },
    { id: 'ausnz', label: 'Australia & NZ Indie', pattern: /\b(australian-indie|australian-alternative|aussie|melbourne-indie|sydney-indie|perth-indie|brisbane-indie|adelaide-indie|auckland-indie|nz-indie|new-zealand)\b/ },
    { id: 'latinindie', label: 'Latin Indie', pattern: /\b(argentine-indie|brazilian-indie|brasileiro|chilean-indie|colombian-indie|mexican-indie|peruvian-indie|uruguayan-indie|venezuelan-indie|puerto-rican-indie|latin-indie|latin-alternative|rock-en-espanol|indie-latino)\b/ },
    { id: 'euindie', label: 'European Indie', pattern: /\b(french-indie|german-indie|spanish-indie|italian-indie|dutch-indie|belgian-indie|swedish-indie|norwegian-indie|finnish-indie|danish-indie|icelandic-indie|polish-indie|czech-indie|austrian-indie|swiss-indie|portuguese-indie|greek-indie|russian-indie|bulgarian-indie|balkan-indie|european-indie|chanson)\b/ },
    { id: 'asianindie', label: 'Asian Indie', pattern: /\b(japanese-indie|korean-indie|chinese-indie|mandarin-indie|taiwanese-indie|indonesian-indie|thai-indie|filipino-indie|indian-indie|bangla-indie|pakistani-indie|vietnam|malaysia|singapore|bangalore|mumbai|delhi|hindi-indie|tamil-indie)\b/ },
    { id: 'africanindie', label: 'African & Middle East Indie', pattern: /\b(south-african-indie|nigerian-indie|kenyan-indie|ghanaian-indie|ethiopian-indie|moroccan-indie|egyptian-indie|israeli-indie|lebanese-indie|turkish-indie|iranian-indie|arab-indie|african-indie|middle-east-indie)\b/ },
    { id: 'usindie', label: 'US Indie (regional)', pattern: /\b(indie|indie-rock|indie-pop|indie-folk)\b/ },
  ],

  CLUSTER_rock_punk: [
    { id: 'emo', label: 'Emo & Screamo', pattern: /\b(emo|screamo|emocore|post-emo|midwest-emo)\b/ },
    { id: 'hardcore', label: 'Hardcore & Post-Hardcore', pattern: /\b(hardcore|post-hardcore|metalcore|mathcore|grindcore-punk|powerviolence|crust|crust-punk|d-beat|dbeat)\b/ },
    { id: 'postpunk', label: 'Post-Punk & Darkwave', pattern: /\b(post-punk|postpunk|gothic-punk|goth|dark-wave|darkwave|death-rock|deathrock|no-wave|cold-wave|coldwave)\b/ },
    { id: 'poppunk', label: 'Pop-Punk & Ska-Punk', pattern: /\b(pop-punk|poppunk|ska-punk|skate-punk|power-pop-punk)\b/ },
    { id: 'oipunk', label: 'Oi! & Street Punk', pattern: /\b(oi|street-punk|streetpunk|uk-punk|uk82|anarcho|anarcho-punk)\b/ },
    { id: 'artpunk', label: 'Art Punk & Experimental', pattern: /\b(art-punk|artpunk|experimental-punk|digital-hardcore|noise-punk)\b/ },
    { id: 'regionalpunk', label: 'Regional Punk (non-US)', pattern: /\b(japanese-punk|brazilian-punk|argentine-punk|german-punk|french-punk|spanish-punk|italian-punk|polish-punk|russian-punk|mexican-punk|australian-punk|chilean-punk|finnish-punk|swedish-punk|czsk-punk|czech-punk|chinese-punk|korean-punk|indonesian-punk)\b/ },
  ],

  ANCHOR_rock_OTHER: [
    { id: 'classic', label: 'Classic, Blues & Southern Rock', pattern: /\b(classic-rock|album-rock|southern-rock|heartland|blues-rock|country-rock|roots-rock|rockabilly|psychedelic-rock|psych-rock|acid-rock)\b/ },
    { id: 'hard', label: 'Hard Rock & Glam', pattern: /\b(hard-rock|glam-rock|glam|arena-rock|stadium)\b/ },
    { id: 'progmath', label: 'Progressive, Math & Art', pattern: /\b(prog|progressive-rock|math-rock|art-rock|post-rock|space-rock|krautrock|avant-rock)\b/ },
    { id: 'dark', label: 'Dark & Doom-Adjacent', pattern: /\b(dark-rock|drone-rock|doom|gothic-rock|deathrock|death-rock|stoner|sludge-rock)\b/ },
    { id: 'folkrock', label: 'Folk, Acoustic & Americana', pattern: /\b(folk-rock|acoustic-rock|roots-rock|alternative-roots-rock|flute-rock|americana-rock)\b/ },
    { id: 'dancecross', label: 'Dance, Electronic & Pop-Rock Crossovers', pattern: /\b(dance-rock|electronic-rock|synth-rock|pop-rock|soft-rock|deep-soft-rock|deep-active-rock)\b/ },
    { id: 'christian', label: 'Christian & Comedy', pattern: /\b(christian-rock|comedy-rock|beatlesque)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // POP
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_pop_OTHER: [
    { id: 'boyband', label: 'Boy Bands, Girl Groups & Idol', pattern: /\b(boy-band|boy-pop|girl-group|girlgroup|idol|idol-pop|alt-idol|jpop-idol|kpop-idol|c-pop-girl-group)\b/ },
    { id: 'synth', label: 'Synthpop & Electropop', pattern: /\b(synth-pop|synthpop|electropop|electro-pop|synthwave-pop)\b/ },
    { id: 'bubble', label: 'Bubblegum, Candy & Dance-Pop', pattern: /\b(bubblegum|candy-pop|dance-pop|euro-pop|europop|eurodance|teen-pop|tween-pop)\b/ },
    { id: 'acoustic', label: 'Acoustic & Chill Pop', pattern: /\b(acoustic-pop|chill-pop|soft-pop|indie-pop|bedroom-pop)\b/ },
    { id: 'chart', label: 'Chart, Viral & Modern Pop', pattern: /\b(antiviral-pop|viral-pop|tiktok-pop|modern-pop|deep-pop|pop-hits|pop-era)\b/ },
    { id: 'traditional', label: 'Traditional & Classic Pop', pattern: /\b(brill-building|classic-pop|traditional-pop|adult-contemporary|adult-standards|vocal-pop|chasidic-pop|brass-band-pop)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // HIP-HOP
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_hiphop_OTHER: [
    { id: 'battle', label: 'Battle, Conscious & Boom-Bap', pattern: /\b(battle-rap|conscious|boom-bap|boombap|golden-age|underground-hip-hop|jazz-rap|abstract-hip-hop|aesthetic-rap)\b/ },
    { id: 'eastcoast', label: 'US East Coast', pattern: /\b(new-york|nyc|bronx|brooklyn|queens|staten-island|harlem|boston-hip-hop|philly|philadelphia|dc-hip-hop|baltimore|jersey|new-jersey|buffalo|connecticut|providence|maine-hip-hop|east-coast)\b/ },
    { id: 'south', label: 'US South', pattern: /\b(atlanta|atl-hip-hop|atl-trap|houston|memphis|nashville|florida|miami|new-orleans|baton-rouge|louisiana|alabama|arkansas|mississippi|tennessee|georgia|texas|southern-hip-hop|dirty-south|crunk)\b/ },
    { id: 'westcoast', label: 'US West Coast', pattern: /\b(la-rap|los-angeles|san-francisco|bay-area|oakland|sacramento|san-diego|san-jose|seattle|portland|oregon|nevada|phoenix|arizona|denver|colorado|nm|new-mexico|hawaii|hyphy|g-funk|gangsta|west-coast)\b/ },
    { id: 'midwest', label: 'US Midwest', pattern: /\b(chicago|detroit|milwaukee|minneapolis|st-louis|kansas-city|cleveland|cincinnati|indianapolis|columbus|ohio|iowa|michigan|wisconsin|midwest)\b/ },
    { id: 'canadian', label: 'Canadian', pattern: /\b(canadian|toronto|montreal|vancouver|quebec|alberta|atlantic-canada|calgary|ottawa)\b/ },
    { id: 'uk', label: 'UK (Grime & Drill)', pattern: /\b(uk-hip-hop|uk-rap|uk-drill|grime|london-rap|london-hip-hop|birmingham-grime|manchester-rap)\b/ },
    { id: 'europe', label: 'European', pattern: /\b(french-rap|french-hip-hop|german-rap|german-hip-hop|bayerischer-rap|italian-rap|italian-hip-hop|spanish-rap|spanish-hip-hop|dutch-rap|belgian-hip-hop|swiss-rap|swedish-rap|norwegian-rap|danish-rap|finnish-rap|polish-rap|czech-rap|slovak-rap|russian-rap|ukrainian-rap|greek-rap|portuguese-rap|albanian-hip-hop|bosnian-rap|romanian-rap|serbian-rap|croatian-rap|hungarian-rap|bulgarian-hip-hop|balkan-hip-hop|belgian-rap|austrian-rap)\b/ },
    { id: 'latin', label: 'Latin American', pattern: /\b(latin-hip-hop|latin-rap|mexican-rap|argentine-hip-hop|brazilian-hip-hop|chilean-hip-hop|colombian-hip-hop|peruvian-hip-hop|venezuelan-hip-hop|puertoriqueno|puerto-rican-rap|cuban-hip-hop|dominican-rap|rap-latino|rap-mexicano|rap-argentino|trap-latino)\b/ },
    { id: 'asia', label: 'Asian', pattern: /\b(japanese-hip-hop|j-rap|korean-hip-hop|k-rap|chinese-hip-hop|mandarin-rap|cantonese-rap|taiwanese-rap|thai-hip-hop|vietnamese-rap|indonesian-hip-hop|filipino-rap|tagalog-rap|bisaya-rap|indian-hip-hop|desi-hip-hop|hindi-rap|tamil-rap|bengali-rap|urdu-rap|bangladeshi-hip-hop|pakistani-rap|asian-american-hip-hop|assamese-hip-hop|anime-rap)\b/ },
    { id: 'africa', label: 'African & MENA', pattern: /\b(african-hip-hop|south-african-hip-hop|nigerian-hip-hop|kenyan-hip-hop|ghanaian-hip-hop|afrobeat-rap|arab-rap|arabic-rap|egyptian-rap|moroccan-rap|tunisian-rap|algerian-rap|lebanese-rap|palestinian-rap|turkish-rap|iranian-rap|persian-rap|israeli-rap|hebrew-rap|cameroonian-hip-hop|botswana-hip-hop|afrikaans-hip-hop)\b/ },
    { id: 'oceania', label: 'Australia & NZ', pattern: /\b(australian-hip-hop|aussie-hip-hop|brisbane-hip-hop|sydney-hip-hop|melbourne-hip-hop|nz-hip-hop|new-zealand-hip-hop|aboriginal-hip-hop|australian-indigenous-hip-hop)\b/ },
  ],

  CLUSTER_hiphop_trap: [
    { id: 'drill', label: 'Drill', pattern: /\b(drill)\b/ },
    { id: 'phonk', label: 'Phonk', pattern: /\b(phonk)\b/ },
    { id: 'plugg', label: 'Plugg & Dream Plugg', pattern: /\b(plugg|pluggnb)\b/ },
    { id: 'ustrap', label: 'US Trap (regional)', pattern: /\b(atl-trap|memphis-trap|florida-trap|detroit-trap|houston-trap|southern-trap|dark-trap|trap-metal|crunk|crunkcore|trap-soul|trap-beat)\b/ },
    { id: 'international', label: 'International Trap', pattern: /\b(latin-trap|trap-latino|trap-argentino|trap-brasileiro|trap-mexicano|brazilian-trap|arab-trap|desi-trap|asian-trap|african-trap|balkan-trap|bulgarian-trap|czech-trap|french-trap|german-trap|italian-trap|spanish-trap|russian-trap|japanese-trap|korean-trap|chinese-trap|thai-trap|aussie-trap|australian-trap|canadian-trap|uk-trap|k-trap|j-trap)\b/ },
    { id: 'chill', label: 'Chill & Christian', pattern: /\b(chill-drill|chill-phonk|chill-trap|christian-trap|christian-drill)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // R&B / SOUL
  // ═══════════════════════════════════════════════════════════════════════

  CLUSTER_rnb_gospel: [
    { id: 'doowop', label: 'Doo-Wop & Vocal Harmony', pattern: /\b(doo-wop|doowop|vocal-harmony|close-harmony|barbershop|acapella)\b/ },
    { id: 'contemp', label: 'Contemporary Gospel & Praise', pattern: /\b(contemporary-gospel|urban-gospel|modern-gospel|praise|worship|ccm|contemporary-christian|christian-r-b|christian-soul|praise-music|worship-music|gospel-r-b)\b/ },
    { id: 'traditional', label: 'Traditional & Southern Gospel', pattern: /\b(traditional-gospel|southern-gospel|black-gospel|gospel-blues|spiritual|negro-spiritual|gospel-quartet|quartet-gospel)\b/ },
    { id: 'regional', label: 'Regional Gospel', pattern: /\b(brazilian-gospel|louvor|adoracion|adoracao|nigerian-gospel|ghanaian-gospel|south-african-gospel|latin-gospel|spanish-gospel|portuguese-gospel|french-gospel|korean-gospel|japanese-gospel)\b/ },
  ],

  CLUSTER_rnb_contemporary: [
    { id: 'neosoul', label: 'Neo-Soul & Alternative R&B', pattern: /\b(neo-soul|neosoul|alt-r-b|alternative-r-b|alternative-rnb|indie-r-b|bedroom-soul)\b/ },
    { id: 'pbrb', label: 'PBR&B & Modern Slow Jams', pattern: /\b(pbr-b|pbrb|modern-r-b|smooth-r-b|slow-jam|slowjam|r-b-urbano)\b/ },
    { id: 'international', label: 'International R&B', pattern: /\b(korean-r-b|k-r-b|japanese-r-b|j-r-b|chinese-r-b|afro-r-b|afro-fusion|uk-r-b|french-r-b|spanish-r-b|latin-r-b|brazilian-r-b|bulgarian-r-b|afrikaans-r-b)\b/ },
  ],

  CLUSTER_rnb_funk: [
    { id: 'psych', label: 'Psychedelic & Afro-Funk', pattern: /\b(psychedelic-funk|psych-funk|afro-funk|afrobeat|afrobeat-funk|boogie-funk|p-funk|parliament-funk)\b/ },
    { id: 'g-funk', label: 'G-Funk & Electro-Funk', pattern: /\b(g-funk|gfunk|electro-funk|boogie|modern-funk|funk-carioca|miami-funk)\b/ },
    { id: 'international', label: 'International Funk', pattern: /\b(brazilian-funk|funk-brasileiro|funk-carioca|funk-mtg|french-funk|japanese-funk|korean-funk|german-funk|uk-funk|italian-funk|latin-funk|cumbia-funk)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // ELECTRONIC
  // ═══════════════════════════════════════════════════════════════════════

  CLUSTER_electronic_house: [
    { id: 'deephouse', label: 'Deep & Soulful House', pattern: /\b(deep-house|deep-deep-house|deep-tech-house|deep-vocal-house|deep-euro-house|deep-groove-house|deep-progressive-house|deep-deep-tech-house|soulful-house|vocal-house)\b/ },
    { id: 'tech', label: 'Tech & Progressive House', pattern: /\b(tech-house|deep-tech|progressive-house|classic-progressive-house|dark-progressive-house|funky-tech-house|minimal-tech|dutch-tech-house|mexican-tech-house)\b/ },
    { id: 'acid', label: 'Acid, Filter & Classic House', pattern: /\b(acid-house|classic-house|filter-house|chicago-house|detroit-house|french-house|nu-disco)\b/ },
    { id: 'future', label: 'Future, Bass & Electro House', pattern: /\b(future-house|bass-house|electro-house|fidget-house|diva-house|hard-house|g-house|dutch-house)\b/ },
    { id: 'afro', label: 'Afro & Tribal House', pattern: /\b(afro-house|tribal-house|bolobedu-house|amapiano|gqom|kwaito-house)\b/ },
    { id: 'chill', label: 'Chill, Lo-Fi & Beach House', pattern: /\b(chill-house|lo-fi-house|beach-house|ambient-house|float-house|jazz-house)\b/ },
  ],

  ANCHOR_electronic_OTHER: [
    { id: 'hardcore', label: 'Hardcore & Hardstyle', pattern: /\b(hardcore|hardstyle|happy-hardcore|gabber|speedcore|frenchcore|uptempo-hardcore|classic-hardstyle|rawstyle|makina)\b/ },
    { id: 'breakbeat', label: 'Breakbeat, Jungle & 2-Step', pattern: /\b(breakbeat|breaks|2-step|2step|nu-breaks|big-beat|jungle|broken-beat|atmospheric-jungle)\b/ },
    { id: 'idm', label: 'IDM & Experimental', pattern: /\b(idm|abstract-idm|acid-idm|glitch|braindance|electronica-experimental|experimental-electronic|microsound)\b/ },
    { id: 'synthwave', label: 'Synthwave & Darkwave', pattern: /\b(synthwave|synth-wave|darkwave|dark-synthpop|dark-wave|outrun|retrowave|cyberpunk|vaporwave|future-funk)\b/ },
    { id: 'chill', label: 'Chillout, Chillhop & Ambient-Adjacent', pattern: /\b(chillhop|chillstep|chillout|chill-wave|comfy-synth|downtempo-electronic|psychill)\b/ },
    { id: 'emodance', label: 'Emo & Hyperpop Adjacent', pattern: /\b(hyperpop|emoviolence|5th-wave-emo|crank-wave|czsk-hyperpop|digicore)\b/ },
    { id: 'posthardcore', label: 'Hardcore Punk / Post-Hardcore', pattern: /\b(hardcore-punk|post-hardcore|screamo-electronic|blackened-hardcore|chaotic-hardcore|powerviolence|deathcore-electronic)\b/ },
  ],

  CLUSTER_electronic_bass: [
    { id: 'dnb', label: 'Drum & Bass', pattern: /\b(drum-and-bass|dnb|d-n-b|liquid-dnb|neurofunk|jump-up|atmospheric-dnb|rollers|techstep)\b/ },
    { id: 'dubstep', label: 'Dubstep & Brostep', pattern: /\b(dubstep|brostep|riddim|melodic-dubstep|chillstep|future-riddim)\b/ },
    { id: 'jungle', label: 'Jungle & Breakbeat', pattern: /\b(jungle|ragga-jungle|oldschool-jungle|breakbeat|breaks)\b/ },
    { id: 'garage', label: 'UK Garage & 2-Step', pattern: /\b(uk-garage|garage|2-step|2step|future-garage|bassline)\b/ },
  ],

  CLUSTER_electronic_techno: [
    { id: 'minimal', label: 'Minimal, Dub & Detroit', pattern: /\b(minimal-techno|minimal|detroit-techno|dub-techno|ambient-techno)\b/ },
    { id: 'industrial', label: 'Industrial & Acid Techno', pattern: /\b(industrial-techno|acid-techno|schranz|hard-techno|peak-time-techno)\b/ },
    { id: 'melodic', label: 'Melodic & Progressive', pattern: /\b(melodic-techno|progressive-techno|tech-trance)\b/ },
    { id: 'regional', label: 'Regional Techno', pattern: /\b(berlin-techno|german-techno|dutch-techno|french-techno|uk-techno|japanese-techno|brazilian-techno|mexican-techno)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // JAZZ
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_jazz_OTHER: [
    { id: 'smooth', label: 'Smooth, Chill & Lounge', pattern: /\b(smooth-jazz|deep-smooth-jazz|chill-lounge|lounge|dinner-jazz|deep-sunset-lounge|background-jazz|adult-standards|deep-adult-standards|easy-listening|dinner)\b/ },
    { id: 'vocal', label: 'Vocal & Standards', pattern: /\b(vocal-jazz|vocal-standards|contemporary-vocal-jazz|deep-vocal-jazz|jazz-vocal|ballad-jazz|big-band-vocal)\b/ },
    { id: 'contemporary', label: 'Contemporary & Modern', pattern: /\b(contemporary-jazz|modern-jazz|nu-jazz|deep-modern-jazz|ecm-style-jazz|jazz-fusion|post-bop)\b/ },
    { id: 'dark', label: 'Dark, Experimental & Electro', pattern: /\b(dark-jazz|electro-jazz|experimental-jazz|jazz-funk|jazz-electronica|acid-jazz|broken-beat-jazz)\b/ },
    { id: 'international', label: 'International Jazz', pattern: /\b(arabic-jazz|argentine-jazz|australian-jazz|austrian-jazz|belgian-jazz|brazilian|british-jazz|canadian|chinese-jazz|czech-jazz|danish|dutch-jazz|ethio-jazz|estonian-jazz|finnish-jazz|french-jazz|galician-jazz|german-jazz|greek-jazz|italian-jazz|japanese-jazz|korean-jazz|norwegian-jazz|polish-jazz|portuguese-jazz|russian-jazz|spanish-jazz|swedish-jazz|swiss-jazz|turkish-jazz|ukrainian-jazz|moroccan-jazz|south-african-jazz|indian-jazz)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // CLASSICAL
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_classical_OTHER: [
    { id: 'piano', label: 'Piano', pattern: /\b(classical-piano|piano|piano-ensemble|piano-duo|piano-trio|anime-piano|background-piano|barrelhouse-piano)\b/ },
    { id: 'strings', label: 'Strings & Chamber', pattern: /\b(cello|violin|viola|string-quartet|string-ensemble|chamber|classical-bass|classical-contrabass|harp|classical-harp|guitar-ensemble|classical-guitar|classical-guitar-duo)\b/ },
    { id: 'winds', label: 'Woodwinds & Brass', pattern: /\b(flute|classical-flute|clarinet|classical-clarinet|oboe|bassoon|classical-bassoon|saxophone|classical-saxophone|trumpet|classical-trumpet|trombone|french-horn|tuba|brass-ensemble|band-organ)\b/ },
    { id: 'vocal', label: 'Choral & Vocal', pattern: /\b(choral|choir|classical-baritone|classical-bass-voice|classical-contralto|classical-countertenor|classical-soprano|classical-tenor|classical-mezzo|opera-vocal|american-choir)\b/ },
    { id: 'era', label: 'Era & Movement', pattern: /\b(classical-era|classical-period|21st-century-classical|american-21st-century-classical|early-music|baroque|renaissance|romantic-era|modern-classical|contemporary-classical|classical-drill|avant-garde-classical|minimalism-classical)\b/ },
    { id: 'international', label: 'International Classical', pattern: /\b(african-american-classical|australian-classical|austrian-classical|baltic-classical|belgian-classical|brazilian-classical|british-classical|canadian-classical|caucasian-classical|chinese-classical|czech-classical|danish-classical|dutch-classical|finnish-classical|french-classical|german-classical|greek-classical|hungarian-classical|indian-classical|italian-classical|japanese-classical|korean-classical|norwegian-classical|polish-classical|portuguese-classical|russian-classical|spanish-classical|swedish-classical|swiss-classical|turkish-classical|ukrainian-classical|andalusian-classical|israeli-classical|arab-classical)\b/ },
  ],

  CLUSTER_classical_modern: [
    { id: 'minimalism', label: 'Minimalism & Ambient-Classical', pattern: /\b(minimalism|minimalist|neoclassical|neo-classical|ambient-classical|drone-classical|post-minimalism)\b/ },
    { id: 'avantgarde', label: 'Avant-Garde & Experimental', pattern: /\b(avant-garde|avantgarde|experimental-classical|spectral|serial|electroacoustic|musique-concrete)\b/ },
    { id: 'filmgame', label: 'Film, Game & TV Score', pattern: /\b(film-score|film-music|cinematic|soundtrack|game-score|game-soundtrack|tv-score|anime-score|trailer-music|epic-orchestral)\b/ },
    { id: 'international', label: 'International Modern', pattern: /\b(21st-century-classical|american-21st-century|british-contemporary|european-contemporary|contemporary-classical|modern-classical)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // METAL
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_metal_OTHER: [
    { id: 'subgenres', label: 'Niche Metal Sub-Genres', pattern: /\b(avant-garde-metal|drone-metal|sludge-metal|stoner-metal|doom-metal|gothic-metal|atmospheric-metal|post-metal|cyber-metal|dub-metal|industrial-metal|nu-metal|rap-metal|groove-metal|thrash-metal|speed-metal|power-metal|symphonic-metal|melodic-metal|folk-metal|viking-metal|pagan-metal|celtic-metal|medieval-metal|pirate-metal|comic-metal|christian-metal|christian-symphonic-metal|djent|progressive-metal|prog-metal|death-n-roll|mathcore-metal|deathcore|grindcore-metal|blackened-metal|depressive-metal)\b/ },
    { id: 'regional', label: 'Regional Metal', pattern: /\b(african-metal|arab-metal|argentine-metal|armenian-metal|australian-metal|austrian-metal|belarusian-metal|belgian-metal|bolivian-metal|brazilian-metal|bulgarian-metal|canadian-metal|caribbean-metal|celtic-metal|central-american-metal|chilean-metal|chinese-metal|croatian-metal|cypriot-metal|czech-metal|czsk-metal|danish-metal|dutch-metal|finnish-metal|french-metal|german-metal|greek-metal|hungarian-metal|indonesian-metal|iranian-metal|irish-metal|israeli-metal|italian-metal|japanese-metal|korean-metal|malaysian-metal|mexican-metal|moroccan-metal|norwegian-metal|peruvian-metal|polish-metal|portuguese-metal|romanian-metal|russian-metal|serbian-metal|slovenian-metal|south-african-metal|spanish-metal|swedish-metal|swiss-metal|thai-metal|turkish-metal|ukrainian-metal|venezuelan-metal|balkan-folk-metal|deep-folk-metal|regional-metal)\b/ },
    { id: 'uscity', label: 'US Cities & Regional', pattern: /\b(alabama-metal|arkansas-metal|atlanta-metal|austin-metal|birmingham-metal|boston-metal|buffalo-ny-metal|chicago-metal|cleveland-metal|denver-metal|detroit-metal|florida-metal|houston-metal|la-metal|memphis-metal|miami-metal|nashville-metal|new-york-metal|nyc-metal|ohio-metal|philly-metal|philadelphia-metal|phoenix-metal|pittsburgh-metal|portland-metal|richmond-metal|san-francisco-metal|seattle-metal|st-louis-metal|texas-metal|washington-metal)\b/ },
  ],

  CLUSTER_metal_black: [
    { id: 'atmospheric', label: 'Atmospheric & Post-Black Metal', pattern: /\b(atmospheric-black-metal|post-black-metal|ambient-black-metal|cosmic-black-metal|blackgaze|cascadian-black-metal|forest-black-metal|shoegaze-black-metal)\b/ },
    { id: 'symphonic', label: 'Symphonic & Epic Black Metal', pattern: /\b(symphonic-black-metal|deep-symphonic-black-metal|epic-black-metal|melodic-black-metal|gothic-black-metal)\b/ },
    { id: 'raw', label: 'Raw, Depressive & Dark', pattern: /\b(raw-black-metal|depressive-black-metal|suicidal-black-metal|dsbm|dark-black-metal|chaotic-black-metal|emotional-black-metal|cryptic-black-metal)\b/ },
    { id: 'folkpagan', label: 'Folk, Pagan & Viking Black Metal', pattern: /\b(folk-black-metal|pagan-black-metal|viking-black-metal|celtic-black-metal|medieval-black-metal|german-pagan-metal)\b/ },
    { id: 'experimental', label: 'Avant-Garde & Experimental', pattern: /\b(avant-garde-black-metal|experimental-black-metal|autonomous-black-metal)\b/ },
    { id: 'regional', label: 'Regional Black Metal', pattern: /\b(appalachian|australian|austrian|baltic|belgian|brazilian|british|canadian|chilean|chinese|colombian|czsk|danish|dutch|finnish|french|german|greek|hungarian|argentino)-black-metal\b/ },
  ],

  CLUSTER_metal_death: [
    { id: 'grind', label: 'Grindcore & Goregrind', pattern: /\b(grindcore|goregrind|deathgrind|powerviolence|mincecore|crustgrind)\b/ },
    { id: 'deathcore', label: 'Deathcore', pattern: /\b(deathcore|blackened-deathcore|brutal-deathcore|downtempo-deathcore|christian-deathcore)\b/ },
    { id: 'brutal', label: 'Brutal & Slam Death Metal', pattern: /\b(brutal-death-metal|slam-death|slamming-death|cavernous-death-metal|deep-brutal-death|grisly-death-metal|grim-death-metal)\b/ },
    { id: 'melodic', label: 'Melodic & Technical', pattern: /\b(melodic-death-metal|deep-melodic-death-metal|technical-death-metal|tech-death|progressive-death-metal|dissonant-death-metal)\b/ },
    { id: 'cosmicinstrumental', label: 'Cosmic, Instrumental & Christian', pattern: /\b(cosmic-death-metal|instrumental-death-metal|christian-death-metal)\b/ },
    { id: 'regional', label: 'Regional Death Metal', pattern: /\b(australian|belgian|brazilian|british|canadian|colombian|danish|dutch|finnish|florida|french|german|indonesian|irish|italian|japanese)-death-metal\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // FOLK
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_folk_OTHER: [
    { id: 'styles', label: 'Styles & Sub-Genres', pattern: /\b(folk|folk-pop|folk-rock|indie-folk|anti-folk|free-folk|dark-folk|ambient-folk|alternative-roots-rock|americana|bluegrass|old-time|appalachian|early-american-folk)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // COUNTRY
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_country_OTHER: [
    { id: 'classic', label: 'Classic, Outlaw & Honky-Tonk', pattern: /\b(classic-country|outlaw-country|honky-tonk|traditional-country|neotraditional-country|bakersfield)\b/ },
    { id: 'alt', label: 'Alt-Country & Americana', pattern: /\b(alt-country|alternative-country|americana|country-rock|cosmic-country|red-dirt|insurgent-country|gothic-country)\b/ },
    { id: 'modern', label: 'Modern & Pop Country', pattern: /\b(country-pop|contemporary-country|modern-country|bro-country|country-rap|country-trap|country-road|chart-country)\b/ },
    { id: 'international', label: 'International Country', pattern: /\b(australian-country|canadian-country|british-country|brazilian-country|mexican-country|european-country|international-country|japanese-country|argentine-country)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // WORLD
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_world_OTHER: [
    {
      id: 'afrofusion',
      label: 'Afro-Fusion (R&B / Psych / Funk)',
      pattern: /\b(afro-r-b|afro-soul|afro-psych|afro-funk|afrofuturism|afrofuturismo|afrofuturismo-brasileiro|afroswing|afro-fusion)\b/,
    },
    { id: 'religious', label: 'Religious & Devotional', pattern: /\b(bhajan|adoracao|adoracion|adoracion-pentecostal|qawwali|sufi|gospel-dub|devotional|kirtan|chasidic|bhutanese-pop|spiritual-world)\b/ },
    { id: 'afrocuban', label: 'Afro-Cuban & Afro-Caribbean', pattern: /\b(afro-cuban|afrocuban|afro-caribbean|bomba|bomba-y-plena|plena|rumba-cubana|timba|son-cubano)\b/ },
    { id: 'regional-scene', label: 'Regional Scenes (rock/indie/pop/punk in specific countries)', pattern: /\b(argentine-(alternative|ambient|hardcore|indie|indie-rock|punk|telepop|rock)|armenian-(folk|indie|pop)|bolivian-rock|bosnian-(electronic|indie|pop)|bulgarian-(electronic|folk|indie|pop|r-b|rock)|azeri-traditional|bhutanese-pop)\b/ },
  ],

  CLUSTER_world_europe: [
    { id: 'balkanic', label: 'Balkan & Greek', pattern: /\b(balkan|bulgarian|greek|albanian|serbian|croatian|bosnian|macedonian|montenegrin|romanian|moldovan|kosovar|rebetiko|klapa|sevdalinka|chalga)\b/ },
    { id: 'celtic', label: 'Celtic & British Isles Folk', pattern: /\b(celtic|celtic-punk|celtic-rock|celtic-harp|irish|scottish|welsh|english-folk|british-folk|manx|cornish|breton|gaelic)\b/ },
    { id: 'francophone', label: 'Francophone', pattern: /\b(chanson|chanson-humoristique|chanson-paillarde|chanson-quebecois|chanson-virale|francophone|french-folk|walloon|belgian-chanson|acadian|cajun-french)\b/ },
    { id: 'iberian', label: 'Iberian & Mediterranean', pattern: /\b(flamenco|cante-flamenco|portuguese-fado|fado|galician|iberian|canarian|basque|euskal|catalan|occitan|corsican|sicilian|mediterranean|italian-folk)\b/ },
    { id: 'slavic', label: 'Slavic, Baltic & Eastern European', pattern: /\b(polish|czech|slovak|czsk|ukrainian|belarusian|russian|baltic|estonian|latvian|lithuanian|hungarian|romani|gypsy|polka|mazurka|zydeco)\b/ },
    { id: 'nordic', label: 'Nordic & Scandinavian', pattern: /\b(swedish-folk|norwegian-folk|danish-folk|finnish-folk|icelandic-folk|nordic-folk|scandinavian|faroese|sami|joik|kalevala)\b/ },
    { id: 'germanic', label: 'Germanic & Alpine', pattern: /\b(german-folk|austrian-folk|swiss-folk|bavarian|alpine|volksmusik|schlager|tirolisch|yodel|alpenpanorama|appenzeller)\b/ },
    { id: 'classic', label: 'Classic European Pop & Rock', pattern: /\b(classic-bulgarian-pop|classic-czech-pop|classic-finnish-pop|classic-finnish-rock|classic-french-pop|classic-greek-pop|classic-greek-rock|classic-hungarian-pop|classic-hungarian-rock)\b/ },
  ],

  CLUSTER_world_east_asia: [
    { id: 'japan', label: 'Japan', pattern: /\b(japanese|j-pop|j-rock|j-rap|j-reggae|jpop|jrock|enka|anime|classic-anime|dessin-anime|cantabile)\b/ },
    { id: 'korea', label: 'Korea', pattern: /\b(korean|k-pop|k-rock|k-rap|k-indie|kpop|krock|classic-korean-pop)\b/ },
    { id: 'chinese', label: 'Chinese (Mandarin / Cantonese / Taiwanese)', pattern: /\b(chinese|china|mandarin|mandopop|cantonese|cantopop|classic-mandopop|classic-cantopop|taiwanese|hong-kong|c-pop|chinese-traditional)\b/ },
    { id: 'seasia', label: 'Southeast Asia', pattern: /\b(thai|thailand|classic-thai-pop|vietnamese|vietnam|indonesian|indonesia|balinese|javanese|gamelan|filipino|philippines|pinoy|tagalog|opm|malaysian|malaysia|singaporean|singapore|cambodian|cambodia|laotian|burmese|myanmar|bisaya)\b/ },
  ],

  CLUSTER_world_latin: [
    { id: 'cumbia', label: 'Cumbia', pattern: /\b(cumbia)\b/ },
    { id: 'banda', label: 'Banda, Norteño & Regional Mexican', pattern: /\b(banda|norteno|norteña|ranchera|mariachi|corrido|sierreno|grupera|grupero|tejano|regional-mexicano|chicano)\b/ },
    { id: 'bachatabolero', label: 'Bachata & Bolero', pattern: /\b(bachata|bolero)\b/ },
    { id: 'salsa', label: 'Salsa, Son & Timba', pattern: /\b(salsa|son-cubano|son|timba|rumba-cubana|montuno|pachanga|guaguanco)\b/ },
    { id: 'samba', label: 'Samba, Bossa & Brazilian Tropical', pattern: /\b(samba|bossa|bossa-nova|choro|pagode|axe|axé|mpb|frevo|maracatu|forro|forró|sertanejo|brazilian-traditional)\b/ },
    { id: 'tango', label: 'Tango, Milonga & Candombe', pattern: /\b(tango|milonga|candombe|nuevo-tango|argentine-folklore|zamba|chacarera|cuarteto)\b/ },
    { id: 'andean', label: 'Andean & Chilean Folklore', pattern: /\b(andean|andino|andina|chicha|huayno|nueva-cancion|folk-chileno|folklore)\b/ },
    { id: 'reggaeton', label: 'Reggaetón & Latin Urban (if miscategorised)', pattern: /\b(reggaeton|perreo|neoperreo|latin-trap|dembow|urbano)\b/ },
  ],

  CLUSTER_world_caribbean: [
    { id: 'reggae', label: 'Reggae (roots / dub / international)', pattern: /\b(reggae|dub-reggae|early-reggae|dub|dub-poetry|dub-punk|electro-dub|gospel-reggae|french-dub|french-reggae|german-reggae|african-reggae|argentine-reggae|chinese-reggae|czsk-reggae|euskal-reggae|finnish-reggae|indonesian-reggae|italian-reggae|j-reggae|japanese-dub|jamaican-dancehall|jamaican-ska)\b/ },
    { id: 'dancehall', label: 'Dancehall', pattern: /\b(dancehall)\b/ },
    { id: 'ska', label: 'Ska & Rocksteady', pattern: /\b(ska|rocksteady|two-tone|2-tone|trad-ska)\b/ },
    { id: 'soca', label: 'Soca & Calypso', pattern: /\b(soca|calypso|bajan-soca|grenada-soca|chutney|parang|rapso)\b/ },
    { id: 'zouk', label: 'Zouk, Kompa & French Caribbean', pattern: /\b(zouk|kompa|haitian-traditional|antillean|antilles|martinique|guadeloupe)\b/ },
  ],

  CLUSTER_world_brazil: [
    { id: 'samba', label: 'Samba, Bossa & Choro', pattern: /\b(samba|bossa|bossa-nova|choro|pagode|partido-alto)\b/ },
    { id: 'mpb', label: 'MPB & Tropicália', pattern: /\b(mpb|tropicalia|tropicália|música-popular-brasileira)\b/ },
    { id: 'forro', label: 'Forró, Baião & Sertanejo', pattern: /\b(forro|forró|baiao|baião|sertanejo|arrocha|piseiro|xote|vaqueiro)\b/ },
    { id: 'funkcarioca', label: 'Funk Carioca & Baile', pattern: /\b(funk-carioca|baile-funk|funk-brasileiro|funk-mtg|funk-ostentacao|funk-paulista|funk-proibidao)\b/ },
    { id: 'axe', label: 'Axé, Maracatu & Northeast Folk', pattern: /\b(axe|axé|maracatu|frevo|coco|xaxado|ciranda)\b/ },
  ],

  CLUSTER_world_african: [
    { id: 'west', label: 'West African', pattern: /\b(nigerian|afrobeats|afrobeat|highlife|juju|fuji|apala|yoruba|igbo|hausa|ghanaian|hiplife|azonto|azontobeats|bongo-flava|malian|wassoulou|griot|senegalese|mbalax|burkinabe|ivorian|coupe-decale|liberian|beninese|sierra-leone|gambian|cape-verdean|morna|coladeira|togolese|guinean)\b/ },
    { id: 'south', label: 'Southern African', pattern: /\b(south-african|zulu|xhosa|sotho|tswana|swazi|venda|afrikaans|afrikaner|kwaito|amapiano|gqom|shangaan|maskandi|mbaqanga|marabi|zimbabwean|chimurenga|jit|sungura|namibian|botswana|botswanan|batswana-traditional|mozambican|marrabenta|pandza|malagasy|malawian|zambian|angolan|kuduro|kizomba|semba)\b/ },
    { id: 'east', label: 'East African', pattern: /\b(kenyan|benga|genge|tanzanian|bongo-flava|swahili|singeli|ugandan|kadongo-kamu|ethiopian|ethio|eritrean|somali|rwandan|burundian|chad|sudanese|south-sudanese|comorian)\b/ },
    { id: 'central', label: 'Central African', pattern: /\b(congolese|congo|soukous|lingala|rumba-congolese|gabonese|gabon|cameroonian|makossa|bikutsi|central-african|pygmy|angolan)\b/ },
  ],

  CLUSTER_world_middle_east: [
    { id: 'arabic', label: 'Arabic Pop & Classical', pattern: /\b(arabic|arabic-pop|arab-pop|khaleeji|egyptian|shaabi|muwashshah|tarab|arabesk|lebanese|syrian|palestinian|iraqi|kuwaiti|saudi|emirati|moroccan|algerian|tunisian|maghreb|rai|chaabi|gnawa)\b/ },
    { id: 'persian', label: 'Persian, Turkish & Central Asian', pattern: /\b(persian|iranian|farsi|tajik|afghan|azerbaijani|azeri|uzbek|turkmen|kazakh|kyrgyz|turkish|anadolu|ottoman|sufi|qawwali|tasavvuf)\b/ },
    { id: 'jewish', label: 'Jewish & Israeli', pattern: /\b(mizrahi|sephardic|yiddish|klezmer|israeli|hebrew|hasidic|chasidic)\b/ },
    { id: 'levantine', label: 'Kurdish, Armenian & Levant Folk', pattern: /\b(kurdish|armenian|assyrian|aramaic|dabke|dabkeh|druze)\b/ },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // EXPERIMENTAL (the junk drawer — aggressive bucketing)
  // ═══════════════════════════════════════════════════════════════════════

  ANCHOR_experimental_OTHER: [
    { id: 'ambient', label: 'Ambient, Drone & Field', pattern: /\b(ambient|drone|field-recording|lowercase|dark-ambient|ambient-industrial|ambient-electronic|acousmatic|new-age|healing|meditation|binaural|432hz|528hz)\b/ },
    { id: 'chiptune', label: 'Chiptune, 8-bit & Video Game', pattern: /\b(8-bit|chiptune|chip|video-game|vgm|game-music|nintendocore|bitpop)\b/ },
    { id: 'industrial', label: 'Industrial, Noise & Power Electronics', pattern: /\b(industrial|power-electronics|harsh-noise|noise-experimental|death-industrial|rhythmic-noise|aggrotech|ebm|martial-industrial|neofolk)\b/ },
    { id: 'lofi', label: 'Lo-Fi, Chill & Study', pattern: /\b(lo.?fi|chillhop|chillstep|chill-beats|study-beats|jazzy-hip-hop|lofi-beats|lo-fi-beats|abstract-beats)\b/ },
    { id: 'vaporwave', label: 'Vaporwave, Mallsoft & Plunder', pattern: /\b(vaporwave|mallsoft|slushwave|future-funk|plunderphonics|hauntology)\b/ },
    { id: 'choral', label: 'Choral & Sacred', pattern: /\b(choral|choir|choral-experimental|sacred|liturgical|gregorian|plainsong|american-choir|adventista)\b/ },
    { id: 'folkInstrument', label: 'Niche Folk Instruments', pattern: /\b(accordion|accordeon|accordion-band|akordeon|alphorn|alpine|banjo|hurdy-gurdy|sitar|bagpipes|oud|zither|balalaika|koto|shamisen|tabla|dulcimer|harmonium|bandoneon|kora|djembe|erhu)\b/ },
    { id: 'regional-experimental', label: 'Regional Experimental', pattern: /\b(african-experimental|experimental-asian|european-experimental|latin-experimental|japanese-experimental|chinese-experimental|russian-experimental|nordic-experimental|indian-experimental)\b/ },
    { id: 'spoken', label: 'Spoken Word, Poetry & Comedy', pattern: /\b(spoken-word|poetry|comedy|stand-up|radio-play|audio-drama|audiobook|reading|sermon|asmr)\b/ },
    { id: 'christian', label: 'Christian Contemporary', pattern: /\b(christian|ccm|worship|praise|hillsong|bethel|adventista|hymn|hymns)\b/ },
    { id: 'kids', label: 'Kids, Educational & Novelty', pattern: /\b(kids|childrens|nursery|lullaby|educational|cartoon|novelty|parody|christmas|holiday)\b/ },
  ],
}

// ── Alphabetical fallback ────────────────────────────────────────────────
// Last resort for buckets that can't be split by keyword. Single-letter
// A-Z buckets (phonebook model) — 0-9 and "#" etc. funnel into A.

export const ALPHABETICAL_BUCKETS: KeywordBucket[] = [
  { id: 'a', label: 'A', pattern: /^[a0-9]/ },
  ...'bcdefghijklmnopqrstuvwxyz'.split('').map((ch) => ({
    id: ch,
    label: ch.toUpperCase(),
    pattern: new RegExp(`^${ch}`),
  })),
]

// ── Entry point the build script imports ──────────────────────────────────

/**
 * Resolve the keyword dictionary for a given parent id.
 *
 * Strategy (first match wins):
 *  1. Per-cluster dictionary if one is defined for this id exactly.
 *  2. For *_OTHER mega-buckets without style buckets, fall back to
 *     REGIONAL_BUCKETS so geography can split them.
 *  3. For SUBCLUSTER_ ids, use REGIONAL_BUCKETS as a second pass so
 *     recursive sub-splits work.
 */
export function keywordsFor(parentId: string): KeywordBucket[] | null {
  if (CLUSTER_STYLES[parentId]) return CLUSTER_STYLES[parentId]
  if (parentId.endsWith('_OTHER')) return REGIONAL_BUCKETS
  if (parentId.startsWith('SUBCLUSTER_')) {
    // Prevent infinite recursion: if the id already went through a
    // REGIONAL pass (i.e. its own id suffix is a regional-bucket id), hand
    // back null so the build script either tries ALPHABETICAL_BUCKETS or
    // accepts the bucket as-is.
    const regionalIds = REGIONAL_BUCKETS.map((b) => b.id)
    const lastSegment = parentId.split('_').pop() ?? ''
    if (regionalIds.includes(lastSegment)) return null
    return REGIONAL_BUCKETS
  }
  return null
}
