import { describe, expect, it } from 'vitest'
import type { RawArticle } from './eventBuilder'
import { cleanTranslation, isPlausibleTranslation, maskAcronyms, unmaskAcronyms, translateArticles, translationCacheKey, type TranslationCache, type Translator } from './translation'

const memoryCache = (): TranslationCache & { store: Map<string, string | null> } => {
  const store = new Map<string, string | null>()
  return { store, get: (k) => store.get(k), set: (k, v) => void store.set(k, v) }
}

const article = (over: Partial<RawArticle> = {}): RawArticle => ({
  sourceId: 'el-tiempo',
  title: 'Milei atacó a la ONU y pidió apoyo por Malvinas',
  description: 'En su discurso, el primer mandatario argentino calificó al organismo de inútil.',
  url: 'https://example.com/a',
  language: 'es',
  ...over,
})

const es = new Set(['es'])

describe('isPlausibleTranslation', () => {
  it('accepts an ordinary English headline, accents and symbols included', () => {
    expect(isPlausibleTranslation('Милей напал на ООН', 'Milei attacked the UN over the Falklands — “useless”, $6.9bn')).toBe(true)
  })

  it('rejects empty output', () => {
    expect(isPlausibleTranslation('Привет', '   ')).toBe(false)
  })

  it('rejects output that is still mostly Cyrillic (untranslated)', () => {
    expect(isPlausibleTranslation('Турция передаст базу', 'Турция передаст базу Багдаду')).toBe(false)
  })

  it('rejects the NLLB batching failure: a good translation followed by other-language junk', () => {
    const junk = 'Iran reported restoring 50% of damaged infrastructure at the South Pars field Иран Иран Иран Көньяҡ Парс ятҡылығында Көньяҡ Парс ятҡылығында Иран'
    expect(isPlausibleTranslation('Иран сообщил о восстановлении 50% инфраструктуры Южный Парс', junk)).toBe(false)
  })

  it('rejects output far longer than its source (a runaway generation)', () => {
    const runaway = 'the ' + 'ship was hit and the ship was hit '.repeat(20)
    expect(isPlausibleTranslation('Судно подверглось удару', runaway)).toBe(false)
  })
})

describe('cleanTranslation', () => {
  it('strips the hallucinated "· Global Voices" suffix', () => {
    expect(cleanTranslation('Principales televisoras suspenden cobertura', 'Main TV networks stop coverage · Global Voices')).toBe('Main TV networks stop coverage')
  })

  it('leaves it alone when the source headline really carried it', () => {
    expect(cleanTranslation('Noticia | Global Voices', 'News | Global Voices')).toBe('News | Global Voices')
  })

  it('does not touch an ordinary separator in the middle of a headline', () => {
    expect(cleanTranslation('x', 'Iran talks · day two of the summit')).toBe('Iran talks · day two of the summit')
  })
})

