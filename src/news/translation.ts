import type { RawArticle } from './eventBuilder'
import { decodeHtmlEntities } from './htmlEntities'

// Build-time machine translation of non-English HEADLINES, so a Spanish or Russian report can reach the English-only rules
// downstream (country matchers, severity regexes, MiniLM) as an ordinary English article. Pure: the model lives in
// localTranslator.ts, the cache file in scripts/lib/newsTranslationCache.mjs. Off by default — a language is switched on by
// passing it to translateArticles, never by being listed here.
//
// WHAT THE 2026-09-24 SPIKE FOUND (LOGBOOK.md), which every choice below follows:
//   - TITLES ONLY. Marian (OPUS-MT) models are trained on sentences; whole descriptions came back with dropped sentences,
//     garbled names and numbers ("Bloomberg" -> "Bloom/2004/1"). A headline is one sentence and survives.
//   - opus-mt-uk-en is unusable (hallucinated "Debian Times" for the Financial Times); NLLB-200 600M reads Ukrainian and
//     Russian well, OPUS is fine and much faster for Spanish.
//   - NLLB must run ONE text at a time, greedy. Batched, transformers.js lets it run past the end of the sentence and
//     append junk in other languages to every item — silently.
// The archive is never rewritten: this makes a build-time COPY of the article with the English title swapped in.

export interface TranslationModel {
  /** transformers.js model id. */
  model: string
  /** NLLB only: the source language's FLORES-200 code (the target is always eng_Latn). */
  srcLang?: string
  /** Mask Cyrillic acronyms: glossary English, else the original script unless the model is known to handle them — see maskAcronyms. */
  keepAcronyms?: true
  /** Mask the names in PROTECTED_NAMES[language] so the model never sees them — see maskProtectedNames. */
  protectNames?: true
}

/** Which model handles which feed language. A language absent here cannot be translated, whatever is asked for. */
export const TRANSLATION_MODELS: Readonly<Record<string, TranslationModel>> = {
  es: { model: 'Xenova/opus-mt-es-en', protectNames: true },
  ru: { model: 'Xenova/nllb-200-distilled-600M', srcLang: 'rus_Cyrl', keepAcronyms: true },
  uk: { model: 'Xenova/nllb-200-distilled-600M', srcLang: 'ukr_Cyrl', keepAcronyms: true },
}

/** The one string a translator sees per call. The title, decoded — never the description (see above). */
export type Translator = (text: string, language: string) => Promise<string>

/** A cache of translated titles. `null` records a translation that was tried and rejected, so it is not retried every build. */
export interface TranslationCache {
  get(key: string): string | null | undefined
  set(key: string, value: string | null): void
}

/**
 * Keyed by model, and by the text THE MODEL SEES plus the expansions its placeholders will become. For a headline with nothing
 * masked that is just the headline, so editing the glossary leaves those entries alone; for one with a glossed acronym the key
 * changes exactly when its masked text or an expansion does, so a glossary edit re-translates only the headlines it touches.
 */
export function translationCacheKey(language: string, text: string, restores: readonly string[] = []): string {
  const cfg = TRANSLATION_MODELS[language]
  // `keep2` marks entries made with acronym masking (keep1 was Cyrillic-only, before the glossary), so older entries stop matching.
  return `${cfg?.model ?? language}|${cfg?.srcLang ?? ''}${cfg?.keepAcronyms ? '|keep2' : ''}|${text}${restores.length > 0 ? `||${restores.join('¦')}` : ''}`
}

const LATIN = /[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}]/u

/**
 * Words a headline never legitimately ends on. Output that stops on one was cut off: OPUS drops the tail of a headline when it
 * hits a name it cannot handle ("...and meeting with", "...teenagers with", "...add up to."). Deliberately NOT the whole list of
 * function words: a stranded preposition is ordinary English ("the date the next president is voted on", "the disease he
 * suffered from", "what he can be accused of"), and rejecting those would lose good headlines. Checked on all 1,871 cached
 * translations (2026-09-25): 5 hits, every one a real truncation.
 */
