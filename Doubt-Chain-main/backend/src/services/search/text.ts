/**
 * Multilingual text utilities for Doubt-Chain search.
 *
 * Supported query languages: English, Hindi (Devanagari) and Hinglish
 * (romanised Hindi mixed with English technical vocabulary).
 *
 * The glossary below is deliberately explicit: it powers cross-language query
 * expansion for keyword retrieval and an English "gloss" appended to embedding
 * queries so that English-centric embedding models can still match Hindi and
 * Hinglish questions. It is a bridging aid, not a translation engine.
 */

export type QueryLanguage = 'en' | 'hi' | 'hinglish'

/** Romanised Hindi / Hinglish → English concepts. */
const HINGLISH_TO_ENGLISH: Record<string, string[]> = {
  kyu: ['why'],
  kyun: ['why'],
  kyon: ['why'],
  kya: ['what'],
  kaise: ['how'],
  kese: ['how'],
  kaisa: ['how'],
  kab: ['when'],
  kahan: ['where'],
  kaha: ['where'],
  kaun: ['who'],
  kon: ['who'],
  kitna: ['how many'],
  kitne: ['how many'],
  nahi: ['not'],
  nahin: ['not'],
  nai: ['not'],
  hai: ['is'],
  hain: ['is'],
  mera: ['my'],
  meri: ['my'],
  mere: ['my'],
  mujhe: ['me'],
  muje: ['me'],
  apna: ['own'],
  apni: ['own'],
  batao: ['tell', 'explain'],
  bata: ['tell', 'explain'],
  btao: ['tell', 'explain'],
  samajh: ['understand'],
  samjha: ['understand'],
  samjhao: ['explain', 'understand'],
  dikkat: ['problem', 'issue'],
  dikat: ['problem', 'issue'],
  samasya: ['problem', 'issue'],
  galti: ['error', 'mistake'],
  galat: ['wrong'],
  galati: ['error', 'mistake'],
  karo: ['do'],
  karna: ['do'],
  kar: ['do'],
  kaam: ['work'],
  kam: ['work'],
  chal: ['run'],
  chalraha: ['running', 'working'],
  chalrahi: ['running', 'working'],
  band: ['stop'],
  chahiye: ['need'],
  chaiye: ['need'],
  kyunki: ['because'],
  kyuki: ['because'],
  matlab: ['meaning'],
  udaharan: ['example'],
  udahran: ['example'],
  antar: ['difference'],
  farak: ['difference'],
  fark: ['difference'],
  sawal: ['question'],
  sawaal: ['question'],
  prashn: ['question'],
  jawab: ['answer'],
  javab: ['answer'],
  uttar: ['answer'],
  ruk: ['stop'],
  chalta: ['running', 'working'],
  hota: ['happens'],
  hoti: ['happens'],
  hua: ['happened'],
  ho: ['happen'],
  raha: ['happening'],
  rahi: ['happening'],
  dikha: ['show'],
  dikhta: ['show'],
  dikhti: ['show'],
  dikh: ['show'],
  kuch: ['something'],
  bahut: ['very'],
  thoda: ['little'],
  phir: ['then'],
  abhi: ['now'],
  din: ['day'],
  baad: ['after'],
  pehle: ['before']
}

/** Devanagari Hindi → English concepts. */
const HINDI_TO_ENGLISH: Record<string, string[]> = {
  क्यों: ['why'],
  क्या: ['what'],
  कैसे: ['how'],
  कब: ['when'],
  कहाँ: ['where'],
  कहां: ['where'],
  कौन: ['who'],
  कितना: ['how many'],
  कितने: ['how many'],
  नहीं: ['not'],
  है: ['is'],
  हैं: ['is'],
  मेरा: ['my'],
  मेरी: ['my'],
  मेरे: ['my'],
  मुझे: ['me'],
  बताओ: ['tell', 'explain'],
  बताइए: ['tell', 'explain'],
  समझाओ: ['explain', 'understand'],
  समझ: ['understand'],
  दिक्कत: ['problem', 'issue'],
  समस्या: ['problem', 'issue'],
  गलती: ['error', 'mistake'],
  त्रुटि: ['error'],
  काम: ['work'],
  क्योंकि: ['because'],
  मतलब: ['meaning'],
  उदाहरण: ['example'],
  अंतर: ['difference'],
  फर्क: ['difference'],
  प्रश्न: ['question'],
  सवाल: ['question'],
  उत्तर: ['answer'],
  जवाब: ['answer'],
  कक्षा: ['class'],
  वस्तु: ['object'],
  सूची: ['list'],
  स्टैक: ['stack'],
  कतार: ['queue'],
  स्मृति: ['memory'],
  फ़ाइल: ['file'],
  फाइल: ['file'],
  प्रोग्राम: ['program'],
  फलन: ['function'],
  फंक्शन: ['function'],
  चर: ['variable'],
  डेटाबेस: ['database'],
  सर्वर: ['server'],
  पुनरावृत्ति: ['recursion'],
  श्रेणी: ['array'],
  पेड़: ['tree'],
  ग्राफ: ['graph'],
  खोज: ['search'],
  क्रमबद्ध: ['sorting'],
  जटिलता: ['complexity'],
  समय: ['time'],
  परीक्षा: ['exam'],
  अध्याय: ['chapter'],
  अध्यापक: ['professor', 'teacher'],
  शिक्षक: ['professor', 'teacher'],
  महाविद्यालय: ['college'],
  विश्वविद्यालय: ['university'],
  अंक: ['marks'],
  सेमेस्टर: ['semester']
}