describe('acronym handling (ru/uk: glossary English, else original script, else the model)', () => {
  it('masks a glossary acronym and an unknown one, and leaves a verified one for the model', () => {
    const { masked, restores } = maskAcronyms('1 корпус НГУ «Азов», ЗРСП и МИД РФ')
    expect(masked).toBe('1 корпус ZQ1 «Азов», ZQ2 и МИД РФ')
    expect(restores).toEqual(['National Guard of Ukraine', 'ЗРСП'])
  })

  it('takes the glossary over the model for the acronyms it got wrong: ВСУ, ЗСУ, ОДКБ, ППО, СВО', () => {
    const { restores } = maskAcronyms('ВСУ и ОДКБ заявили о целях СВО, а ППО и ЗСУ')
    expect(restores).toEqual(['Ukrainian Armed Forces', 'CSTO', '“special military operation”', 'air defense'])
  })

  it('gives acronyms that share one English rendering a single placeholder', () => {
    const { masked, restores } = maskAcronyms('ВСУ и ЗСУ, затем снова ВСУ')
    expect(masked).toBe('ZQ1 и ZQ1, затем снова ZQ1')
    expect(restores).toEqual(['Ukrainian Armed Forces'])
  })

  it('renders БПЛА from the glossary as well', () => {
    expect(maskAcronyms('БПЛА ВСУ').restores).toEqual(['drone', 'Ukrainian Armed Forces'])
  })

  it('leaves the acronyms the model handles alone, including НАТО, ЄС and ПВО', () => {
    expect(maskAcronyms('НАТО, ЄС, ПВО, США').masked).toBe('НАТО, ЄС, ПВО, США')
  })

  it('does not treat a capitalised word or a lone letter as an acronym', () => {
    expect(maskAcronyms('Россия и Украина, а также В и К').restores).toEqual([])
  })

  it('leaves a source that already contains a placeholder-shaped token unmasked', () => {
    expect(maskAcronyms('Код ZQ1 и НГУ')).toEqual({ masked: 'Код ZQ1 и НГУ', restores: [] })
  })

  it('restores, tolerates a dropped placeholder, and rejects an invented one', () => {
    expect(unmaskAcronyms('The ZQ1 cleared the area near ZQ2', ['National Guard of Ukraine', 'ОЗСП'])).toBe('The National Guard of Ukraine cleared the area near ОЗСП')
    expect(unmaskAcronyms('The area was cleared', ['x'])).toBe('The area was cleared')
    expect(unmaskAcronyms('The ZQ7 cleared the area', ['x'])).toBeNull()
  })

  it('end to end: the model sees placeholders, the headline gets the glossary English, and Cyrillic does not trip the plausibility check', async () => {
    const seen: string[] = []
    const translate: Translator = async (text) => (seen.push(text), 'Russian Defense Ministry says ZQ1 lost 240 drones near ZQ2 in a day')
    const a = article({ language: 'ru', title: 'Минобороны РФ сообщило, что ВСУ потеряли 240 дронов у ОЗСП за сутки' })
    const { articles, stats } = await translateArticles([a], { languages: new Set(['ru']), translate, cache: memoryCache() })
    expect(seen).toEqual(['Минобороны РФ сообщило, что ZQ1 потеряли 240 дронов у ZQ2 за сутки'])
    expect(articles[0].title).toBe('Russian Defense Ministry says Ukrainian Armed Forces lost 240 drones near ОЗСП in a day')
    expect(articles[0].originalTitle).toBe('Минобороны РФ сообщило, что ВСУ потеряли 240 дронов у ОЗСП за сутки')
    expect(stats.translated).toBe(1)
  })

  it('a glossary edit re-translates only the headlines that contain the changed acronym', async () => {
    let calls = 0
    const translate: Translator = async () => (calls++, 'Something happened ZQ1 today')
    const cache = memoryCache()
    const withAcronym = article({ language: 'ru', url: 'u1', title: 'Заявление ВСУ сегодня' })
    const without = article({ language: 'ru', url: 'u2', title: 'Заявление министра сегодня' })
    await translateArticles([withAcronym, without], { languages: new Set(['ru']), translate, cache })
    expect(calls).toBe(2)
    // Same headlines, same glossary: everything is a cache hit.
    await translateArticles([withAcronym, without], { languages: new Set(['ru']), translate, cache })
    expect(calls).toBe(2)
    // The key for the glossed headline depends on its expansion; the plain one does not.
    const masked = maskAcronyms(withAcronym.title)
    expect(translationCacheKey('ru', masked.masked, masked.restores)).not.toBe(translationCacheKey('ru', masked.masked, ['Armed Forces of Ukraine']))
    expect(translationCacheKey('ru', without.title)).toBe(translationCacheKey('ru', without.title, []))
  })

  it('does not mask Spanish, and masked entries do not collide with unmasked cache keys', async () => {
    const seen: string[] = []
    await translateArticles([article({ title: 'La OEA y la ONU' })], { languages: es, translate: async (t) => (seen.push(t), 'The OAS and the UN'), cache: memoryCache() })
    expect(seen).toEqual(['La OEA y la ONU'])
    expect(translationCacheKey('ru', 'x')).toContain('keep2')
    expect(translationCacheKey('es', 'x')).not.toContain('keep')
  })
})

