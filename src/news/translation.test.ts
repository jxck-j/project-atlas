import { describe, expect, it } from 'vitest'
import type { RawArticle } from './eventBuilder'
import { cleanTranslation, droppedContent, endsMidPhrase, isPlausibleTranslation, maskAcronyms, maskForModel, maskProtectedNames, unmaskAcronyms, translateArticles, translationCacheKey, type TranslationCache, type Translator } from './translation'

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

describe('truncated translations (the model dropped the end of the headline)', () => {
  it('flags output that stops on a word no headline ends on', () => {
    expect(endsMidPhrase('Javier Milei closes his trip to New York: Disertation in an economic club and meeting with')).toBe(true)
    expect(endsMidPhrase('Motorcycles beat a group of teenagers with')).toBe(true)
    expect(endsMidPhrase('contracts with Peña Nieto, AMLO and Sheinbaum that add up to.')).toBe(true)
    expect(endsMidPhrase('who is responsible for each of the')).toBe(true)
    expect(endsMidPhrase('He said “the”')).toBe(true)
  })

  it('leaves ordinary English endings alone, stranded prepositions included', () => {
    expect(endsMidPhrase('Brazil Elections 2026: the date when the next president is voted on')).toBe(false)
    expect(endsMidPhrase('the disease he suffered from.')).toBe(false)
    expect(endsMidPhrase('what he can be accused of')).toBe(false)
    expect(endsMidPhrase('Trump meets Xi in Beijing')).toBe(false)
    // A word merely CONTAINING one of the endings is not the ending.
    expect(endsMidPhrase('Strikes hit Tehran and Ankara')).toBe(false)
    expect(endsMidPhrase('Talks stall over the')).toBe(true)
  })

  it('rejects a truncated NEW translation and remembers the rejection', async () => {
    const cache = memoryCache()
    let calls = 0
    const translate: Translator = async () => (calls++, 'Milei closes his New York trip and meets with')
    const a = article({ title: 'Milei cierra su viaje a Nueva York y se reúne con Netanyahu', url: 'u1' })
    const first = await translateArticles([a], { languages: es, translate, cache })
    expect(first.stats.rejected).toBe(1)
    expect(first.articles[0].language).toBe('es') // left as it was, so it drops as unsupported-language
    await translateArticles([a], { languages: es, translate, cache })
    expect(calls).toBe(1)
  })

  it('drops a truncated translation that was cached BEFORE the rule existed, without calling the model', async () => {
    const cache = memoryCache()
    const a = article({ title: 'Reunión con alguien importante', url: 'u2' })
    cache.set(translationCacheKey('es', a.title), 'Meeting with')
    let calls = 0
    const { articles, stats } = await translateArticles([a], { languages: es, translate: async () => (calls++, 'x'), cache })
    expect(calls).toBe(0)
    expect(stats).toMatchObject({ cached: 0, rejected: 1, translated: 0 })
    expect(articles[0].language).toBe('es')
  })

  it('is part of isPlausibleTranslation', () => {
    expect(isPlausibleTranslation('a b c d', 'Meeting with')).toBe(false)
    expect(isPlausibleTranslation('a b c d', 'Meeting with the Pope')).toBe(true)
  })
})