/** English technical terms that should also match their Hindi/Hinglish forms. */
const ENGLISH_TO_NATIVE: Record<string, string[]> = {
  why: ['kyu', 'kyun', 'क्यों'],
  what: ['kya', 'क्या'],
  how: ['kaise', 'कैसे'],
  when: ['kab', 'कब'],
  where: ['kahan', 'कहाँ'],
  not: ['nahi', 'नहीं'],
  problem: ['dikkat', 'samya', 'दिक्कत', 'समस्या'],
  error: ['galti', 'त्रुटि', 'गलती', 'error'],
  example: ['udaharan', 'उदाहरण'],
  difference: ['antar', 'farak', 'अंतर'],
  question: ['sawal', 'प्रश्न', 'सवाल'],
  answer: ['jawab', 'उत्तर', 'जवाब'],
  queue: ['क्यू', 'कतार'],
  stack: ['स्टैक'],
  array: ['array', 'श्रेणी', 'अरे'],
  pointer: ['pointer', 'पॉइंटर'],
  loop: ['loop', 'लूप'],
  function: ['function', 'फंक्शन', 'फलन'],
  variable: ['char', 'चर'],
  database: ['database', 'डेटाबेस'],
  memory: ['memory', 'स्मृति', 'मेमोरी'],
  recursion: ['recursion', 'पुनरावृत्ति', 'रिकर्शन'],
  search: ['khoj', 'खोज', 'सर्च'],
  sorting: ['sorting', 'क्रमबद्ध', 'सॉर्टिंग'],
  complexity: ['complexity', 'जटिलता'],
  exam: ['pariksha', 'परीक्षा'],
  marks: ['ank', 'अंक'],
  semester: ['सेमेस्टर'],
  professor: ['adhyapak', 'शिक्षक'],
  college: ['mahavidyalaya', 'महाविद्यालय'],
  list: ['suchi', 'सूची'],
  object: ['vastu', 'वस्तु'],
  class: ['kaksha', 'कक्षा']
}