describe('translateArticles', () => {
  it('replaces the title with the translation, drops the description, and records the original', async () => {
    const translate: Translator = async () => 'Milei attacked the UN and asked for support over the Falklands'
    const { articles, stats } = await translateArticles([article()], { languages: es, translate, cache: memoryCache() })
    expect(articles[0]).toMatchObject({
      title: 'Milei attacked the UN and asked for support over the Falklands',
      language: 'en',
      originalTitle: 'Milei atacó a la ONU y pidió apoyo por Malvinas',
      translatedFrom: 'es',
    })
    expect(articles[0].description).toBeUndefined()
    expect(stats).toEqual({ translated: 1, cached: 0, rejected: 0, deferred: 0 })
  })

  it('cleans a suffix on an entry that was cached before the rule existed', async () => {
    const cache = memoryCache()
    const a = article()
    cache.set(translationCacheKey('es', a.title), 'Milei attacked the UN · Global Voices')
    const { articles } = await translateArticles([a], { languages: es, cache })
    expect(articles[0].title).toBe('Milei attacked the UN')
  })

  it('never mutates its input (the archive record must stay as written)', async () => {
    const input = article()
    const before = JSON.stringify(input)
    await translateArticles([input], { languages: es, translate: async () => 'A translated headline', cache: memoryCache() })
    expect(JSON.stringify(input)).toBe(before)
  })

  it('passes English and not-requested languages through untouched, without calling the model', async () => {
    let calls = 0
    const translate: Translator = async () => (calls++, 'x')
    const english = article({ language: undefined, title: 'Already English' })
    const russian = article({ language: 'ru', title: 'Привет мир' })
    const { articles } = await translateArticles([english, russian], { languages: es, translate, cache: memoryCache() })
    expect(articles).toEqual([english, russian])
    expect(calls).toBe(0)
  })

  it('serves a repeat from the cache instead of calling the model again', async () => {
    let calls = 0
    const translate: Translator = async () => (calls++, 'Cached headline here')
    const cache = memoryCache()
    await translateArticles([article()], { languages: es, translate, cache })
    const second = await translateArticles([article({ url: 'https://example.com/b' })], { languages: es, translate, cache })
    expect(calls).toBe(1)
    expect(second.stats).toMatchObject({ translated: 0, cached: 1 })
    expect(second.articles[0].title).toBe('Cached headline here')
  })

  it('leaves an implausible translation untranslated and remembers the rejection', async () => {
    let calls = 0
    const translate: Translator = async () => (calls++, 'Headline Иран Иран Иран Иран Иран Иран')
    const cache = memoryCache()
    const first = await translateArticles([article()], { languages: es, translate, cache })
    expect(first.articles[0].language).toBe('es')
    expect(first.articles[0].translatedFrom).toBeUndefined()
    expect(first.stats.rejected).toBe(1)
    const again = await translateArticles([article()], { languages: es, translate, cache })
    expect(calls).toBe(1)
    expect(again.stats.rejected).toBe(1)
  })

  it('does not cache a thrown model error, so a transient failure is retried next run', async () => {
    const cache = memoryCache()
    const boom: Translator = async () => {
      throw new Error('model unavailable')
    }
    const first = await translateArticles([article()], { languages: es, translate: boom, cache })
    expect(first.articles[0].language).toBe('es')
    expect(first.stats.rejected).toBe(1)
    expect(cache.store.size).toBe(0)
  })

  it('stops calling the model at maxNew and defers the rest, still serving cached ones', async () => {
    let calls = 0
    const translate: Translator = async (text) => (calls++, `EN ${text.length}`)
    const cache = memoryCache()
    const a = article({ url: 'u1', title: 'Uno dos tres' })
    const b = article({ url: 'u2', title: 'Cuatro cinco seis' })
    const c = article({ url: 'u3', title: 'Siete ocho nueve' })
    await translateArticles([a], { languages: es, translate, cache })
    const { articles, stats } = await translateArticles([a, b, c], { languages: es, translate, cache, maxNew: 1 })
    expect(calls).toBe(2)
    expect(stats).toEqual({ translated: 1, cached: 1, rejected: 0, deferred: 1 })
    expect(articles.map((x) => x.language)).toEqual(['en', 'en', 'es'])
  })

  it('decodes HTML entities before translating, and keys the cache on the model as well as the text', async () => {
    const seen: string[] = []
    const translate: Translator = async (text) => (seen.push(text), 'Fish and chips headline')
    const cache = memoryCache()
    await translateArticles([article({ title: 'Pescado &amp; papas' })], { languages: es, translate, cache })
    expect(seen).toEqual(['Pescado & papas'])
    expect(translationCacheKey('es', 'x')).toContain('opus-mt-es-en')
    expect(translationCacheKey('ru', 'x')).toContain('rus_Cyrl')
    expect(translationCacheKey('ru', 'x')).not.toBe(translationCacheKey('uk', 'x'))
  })

  it('skips an article whose title is empty', async () => {
    let calls = 0
    const { articles } = await translateArticles([article({ title: '   ' })], { languages: es, translate: async () => (calls++, 'x'), cache: memoryCache() })
    expect(calls).toBe(0)
    expect(articles[0].language).toBe('es')
  })
})