describe('protected names (es): the model mangles rare names, so it never sees them', () => {
  it('masks a listed name and restores the set English (Samarcanda -> Samarkand)', () => {
    const m = maskProtectedNames('Trump se reúne con Netanyahu en Washington', 'es')
    expect(m.masked).toBe('Trump se reúne con ZQ1 en Washington')
    expect(m.restores).toEqual(['Netanyahu'])
    const s = maskProtectedNames('Olimpiadas de ajedrez en Samarcanda', 'es')
    expect(s.restores).toEqual(['Samarkand'])
  })

  it('gives a repeated name one placeholder and different names their own', () => {
    const m = maskProtectedNames('Netanyahu y Abbott hablan; Netanyahu responde', 'es')
    expect(m.masked).toBe('ZQ1 y ZQ2 hablan; ZQ1 responde')
    expect(m.restores).toEqual(['Netanyahu', 'Abbott'])
  })

  it('matches whole words, case-sensitively, and leaves everything else alone', () => {
    expect(maskProtectedNames('Los Swiftboat y el swift bancario', 'es').masked).toBe('Los Swiftboat y el swift bancario')
    expect(maskProtectedNames('Sin nombres raros hoy', 'es')).toEqual({ masked: 'Sin nombres raros hoy', restores: [] })
    expect(maskProtectedNames('Trump y Netanyahu', 'fr')).toEqual({ masked: 'Trump y Netanyahu', restores: [] })
  })

  it('leaves a source that already contains a placeholder-shaped token unmasked', () => {
    expect(maskProtectedNames('ZQ1 y Netanyahu', 'es').restores).toEqual([])
  })

  it('end to end: the model sees the placeholder and the headline gets the name back', async () => {
    const seen: string[] = []
    const translate: Translator = async (text) => (seen.push(text), 'Trump meets with ZQ1 in Washington')
    const { articles } = await translateArticles([article({ title: 'Trump se reúne con Netanyahu en Washington' })], { languages: es, translate, cache: memoryCache() })
    expect(seen).toEqual(['Trump se reúne con ZQ1 en Washington'])
    expect(articles[0].title).toBe('Trump meets with Netanyahu in Washington')
  })

  it('a model that drops the placeholder at the end is caught as a truncation, not published as a name-less headline', async () => {
    const translate: Translator = async () => 'Milei closes his trip to New York: lecture and meeting with'
    const { articles, stats } = await translateArticles([article({ title: 'Milei cierra su viaje: disertación y reunión con Netanyahu' })], { languages: es, translate, cache: memoryCache() })
    expect(stats.rejected).toBe(1)
    expect(articles[0].language).toBe('es')
  })

  it('changes the cache key only for headlines that contain a listed name', async () => {
    const plain = 'Sin nombres raros hoy'
    const masked = maskProtectedNames('Trump y Netanyahu', 'es')
    expect(translationCacheKey('es', plain)).toBe(translationCacheKey('es', maskProtectedNames(plain, 'es').masked, []))
    expect(translationCacheKey('es', masked.masked, masked.restores)).not.toBe(translationCacheKey('es', 'Trump y Netanyahu'))
  })
})

describe('Cyrillic terms (ru/uk): words and places the model gets wrong are set, not left to it', () => {
  const mask = (t: string) => maskForModel('ru', t)

  it('sets the English for the wrong outputs seen in real headlines', () => {
    expect(mask('Двое подростков осуждены по делу о госизмене в Тульской области')).toEqual({
      masked: 'Двое подростков осуждены по делу о ZQ2 в ZQ1 области',
      restores: ['Tula', 'treason'],
    })
    expect(mask('Самолеты Тихоокеанского флота провели противолодочные учения над Охотским морем').restores).toEqual(['anti-submarine'])
    expect(mask('Мособлсуд утвердил арест трех топ-менеджеров').restores).toEqual(['Moscow Regional Court'])
    expect(mask('Производство осетровой икры в РФ выросло на 5%').restores).toEqual(['sturgeon caviar'])
  })

  it('takes every inflected form of a stem to one placeholder (Мосбиржа, Мосбирже, МосБиржи)', () => {
    const m = mask('Рубль на "Мосбирже" подешевел; индекс МосБиржи вырос; "Мосбиржа" запустит фьючерс')
    expect(m.masked).toBe('Рубль на "ZQ1" подешевел; индекс ZQ1 вырос; "ZQ1" запустит фьючерс')
    expect(m.restores).toEqual(['Moscow Exchange'])
  })

  it('puts a phrase before the word it contains: Huliaipole sector, not Huliaipole + sector', () => {
    expect(maskForModel('uk', 'Бійці 33 ОШП поділилися кадрами роботи на Гуляйпільському відтинку')).toEqual({
      masked: 'Бійці 33 ZQ2 поділилися кадрами роботи на ZQ1',
      restores: ['Huliaipole sector', 'separate assault regiment'],
    })
    expect(maskForModel('uk', 'на Краматорського відтинку').restores).toEqual(['Kramatorsk sector'])
    expect(maskForModel('uk', 'бої на цьому відтинку').restores).toEqual(['sector']) // no place name: just the general word
  })

  it('numbers terms and acronyms from one list (terms first, in glossary order) so their placeholders cannot collide', () => {
    const m = mask('Минобороны РФ: ВСУ атаковали Брянскую область')
    expect(m.masked).toBe('Минобороны РФ: ZQ2 атаковали ZQ1 область')
    expect(m.restores).toEqual(['Bryansk', 'Ukrainian Armed Forces'])
    const back = unmaskAcronyms('Russian Defense Ministry: ZQ2 attacked ZQ1 region', m.restores)
    expect(back).toBe('Russian Defense Ministry: Ukrainian Armed Forces attacked Bryansk region')
  })

  it('matches whole words only', () => {
    expect(mask('Крупный банк и крупные вложения').restores).toEqual([])
    expect(mask('Тувалу подписало соглашение').restores).toEqual([]) // Tuvalu, not Tuva
    expect(mask('Курильщики против запрета').restores).toEqual([])
  })

  it('leaves Spanish alone and a source that already contains a placeholder-shaped token unmasked', () => {
    expect(maskForModel('es', 'Госизмена').restores).toEqual([])
    expect(mask('ZQ1 и госизмена')).toEqual({ masked: 'ZQ1 и госизмена', restores: [] })
  })

  it('a headline with no listed term keeps its old cache key, so existing entries stay valid', () => {
    const t = 'Двое подростков осуждены'
    const m = mask(t)
    expect(translationCacheKey('ru', m.masked, m.restores)).toBe(translationCacheKey('ru', t))
  })

  it('end to end: the model sees the placeholder and the headline gets the English back', async () => {
    const seen: string[] = []
    const translate: Translator = async (text) => (seen.push(text), 'Two teenagers convicted of ZQ2 in ZQ1 region')
    const a = article({ language: 'ru', title: 'Двое подростков осуждены по делу о госизмене в Тульской области' })
    const { articles } = await translateArticles([a], { languages: new Set(['ru']), translate, cache: memoryCache() })
    expect(seen).toEqual(['Двое подростков осуждены по делу о ZQ2 в ZQ1 области'])
    expect(articles[0].title).toBe('Two teenagers convicted of treason in Tula region')
  })
})