/** Filler words that carry no retrieval signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did',
  'of', 'to', 'in', 'on', 'for', 'with', 'and', 'or', 'but', 'at', 'by', 'from', 'as',
  'it', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'he', 'she', 'they', 'my',
  'me', 'our', 'your', 'please', 'can', 'could', 'should', 'would', 'will', 'shall',
  'have', 'has', 'had', 'not', 'no', 'if', 'then', 'than', 'so', 'very', 'just', 'about',
  'hai', 'hain', 'ho', 'hota', 'hoti', 'hua', 'raha', 'rahi', 'ka', 'ki', 'ke', 'ko',
  'se', 'me', 'mein', 'par', 'bhi', 'toh', 'tho', 'kuch', 'bahut', 'thoda', 'phir', 'abhi',
  'है', 'हैं', 'का', 'की', 'के', 'को', 'से', 'में', 'पर', 'भी', 'और', 'या', 'यह', 'वह'
])

// \p{M} is required: Devanagari vowel signs/matras are combining marks, so
// without it Hindi words get split into meaningless fragments.
const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_+#.]+/gu

export function containsDevanagari(input: string): boolean {
  return /[\u0900-\u097F]/.test(input)
}

/** Lowercase + collapse whitespace + strip control characters. */
export function normalizeQuery(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function tokenize(input: string): string[] {
  const matches = normalizeQuery(input).match(TOKEN_PATTERN)
  if (!matches) return []
  return matches.map((token) => token.replace(/^[.]+|[.]+$/g, '')).filter((token) => token.length > 0)
}

/** Tokens that plausibly carry meaning (stopwords removed, 2+ chars for latin). */
export function contentTokens(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokenize(input)) {
    if (STOPWORDS.has(token)) continue
    if (containsDevanagari(token) ? token.length < 2 : token.length < 2) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

const HINGLISH_MARKERS = new Set([
  ...Object.keys(HINGLISH_TO_ENGLISH),
  'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'bhi', 'toh', 'hi', 'wala', 'wali', 'bhai',
  'yaar', 'please', 'kar', 'liye', 'jaisa', 'jaise', 'wajah', 'kyun', 'sakte', 'sakta'
])

/** Heuristic language detection for a query. Never assumes — callers report it. */
export function detectLanguage(input: string): QueryLanguage {
  const tokens = tokenize(input)
  if (tokens.length === 0) return 'en'

  const devanagariTokens = tokens.filter((token) => containsDevanagari(token))
  if (devanagariTokens.length > 0) {
    const devanagariChars = (input.match(/[\u0900-\u097F]/g) ?? []).length
    const letters = (input.match(/[\p{L}]/gu) ?? []).length || 1
    if (devanagariChars / letters > 0.15 || devanagariTokens.length >= 2) return 'hi'
    return 'hinglish'
  }

  const markers = tokens.filter((token) => HINGLISH_MARKERS.has(token))
  if (markers.length >= 2) return 'hinglish'
  if (markers.length === 1 && tokens.length <= 4) return 'hinglish'
  return 'en'
}

export type ExpandedQuery = {
  original: string
  normalized: string
  language: QueryLanguage
  /** Original meaningful tokens (language preserved). */
  terms: string[]
  /** English glosses for Hindi/Hinglish terms — used for bridging + keyword recall. */
  glosses: string[]
  /** Native-language variants for English technical terms. */
  nativeVariants: string[]
  /** Query text actually sent to the embedding model. */
  embeddingText: string
  /** Every string worth matching in keyword fallback (deduped, ordered by signal). */
  keywordTerms: string[]
  /**
   * Synonym groups: each group holds a query term plus its cross-language
   * equivalents. A group counts as matched when ANY member matches, so adding
   * translations improves recall without diluting precision.
   */
  conceptGroups: string[][]
}

function pushUnique(target: string[], seen: Set<string>, value: string) {
  const cleaned = value.trim()
  if (!cleaned || seen.has(cleaned)) return
  seen.add(cleaned)
  target.push(cleaned)
}

/**
 * Build the expanded representation used by semantic + keyword retrieval.
 * Cross-language expansion is explicit and observable in API responses so
 * behaviour can be evaluated instead of assumed.
 */
export function expandQuery(rawQuery: string): ExpandedQuery {
  const normalized = normalizeQuery(rawQuery)
  const language = detectLanguage(normalized)
  const terms = contentTokens(normalized)

  const glosses: string[] = []
  const nativeVariants: string[] = []
  const seenGlosses = new Set<string>()
  const seenNative = new Set<string>()

  for (const term of terms) {
    const hinglish = HINGLISH_TO_ENGLISH[term]
    const hindi = HINDI_TO_ENGLISH[term]
    for (const gloss of [...(hinglish ?? []), ...(hindi ?? [])]) {
      pushUnique(glosses, seenGlosses, gloss)
    }
    for (const variant of ENGLISH_TO_NATIVE[term] ?? []) {
      pushUnique(nativeVariants, seenNative, variant)
    }
  }

  // Build synonym groups: query term ↔ its glosses ↔ native variants, merged
  // transitively so "queue" and "क्यू" end up in the same group.
  const adjacency = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (a === b) return
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }

  for (const term of terms) {
    for (const gloss of HINGLISH_TO_ENGLISH[term] ?? []) link(term, gloss)
    for (const gloss of HINDI_TO_ENGLISH[term] ?? []) link(term, gloss)
    for (const variant of ENGLISH_TO_NATIVE[term] ?? []) link(term, variant)
  }

  const conceptGroups: string[][] = []
  const visited = new Set<string>()
  for (const term of terms) {
    if (visited.has(term)) continue
    const group: string[] = []
    const queue = [term]
    visited.add(term)
    while (queue.length > 0) {
      const current = queue.shift()!
      group.push(current)
      for (const neighbour of adjacency.get(current) ?? []) {
        if (visited.has(neighbour)) continue
        visited.add(neighbour)
        queue.push(neighbour)
      }
    }
    conceptGroups.push(group)
  }

  // Bound the number of groups so a long query cannot explode the keyword filter.
  const limitedGroups = conceptGroups.slice(0, 12)

  const keywordTerms: string[] = []
  const seenKeywords = new Set<string>()
  for (const group of limitedGroups) {
    for (const member of group) pushUnique(keywordTerms, seenKeywords, member)
  }

  // Bridge queries for embedding models that are English-centric: append the
  // English gloss of native-language terms without discarding the original.
  const bridge = glosses.filter((gloss) => !normalized.includes(gloss))
  const embeddingText =
    language !== 'en' && bridge.length > 0
      ? `${normalized}\nEnglish keywords: ${bridge.join(', ')}`
      : normalized

  return {
    original: rawQuery,
    normalized,
    language,
    terms,
    glosses,
    nativeVariants,
    embeddingText,
    keywordTerms,
    conceptGroups: limitedGroups
  }
}
