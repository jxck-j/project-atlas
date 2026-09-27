// Runs every wire publisher in src/news/wireSources.json: each publisher's channels concurrently, then mergeWireArticles folds a
// publisher's channels into one record per story. THE swap point: to add or replace a source (an official Reuters/AP/AFP API), write a
// file here satisfying WireAdapter, register it below and in WIRE_ADAPTER_NAMES (src/news/wireSources.ts), and list it as a channel in
// wireSources.json. The archive, Event build, gate and client only ever see RawArticle records, so none of them change.
import { readFileSync } from 'node:fs'
import { mergeWireArticles } from '../../../src/news/wireCommon.ts'
import { WIRE_ADAPTER_NAMES } from '../../../src/news/wireSources.ts'
import { fetchBluesky } from './bluesky.mjs'
import { fetchGoogleNewsRss } from './googleNewsRss.mjs'
import { fetchNewsSitemap } from './newsSitemap.mjs'

/**
 * @typedef {{ articles: import('../../../src/news/eventBuilder.ts').RawArticle[], feedFailures: string[],
 *   failedFeeds: { sourceId: string, url: string, error: string }[], targets: { sourceId: string, url: string }[] }} WireResult
 * @typedef {(publisher: import('../../../src/news/wireSources.ts').WirePublisher, channel: any) => Promise<WireResult>} WireAdapter
 */

/** @type {Record<string, WireAdapter>} */
export const WIRE_ADAPTERS = {
  'google-news-rss': fetchGoogleNewsRss,
  bluesky: fetchBluesky,
  'news-sitemap': fetchNewsSitemap,
}

for (const name of WIRE_ADAPTER_NAMES) {
  if (!WIRE_ADAPTERS[name]) throw new Error(`wire adapter "${name}" is named in WIRE_ADAPTER_NAMES but not registered`)
}

export const loadWireConfig = () => JSON.parse(readFileSync(new URL('../../../src/news/wireSources.json', import.meta.url), 'utf8'))

/** @param {import('../../../src/news/wireSources.ts').WireSourcesConfig} [config] */
export async function fetchWireArticles(config = loadWireConfig()) {
  const perPublisher = await Promise.all(
    config.publishers
      .filter((p) => p.enabled !== false)
      .map(async (publisher) => {
        const results = await Promise.all(
          publisher.channels.filter((c) => c.enabled !== false).map((channel) => {
            const adapter = WIRE_ADAPTERS[channel.adapter]
            if (!adapter) throw new Error(`wireSources.json: unknown adapter "${channel.adapter}" for ${publisher.sourceId} (have: ${Object.keys(WIRE_ADAPTERS).join(', ')})`)
            return adapter(publisher, channel)
          }),
        )
        return { articles: mergeWireArticles(results.flatMap((r) => r.articles)), results }
      }),
  )
  const all = perPublisher.flatMap((p) => p.results)
  return {
    articles: perPublisher.flatMap((p) => p.articles),
    feedFailures: all.flatMap((r) => r.feedFailures),
    failedFeeds: all.flatMap((r) => r.failedFeeds),
    targets: all.flatMap((r) => r.targets),
  }
}