describe('a dropped term or name placeholder fails closed', () => {
  it('flags output that lost a term or name, but tolerates a dropped acronym', () => {
    expect(droppedContent('Two teenagers convicted in ZQ1 case', ['Tula', 'treason'])).toBe(true) // ZQ2 (treason) is gone
    expect(droppedContent('Two teenagers convicted of ZQ2 in ZQ1 region', ['Tula', 'treason'])).toBe(false)
    expect(droppedContent('Trump meets with in Washington', ['Netanyahu'])).toBe(true)
    // An acronym's expansion is not content in this sense: the headline still reads without it.
    expect(droppedContent('The Ministry says drones were shot down', ['Ukrainian Armed Forces'])).toBe(false)
  })

  it('does not mistake ZQ1 for ZQ10', () => {
    const restores = ['Tula', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'treason']
    expect(droppedContent('ZQ10 only', restores)).toBe(true) // ZQ1 (Tula) missing, ZQ11 (treason) missing
  })

  it('end to end: a translation that lost a term is rejected, remembered, and left untranslated', async () => {
    const cache = memoryCache()
    let calls = 0
    const translate: Translator = async () => (calls++, 'Two teenagers convicted in ZQ1 case')
    const a = article({ language: 'ru', title: 'Двое подростков осуждены по делу о госизмене в Тульской области' })
    const first = await translateArticles([a], { languages: new Set(['ru']), translate, cache })
    expect(first.stats.rejected).toBe(1)
    expect(first.articles[0].language).toBe('ru')
    await translateArticles([a], { languages: new Set(['ru']), translate, cache })
    expect(calls).toBe(1)
  })

  it('a Spanish headline whose name placeholder was dropped is rejected too', async () => {
    const translate: Translator = async () => 'Milei closes his New York trip: lecture and a meeting'
    const a = article({ title: 'Milei cierra su viaje a Nueva York: disertación y una reunión con Netanyahu' })
    const { stats } = await translateArticles([a], { languages: es, translate, cache: memoryCache() })
    expect(stats.rejected).toBe(1)
  })

  it('the new terms', () => {
    expect(maskForModel('ru', 'Ростехнадзор приостановил проведение забоя на шахте').restores).toEqual(['Rostekhnadzor', 'mining face operations'])
    expect(maskForModel('uk', 'скидів на голови кацапів').restores).toEqual(['Russians (pejorative)'])
  })
})
