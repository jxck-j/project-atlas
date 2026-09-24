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
}

/** Which model handles which feed language. A language absent here cannot be translated, whatever is asked for. */
export const TRANSLATION_MODELS: Readonly<Record<string, TranslationModel>> = {
  es: { model: 'Xenova/opus-mt-es-en' },
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
  const masked = text.replace(CYRILLIC_ACRONYM, (a) => {
    if (!(a in ACRONYM_GLOSSARY) && TRANSLATED_ACRONYMS.has(a)) return a
    const restore = ACRONYM_GLOSSARY[a] ?? a
    let i = restores.indexOf(restore)
    if (i === -1) i = restores.push(restore) - 1
    return `ZQ${i + 1}`
  })
  return { masked, restores }
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
    const { masked, restores } = TRANSLATION_MODELS[lang].keepAcronyms ? maskAcronyms(source) : { masked: source, restores: [] }
    const key = translationCacheKey(lang, masked, restores)
    let english = cache.get(key)
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
        english = isPlausibleTranslation(masked, raw) ? unmaskAcronyms(raw, restores) : null
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
    const { description: _dropped, ...rest } = article
    out.push({ ...rest, title: english, language: 'en', originalTitle: source, translatedFrom: lang })
  }
  return { articles: out, stats }
}
