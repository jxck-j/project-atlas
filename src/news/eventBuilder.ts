import { classifyText } from './classify'
import { clusterArticles, type ClusterArticle } from './clustering'
import { resolveCountryIds, type CountryMatcher } from './countryResolution'
import { resolvePublishDecision } from './publishGate'
import { maxSeverity } from './severity'
import type { NewsEvent, OutletProfile, OutletSourceEntry, SourceProfile, TopicTag } from './types'

// Articles in, Events out (design §17). Pure — no network, no clock, no fs —
// so the build script is a thin fetch/write shell around it and every rule
// here is testable. The pipeline order is the design's §6 with the LLM steps
// stubbed by classify.ts:
//   drop unknown source -> country link -> topic pre-filter -> cluster ->
//   aggregate classification -> build dossier -> corroboration-floor gate.

export interface RawArticle {
  /** A SourceProfile id — the feed's configured publisher, not parsed from the article. */
  sourceId: string
  title: string
  description?: string
  url: string
  /** ISO 8601, or undefined when the feed item had no usable date. */
  publishedAt?: string
}

export interface BuildContext {
  profiles: SourceProfile[]
  countryMatchers: CountryMatcher[]
  /** Build time, ISO 8601. Injected so the function stays pure and tests are deterministic. */
  now: string
}

export type DropReason = 'unknown-source' | 'not-a-report' | 'no-country' | 'no-topic' | 'below-floor'

export interface BuildResult {
  /** Reader-visible: cleared its floor, safe to ship in the public asset. */
  published: NewsEvent[]
  /** Head-of-state death claims that cleared the Critical floor and await a human. NEVER ship these publicly — see buildNewsEvents.mjs. */
  pending: NewsEvent[]
  dropped: Record<DropReason, { title: string; sourceId: string }[]>
  articlesIn: number
  duplicateUrls: number
  clusters: number
}

interface Candidate extends ClusterArticle {
  article: RawArticle
  profile: OutletProfile
  topicTags: TopicTag[]
  severity: ReturnType<typeof classifyText>['severity']
  headOfStateDeathClaim: boolean
}

// Two independent FNV-1a passes -> 16 hex chars. Not cryptographic; it only
// has to make ids stable across runs. Avoids node:crypto so this file stays
// importable from the client bundle if the Admin Console (Phase 5) needs it.
export function stableHash(input: string): string {
  const pass = (seed: number) => {
    let h = seed
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
  return pass(0x811c9dc5) + pass(0x9747b28c)
}

// Opinion, explainer and talk-show pages are not reports OF the event — they
// comment on it. Counting them would let an Event reach a corroboration floor
// on one outlet's news story plus its own columnists (seen live: the Critical
// Riyadh-airport Event carried a WSJ opinion piece, a France 24 explainer and
// an Al Jazeera talk show). Judged by URL path segment because it is the only
// signal every feed carries; a headline-only classifier can't tell. The
// explainer that hides under a plain /news/ path still gets through — Phase 3.
const COMMENTARY_SEGMENTS = new Set(['opinion', 'opinions', 'comment', 'commentary', 'editorial', 'editorials', 'podcast', 'podcasts', 'cartoon', 'cartoons', 'inside-story', 'the-stream', 'newsletter', 'newsletters'])

export function isCommentaryUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().split('/').some((seg) => COMMENTARY_SEGMENTS.has(seg))
  } catch {
    return false
  }
}

function outletEntry(candidate: Candidate): OutletSourceEntry {
  const { article, profile, time } = candidate
  return {
    id: `${profile.id}:${stableHash(article.url)}`,
    sourceCategory: 'outlet',
    sourceId: profile.id,
    // Every ingested outlet report counts; the Community/live-video wall is
    // enforced in corroboration.ts, not here. Official-statement entries (not
    // built in Phase 2) should default to false — see BACKLOG.md.
    countsTowardCorroboration: true,
    refUrl: article.url,
    timestamp: new Date(time).toISOString(),
    outlet: profile.name,
    ...(profile.leaning ? { leaning: profile.leaning } : {}),
    ...(profile.leaningSource ? { leaningSource: profile.leaningSource } : {}),
    ...(profile.leaningConfidence ? { leaningConfidence: profile.leaningConfidence } : {}),
    ...(profile.contested ? { contested: profile.contested } : {}),
    ...(profile.tier ? { tier: profile.tier } : {}),
    ...(profile.caveat ? { caveat: profile.caveat } : {}),
    ...(profile.pressControl ? { pressControl: profile.pressControl } : {}),
  }
}

