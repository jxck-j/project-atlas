import type { NewsItem, NewsTopicTag } from '../newsTypes'

// Same architecture as CountryRegistry.ts/GeoEntityRegistry.ts: a plain,
// non-reactive Map. No opinion about where NewsItem records come from (the
// static public/data/news.json asset buildNews.mjs produces, fetched by
// data/useNewsFeatures.ts).
const registry = new Map<string, NewsItem>()

/** Adds a NewsItem to the registry. Throws if `item.id` is already registered, same as registerCountry/registerEntity. */
export function registerNewsItem(item: NewsItem): void {
  if (registry.has(item.id)) {
    throw new Error(`[NewsRegistry] a news item with id "${item.id}" is already registered.`)
  }
  registry.set(item.id, item)
}

/** Looks up a single news item by id. Returns undefined if it isn't registered. */
export function getNewsItem(id: string): NewsItem | undefined {
  return registry.get(id)
}

/** Every currently-registered news item, in registration order. */
export function getNewsItems(): NewsItem[] {
  return Array.from(registry.values())
}

/** Every registered item linking a given country/entity id. */
export function getNewsItemsByEntityId(id: string): NewsItem[] {
  return Array.from(registry.values()).filter((item) => item.linkedEntityIds.includes(id))
}

/** Every registered item carrying a given topic tag. */
export function getNewsItemsByTag(tag: NewsTopicTag): NewsItem[] {
  return Array.from(registry.values()).filter((item) => item.topicTags.includes(tag))
}