const DANGLING_END = /(?<![\p{L}\p{N}])(?:the|a|an|and|or|with|to)[\s.,:;"”’')]*$/iu

/** Whether a translation stops mid-phrase, i.e. the model dropped the end of the headline. */
export function endsMidPhrase(text: string): boolean {
  return DANGLING_END.test(text.trim())
}

/**
 * Whether a translation is safe to hand to the rules. The failure modes seen in the spike are all detectable without a second
 * model: output that is empty, that is still mostly the source script (untranslated), that has grown other-language
 * junk (batching bug, hallucination), or that is wildly longer than the headline it came from.
 */
export function isPlausibleTranslation(source: string, output: string): boolean {
  const out = output.trim()
  if (out === '') return false
  const chars = [...out]
  const foreign = chars.filter((c) => !LATIN.test(c)).length
  if (foreign / chars.length > 0.05) return false
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length
  if (words(out) > 3 * words(source) + 4) return false
  if (endsMidPhrase(out)) return false
  return true
}

/**
 * Acronyms whose English rendering we SET, not the model. Each is masked before translation and replaced by this text afterwards,
 * so the model is out of the decision entirely — which matters, because on real headlines (2026-09-24) it was confidently wrong on
 * exactly these: ВСУ (Armed Forces of Ukraine) -> "Russian Air Force", ЗСУ -> "The U.S.S.", СВО -> "WDS", ОДКБ (CSTO) -> "OSCE",
 * ППО (air defense) -> "PPO forces fired rockets", ЧВК -> "VWK". A wrong actor in a war headline is a silent error.
 *
 * Add an entry only when the expansion is certain. An acronym that is in neither this table nor TRANSLATED_ACRONYMS stays in
 * its original Cyrillic (J: "keep military acronyms in their native language") rather than being guessed at — unit designations
 * such as ОЗСП, ЗРСП and ББС are deliberately absent for that reason. СВО is quoted because it is Russia's own term for the
 * invasion, and a reader should see it as a label rather than a neutral description.
 */
export const ACRONYM_GLOSSARY: Readonly<Record<string, string>> = {
  // Armed forces and services
  ВСУ: 'Ukrainian Armed Forces',
  ЗСУ: 'Ukrainian Armed Forces',
  НГУ: 'National Guard of Ukraine',
  КНГУ: 'National Guard Corps',
  ССО: 'Special Operations Forces',
  ВКС: 'Aerospace Forces',
  ВМФ: 'Navy',
  ВДВ: 'Airborne Forces',
  ЧВК: 'private military company',
  ОШП: 'separate assault regiment',
  ОШБ: 'separate assault battalion',
  // Intelligence and security services
  СБУ: 'SBU',
  ФСБ: 'FSB',
  ГРУ: 'GRU',
  ГУР: 'HUR',
  // Equipment and doctrine
  ППО: 'air defense',
  ЗРК: 'surface-to-air missile system',
  РСЗО: 'multiple rocket launcher',
  РЭБ: 'electronic warfare',
  ОПК: 'defense industry',
  ВПК: 'defense industry',
  БПЛА: 'drone',
  БЛА: 'drone',
  // Economy, state and everyday terms that recur in Russian headlines
  ИИ: 'AI',
  ДВЗЯИ: 'CTBT',
  НДФЛ: 'personal income tax',
  ДКП: 'monetary policy',
  ДТ: 'diesel',
  ГСМ: 'fuel and lubricants',
  ОРВИ: 'acute respiratory infections',
  ЧС: 'state of emergency',
  НСПК: 'NSPK',
  РСПП: 'Russian Union of Industrialists and Entrepreneurs',
  ФРП: 'Industrial Development Fund',
  // Blocs, proclaimed entities and the war's own vocabulary
  ОДКБ: 'CSTO',
  ДНР: 'DPR',
  ЛНР: 'LPR',
  СВО: '“special military operation”',
}

/**
 * Cyrillic acronyms NLLB renders correctly in a headline, each checked against real Russian/Ukrainian headlines on 2026-09-24.
 * These are left to the model (it handles case and context, e.g. "ВС РФ" -> "Russian Armed Forces"). Anything in neither this set
 * nor ACRONYM_GLOSSARY is kept in its original script. Add to this set only after checking the model's rendering in a real
 * headline, not on the strength of how obvious the acronym looks — ПВО and НАТО were fine, ППО and ЗСУ were not.
 */
export const TRANSLATED_ACRONYMS: ReadonlySet<string> = new Set([
  'РФ', 'США', 'МИД', 'ООН', 'ЦБ', 'ВТБ', 'ЕС', 'КГБ', 'ВВП', 'СПГ', 'ЕК', 'ОБСЕ', 'ОАЭ', 'КНДР', 'НДС', 'СМИ', 'ВС', 'ГА', 'КПРФ',
  'ЄС', 'НАТО', 'КНР', 'ЦРУ', 'ПВО',
])

const CYRILLIC_ACRONYM = /(?<![\p{L}])[А-ЯІЇЄҐЁ]{2,7}(?![\p{L}])/gu
const PLACEHOLDER = /ZQ(\d+)/g

/**
 * Swaps each glossary or kept acronym for a `ZQ<n>` placeholder before translation; `restores[n-1]` is what that placeholder
 * becomes afterwards — the glossary's English, or the acronym itself when it is neither glossed nor known-good. NLLB carried
 * this placeholder style through intact in every test (a square-bracket style lost one, an angle-bracket style lost two of
 * four). A source that already contains a `ZQ<n>` is left unmasked rather than risk a collision.
 */
export function maskAcronyms(text: string): { masked: string; restores: string[] } {
  if (/ZQ\d/.test(text)) return { masked: text, restores: [] }
  const restores: string[] = []
  return { masked: replaceAcronyms(text, restores), restores }
}

/** Index of `restore` in `restores` (added if new), as a 1-based placeholder. Shared so terms and acronyms number from one list. */
function placeholderFor(restores: string[], restore: string): string {
  let i = restores.indexOf(restore)
  if (i === -1) i = restores.push(restore) - 1
  return `ZQ${i + 1}`
}

function replaceAcronyms(text: string, restores: string[]): string {
  return text.replace(CYRILLIC_ACRONYM, (a) => {
    if (!(a in ACRONYM_GLOSSARY) && TRANSLATED_ACRONYMS.has(a)) return a
    return placeholderFor(restores, ACRONYM_GLOSSARY[a] ?? a)
  })
}

/**
 * Words and places NLLB renders wrongly, with the English the headline gets instead — the same treatment as ACRONYM_GLOSSARY, for
 * ordinary words. Every entry was a real wrong output in the cached ru/uk window (2026-09-25), and a wrong word here is not cosmetic:
 * госизмене (treason) -> "state-smuggling", противолодочные (anti-submarine) -> "anti-ship", Мособлсуд (Moscow Regional Court) -> "the
 * Supreme Court", осетровая икра (sturgeon caviar) -> "ostrich", крупа (groats) -> "grape", минудобрения (mineral fertilizers) -> "mined
 * grains", Мосбиржа (Moscow Exchange) -> "MossBirge" / "Mosbyerge" / "Mosbyerzh" (six headlines, three spellings), Брянская -> "Bryan
 * region", Тульская -> "Tulsa region", Тува -> "Tova", Южные Курилы -> "South Coorlin", Дагестан -> "Daegestan", and the Huliaipole
 * front sector (Гуляйпільський відтинок) -> "Gulaipileski ridge". Совет мира is the Gaza "Board of Peace", which it rendered "World Council".
 *
 * Patterns are stems (Russian and Ukrainian inflect), matched case-insensitively as whole words, and applied in order — put a phrase
 * before the single word it contains. Add an entry only after seeing the model get a real headline wrong AND being certain of the
 * English; a term it already renders correctly gains nothing from being here. This is a list of what has been SEEN, not a dictionary.
 */
export const CYRILLIC_TERMS: readonly { pattern: string; english: string }[] = [
  { pattern: String.raw`Гуляйпільськ\p{L}*\s+відтин\p{L}*`, english: 'Huliaipole sector' },
  { pattern: String.raw`Краматорськ\p{L}*\s+відтин\p{L}*`, english: 'Kramatorsk sector' },
  { pattern: String.raw`відтин(?:ок|ку|ком|ки|ків)`, english: 'sector' },
  { pattern: String.raw`Гуляйпіль\p{L}*`, english: 'Huliaipole' },
  { pattern: String.raw`Краматорськ\p{L}*`, english: 'Kramatorsk' },
  { pattern: String.raw`Мос\s?бирж\p{L}*`, english: 'Moscow Exchange' },
  { pattern: String.raw`Мособлсуд\p{L}*`, english: 'Moscow Regional Court' },
  { pattern: String.raw`Ростехнадзор\p{L}*`, english: 'Rostekhnadzor' },
  { pattern: String.raw`Совет(?:а|у|ом|е)?\s+мира`, english: 'Board of Peace' },
  { pattern: String.raw`Брянск\p{L}*`, english: 'Bryansk' },
  { pattern: String.raw`Тульск\p{L}*`, english: 'Tula' },
  { pattern: String.raw`Тув(?:а|е|у|ы|ой)`, english: 'Tuva' },
  { pattern: String.raw`Курил(?:ы|ах|ам|ами|ов)?`, english: 'Kurils' },
  { pattern: String.raw`Дагестан\p{L}*`, english: 'Dagestan' },
  { pattern: String.raw`госизмен\p{L}*`, english: 'treason' },
  { pattern: String.raw`противолодочн\p{L}*`, english: 'anti-submarine' },
  { pattern: String.raw`осетров\p{L}*\s+икр\p{L}*`, english: 'sturgeon caviar' },
  { pattern: String.raw`минудобрен\p{L}*`, english: 'mineral fertilizers' },
  { pattern: String.raw`круп(?:а|ы|у|е|ой)`, english: 'cereals' },
  { pattern: String.raw`провед\p{L}*\s+забо\p{L}*`, english: 'mining face operations' },
  { pattern: String.raw`кацап\p{L}*`, english: 'Russians (pejorative)' },
]

const CYRILLIC_TERM_PATTERNS = CYRILLIC_TERMS.map(({ pattern, english }) => ({
  re: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${pattern})(?![\p{L}\p{N}])`, 'giu'),
  english,
}))

function replaceCyrillicTerms(text: string, restores: string[]): string {
  return CYRILLIC_TERM_PATTERNS.reduce((t, { re, english }) => t.replace(re, () => placeholderFor(restores, english)), text)
}

/**
 * Puts the restorations back. A placeholder the model dropped just means that acronym is missing from the headline; a
 * placeholder with nothing behind it (the model invented "ZQ7") means the output cannot be trusted, so returns null.
 */
export function unmaskAcronyms(output: string, restores: string[]): string | null {
  let invented = false
  const restored = output.replace(PLACEHOLDER, (_m, n: string) => {
    const r = restores[Number(n) - 1]
    if (r === undefined) invented = true
    return r ?? ''
  })
  return invented ? null : restored
}

/**
 * Names the Spanish model mangles, each with the English the headline gets instead. Masked before translation (the same
 * `ZQ<n>` placeholders as acronyms — OPUS carries them through intact) and restored afterwards, so the model is out of the
 * decision. Every entry was a real, wrong output in the cached window (2026-09-25), not a guess: Netanyahu -> "Mr. Tunter" and
 * "tyranny" (and, in one headline, dropped altogether), Abbott -> "the Bank of London", Shakira -> "Aktira", Swift -> "Sct. Sc.",
 * Tijuana -> "Tianti", Chihuahua -> "Chichi", Atacama -> "Aachenham", Popayán -> "Po332an", Samarcanda -> "S(S)Ynd", Bosch -> "Bicchav", Gareca -> "Garca".
 *
 * A LONG TAIL REMAINS: OPUS garbles any rare name (Revoredo -> "Rev Coredo" was found the same way), and a list can only ever chase
 * the ones already seen. Tokenizer piece count does not separate them either — Netanyahu is a SINGLE piece — and the build must not
 * load a model to decide what to mask. Add an entry only after seeing the model get a real headline wrong; a name it already
 * renders correctly gains nothing from being here. Matched case-sensitively, as a whole word.
 */
export const PROTECTED_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  es: {
    Netanyahu: 'Netanyahu',
    Abbott: 'Abbott',
    Schwarzenegger: 'Schwarzenegger',
    Crawford: 'Crawford',
    Revoredo: 'Revoredo',
    Itsaragrisil: 'Itsaragrisil',
    Shakira: 'Shakira',
    Swift: 'Swift',
    Tijuana: 'Tijuana',
    Chihuahua: 'Chihuahua',
    Popayán: 'Popayán',
    Silao: 'Silao',
    Atacama: 'Atacama',
    Edomex: 'Edomex',
    Cainco: 'Cainco',
    CONADE: 'CONADE',
    Samarcanda: 'Samarkand',
    Bosch: 'Bosch',
    Gareca: 'Gareca',
    Dellien: 'Dellien',
    Skolnik: 'Skolnik',
    Guaylupo: 'Guaylupo',
    Areco: 'Areco',
    Vásquez: 'Vásquez',
  },
}

const NAME_PATTERNS = new Map<string, RegExp>()
function namePattern(language: string): RegExp | undefined {
  const names = PROTECTED_NAMES[language]
  if (!names) return undefined
  let p = NAME_PATTERNS.get(language)
  if (!p) {
    p = new RegExp(`(?<![\\p{L}\\p{N}])(${Object.keys(names).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
    NAME_PATTERNS.set(language, p)
  }
  return p
}

/** Swaps each protected name for a `ZQ<n>` placeholder; `restores[n-1]` is the English it becomes. Same contract as maskAcronyms. */
export function maskProtectedNames(text: string, language: string): { masked: string; restores: string[] } {
  const pattern = namePattern(language)
  if (!pattern || /ZQ\d/.test(text)) return { masked: text, restores: [] }
  const names = PROTECTED_NAMES[language]
  const restores: string[] = []
  const masked = text.replace(pattern, (name) => {
    const restore = names[name]
    let i = restores.indexOf(restore)
    if (i === -1) i = restores.push(restore) - 1
    return `ZQ${i + 1}`
  })
  return { masked, restores }
}

/** English renderings that came from a TERM or NAME entry (as opposed to an acronym): losing one loses content, not just an abbreviation. */
const CONTENT_RESTORES: ReadonlySet<string> = new Set([
  ...CYRILLIC_TERMS.map((t) => t.english),
  ...Object.values(PROTECTED_NAMES).flatMap((names) => Object.values(names)),
])

/**
 * Whether the model dropped a placeholder that stood for a term or name. A dropped ACRONYM placeholder is tolerated (the headline
 * just reads without an abbreviation), but a dropped term is a headline that has lost its point: "Two teenagers convicted in Tula
 * case" is what NLLB returned for a treason case, and one that lost "Netanyahu" reads as a meeting with nobody. Such a translation is
 * rejected — left untranslated, so it drops as unsupported-language — rather than published with the meaning quietly removed.
 */
export function droppedContent(output: string, restores: readonly string[]): boolean {
  return restores.some((r, i) => CONTENT_RESTORES.has(r) && !new RegExp(`ZQ${i + 1}(?!\\d)`).test(output))
}

/** What the model is shown for a headline, and what its placeholders become afterwards (nothing masked -> the text as it was). */
export function maskForModel(language: string, text: string): { masked: string; restores: string[] } {
  const cfg = TRANSLATION_MODELS[language]
  if (cfg?.keepAcronyms) {
    // Terms first, then acronyms, numbering from one list. The placeholder-collision guard runs on the ORIGINAL text.
    if (/ZQ\d/.test(text)) return { masked: text, restores: [] }
    const restores: string[] = []
    return { masked: replaceAcronyms(replaceCyrillicTerms(text, restores), restores), restores }
  }
  if (cfg?.protectNames) return maskProtectedNames(text, language)
  return { masked: text, restores: [] }
}

/**
 * The Spanish OPUS model sometimes appends "· Global Voices" — its training corpus's site suffix — to a headline that never had it
 * (4 of the first 160, all that suffix). Stripped unless the source itself carried it. Applied when a cached entry is READ as well
 * as when a translation is made, so an entry cached before this rule existed is cleaned without being retranslated.
 */
export function cleanTranslation(source: string, output: string): string {
  if (/global voices/i.test(source)) return output
  return output.replace(/\s*[·|–—-]\s*Global Voices\s*$/i, '').trim()
}

export interface TranslationStats {
  /** Translated this run (a model call was made and the result accepted). */
  translated: number
  /** Served from the cache. */
  cached: number
  /** A translation was produced but failed isPlausibleTranslation, or the model threw. Left untranslated. */
  rejected: number
  /** Not attempted this run: `maxNew` model calls were already spent, or this was a cache-only pass. Left untranslated; a translate run fills it in. */
  deferred: number
}

export interface TranslateOptions {
  /** Feed languages to translate. Anything else (including `en`) passes through untouched. */
  languages: ReadonlySet<string>
  /**
   * Omit for a CACHE-ONLY pass (what the Event build does): anything not already cached is deferred instead of translated. The
   * model is a separate process on purpose (scripts/translateNews.mjs) — loaded alongside the embedder in one build it exhausted memory.
   */
  translate?: Translator
  cache: TranslationCache
  /**
   * Cap on model calls in one run. The first run over a full feed window is the expensive one (NLLB is several seconds per
   * headline on CPU); a cap keeps a scheduled build from ballooning, and the cache means each run picks up where the last stopped.
   */
  maxNew?: number
}

/**
 * Returns the articles with each translatable non-English one replaced by an English COPY: `title` is the translation,
 * `description` is dropped (never translated, and the original's would be the wrong language), `language` is 'en', and
 * `originalTitle`/`translatedFrom` record what it was so a reader can be told. An article that cannot be translated is returned
 * as it was, so prepare() drops it as `unsupported-language` exactly as before.
 */
export async function translateArticles(
  articles: RawArticle[],
  { languages, translate, cache, maxNew = Number.POSITIVE_INFINITY }: TranslateOptions,
): Promise<{ articles: RawArticle[]; stats: TranslationStats }> {
  const stats: TranslationStats = { translated: 0, cached: 0, rejected: 0, deferred: 0 }
  let modelCalls = 0
  const out: RawArticle[] = []
  for (const article of articles) {
    const lang = article.language
    if (!lang || !languages.has(lang) || !TRANSLATION_MODELS[lang]) {
      out.push(article)
      continue
    }
    const source = decodeHtmlEntities(article.title).replace(/\s+/g, ' ').trim()
    if (source === '') {
      out.push(article)
      continue
    }
    const { masked, restores } = maskForModel(lang, source)
    const key = translationCacheKey(lang, masked, restores)
    let english = cache.get(key)
    const fromCache = english !== undefined && english !== null
    if (english !== undefined) {
      if (english === null) stats.rejected++
      else stats.cached++
    } else if (!translate || modelCalls >= maxNew) {
      stats.deferred++
      out.push(article)
      continue
    } else {
      modelCalls++
      try {
        const raw = (await translate(masked, lang)).trim()
        // Plausibility is judged BEFORE the acronyms go back in: original-script acronyms would otherwise count as untranslated text.
        english = isPlausibleTranslation(masked, raw) && !droppedContent(raw, restores) ? unmaskAcronyms(raw, restores) : null
      } catch {
        // A thrown model error is NOT cached: it may be transient, and a permanent null would hide the headline forever.
        stats.rejected++
        out.push(article)
        continue
      }
      cache.set(key, english)
      if (english === null) stats.rejected++
      else stats.translated++
    }
    if (english === null) {
      out.push(article)
      continue
    }
    english = cleanTranslation(source, english)
    // A NEW translation was already judged by isPlausibleTranslation; this is for an entry cached before the truncation rule existed,
    // which is dropped on read without re-running the model.
    if (fromCache && endsMidPhrase(english)) {
      stats.cached--
      stats.rejected++
      out.push(article)
      continue
    }
    const { description: _dropped, ...rest } = article
    out.push({ ...rest, title: english, language: 'en', originalTitle: source, translatedFrom: lang })
  }
  return { articles: out, stats }
}