export function buildEvents(articles: RawArticle[], { profiles, countryMatchers, now }: BuildContext): BuildResult {
  const outletProfiles = new Map(profiles.filter((p): p is OutletProfile => p.sourceType === 'outlet').map((p) => [p.id, p]))
  const dropped: BuildResult['dropped'] = { 'unknown-source': [], 'not-a-report': [], 'no-country': [], 'no-topic': [], 'below-floor': [] }
  const drop = (reason: DropReason, a: RawArticle) => dropped[reason].push({ title: a.title, sourceId: a.sourceId })

  // The same URL can arrive through two feeds (Bloomberg markets + politics).
  const seenUrls = new Set<string>()
  const unique = articles.filter((a) => (seenUrls.has(a.url) ? false : (seenUrls.add(a.url), true)))

  const candidates: Candidate[] = []
  for (const article of unique) {
    const profile = outletProfiles.get(article.sourceId)
    if (!profile) {
      drop('unknown-source', article)
      continue
    }
    if (isCommentaryUrl(article.url)) {
      drop('not-a-report', article)
      continue
    }
    const text = `${article.title}. ${article.description ?? ''}`
    const linkedEntityIds = resolveCountryIds(text, countryMatchers)
    if (linkedEntityIds.length === 0) {
      drop('no-country', article)
      continue
    }
    const classification = classifyText(text)
    if (classification.topicTags.length === 0) {
      drop('no-topic', article)
      continue
    }
    const parsed = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN
    candidates.push({
      key: article.url,
      title: article.title,
      linkedEntityIds,
      time: Number.isNaN(parsed) ? Date.parse(now) : parsed,
      article,
      profile,
      ...classification,
    })
  }

  const clusters = clusterArticles(candidates)
  const published: NewsEvent[] = []
  const pending: NewsEvent[] = []

  for (const cluster of clusters) {
    // `cluster` is time-ordered (clustering.ts), so [0] is the first report.
    const first = cluster.find((c) => c.profile.tier === 'wire') ?? cluster[0]
    const event: NewsEvent = {
      // Keyed to the earliest article, so an id survives later reports
      // joining the cluster. It does NOT survive an earlier report arriving
      // (BACKLOG.md: matters once manual confirmations must persist).
      id: `evt-${stableHash(cluster[0].article.url)}`,
      // Phase 2 stand-in: an outlet's own headline, not a neutral rewrite.
      // The design wants "short, neutral, factual" — Phase 3's LLM pass writes it.
      title: first.title,
      eventTimestamp: new Date(cluster[0].time).toISOString(),
      // Union, first-mention order: the earliest report's principal country leads.
      linkedEntityIds: [...new Set(cluster.flatMap((c) => c.linkedEntityIds))],
      topicTags: [...new Set(cluster.flatMap((c) => c.topicTags))],
      // Assigned by the LLM pass / editorial review, never by keywords (Phase 3).
      systemicThemes: [],
      // The Event carries its most serious member claim; the gate then makes
      // that claim earn its tier via the WHOLE dossier's corroboration.
      severity: maxSeverity(cluster.map((c) => c.severity)),
      ...(cluster.some((c) => c.headOfStateDeathClaim) ? { headOfStateDeathClaim: true } : {}),
      reviewStatus: 'auto-published',
      sources: cluster.map(outletEntry),
      snapshotDate: now,
    }

    const decision = resolvePublishDecision(event)
    if (decision.outcome === 'below-floor') {
      for (const c of cluster) drop('below-floor', c.article)
    } else if (decision.outcome === 'pending-confirmation') {
      pending.push({ ...event, reviewStatus: decision.reviewStatus })
    } else {
      published.push({ ...event, reviewStatus: decision.reviewStatus })
    }
  }

  const newestFirst = (a: NewsEvent, b: NewsEvent) => b.eventTimestamp.localeCompare(a.eventTimestamp)
  return {
    published: published.sort(newestFirst),
    pending: pending.sort(newestFirst),
    dropped,
    articlesIn: articles.length,
    duplicateUrls: articles.length - unique.length,
    clusters: clusters.length,
  }
}
