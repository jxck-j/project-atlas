import { classifyText, matchesHeadOfStateDeath, resolveTopicTags } from './classify'
import { clusterArticles, type ClusterArticle } from './clustering'
import { resolveCountryIds, type CountryMatcher } from './countryResolution'
import { RELEVANCE_THRESHOLD, RESCUE_THRESHOLD, type EmbeddingClassifier } from './embeddingClassifier'
import { clusterByEmbedding, embeddingText, type Embedder } from './embeddingClustering'
import { stableHash } from './hash'
import {
  classifyArticles,
  groupArticles,
  routeClassification,
  type ClassificationCache,
  type ClassifyItem,
  type EventGroup,
  type GroupItem,
  type GroupResult,
  type LlmCall,
  type LlmUsage,
  emptyUsage,
} from './llmPipeline'
import { decodeHtmlEntities } from './htmlEntities'
import { resolvePublishDecision } from './publishGate'
import { applySeverityCaps, maxSeverity } from './severity'
import type { NewsEvent, OutletProfile, OutletSourceEntry, Severity, SourceProfile, SystemicThemeConfig, TopicTag } from './types'

// Articles in, Events out (design §17). Pure — no network, no clock, no fs —
// so the build script is a thin fetch/write shell around it and every rule
// here is testable. Three entry points share one prep stage and one assembly +
// gate stage, so the LLM path cannot reach publication by any route the
// heuristic path doesn't also go through:
//   buildEvents         (sync)  keyword classify -> heuristic cluster -> gate   [Phase 2; the offline/no-key path]
//   buildEventsWithEmbeddings (async) keyword classify -> local-embedding cluster -> gate   [no API key; see embeddingClustering.ts]
//   buildEventsWithLlm  (async) LLM classify -> LLM group (code-guarded) -> gate [Phase 3]

export { stableHash }

export interface RawArticle {
  /** A SourceProfile id — the feed's configured publisher, not parsed from the article. */
  sourceId: string
  title: string
  description?: string
  url: string
  /** ISO 8601, or undefined when the feed item had no usable date. */
  publishedAt?: string
  /** The feed item's own thumbnail (media:thumbnail / enclosure / media:content), when it has one. Partial coverage by nature. */
  imageUrl?: string
}

export interface BuildContext {
  profiles: SourceProfile[]
  countryMatchers: CountryMatcher[]
  /** Build time, ISO 8601. Injected so the function stays pure and tests are deterministic. */
  now: string
}

export type DropReason =
  | 'unknown-source'
  | 'not-a-report'
  | 'no-country'
  | 'no-topic'
  | 'below-floor'
  // LLM path only
  | 'prefiltered'
  | 'not-relevant'
  | 'low-confidence'
  | 'classification-failed'

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
  severity: Severity
  headOfStateDeathClaim: boolean
  systemicThemes: string[]
  /** P(in scope) from the embedding classifier, when one is used. */
  relevance?: number
  /** The KEYWORD tagger found a topic. Recorded before the classifier overwrites topicTags, because it is a precision guard in its own right. */
  keywordTopic?: boolean
}

// Opinion, explainer and talk-show pages are not reports OF the event — they
// comment on it. Counting them would let an Event reach a corroboration floor
// on one outlet's news story plus its own columnists (seen live: the Critical
// Riyadh-airport Event carried a WSJ opinion piece, a France 24 explainer and
// an Al Jazeera talk show). Judged by URL path segment because it is the only
// signal every feed carries. Phase 3's `isReport` catches the explainer that
// hides under a plain /news/ path; this stays as the free first cut.
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
    // built yet) should default to false — see BACKLOG.md.
    countsTowardCorroboration: true,
    refUrl: article.url,
    timestamp: new Date(time).toISOString(),
    ...(article.imageUrl ? { imageUrl: article.imageUrl } : {}),
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

const emptyDropped = (): BuildResult['dropped'] => ({
  'unknown-source': [],
  'not-a-report': [],
  'no-country': [],
  'no-topic': [],
  'below-floor': [],
  prefiltered: [],
  'not-relevant': [],
  'low-confidence': [],
  'classification-failed': [],
})

interface Prepared {
  eligible: { article: RawArticle; profile: OutletProfile; time: number }[]
  duplicateUrls: number
}

/** Shared by both paths: dedupe URLs, require a vetted outlet profile, drop commentary URLs, decode feed text. */
function prepare(articles: RawArticle[], profiles: SourceProfile[], now: string, drop: (r: DropReason, a: RawArticle) => void): Prepared {
  const outletProfiles = new Map(profiles.filter((p): p is OutletProfile => p.sourceType === 'outlet').map((p) => [p.id, p]))
  // The same URL can arrive through two feeds (Bloomberg markets + politics).
  const seenUrls = new Set<string>()
  const unique = articles.filter((a) => (seenUrls.has(a.url) ? false : (seenUrls.add(a.url), true)))
  const eligible: Prepared['eligible'] = []
  for (const raw of unique) {
    // Decode here, at the ONE point every path passes through, rather than at
    // fetch: the archive is append-only, so records stored before the parser
    // learned about numeric character references still carry them, and the
    // Event title, the clusterer's text and the keyword rules should all see
    // the same decoded string (see htmlEntities.ts).
    const article: RawArticle = {
      ...raw,
      title: decodeHtmlEntities(raw.title),
      ...(raw.description ? { description: decodeHtmlEntities(raw.description) } : {}),
    }
    const profile = outletProfiles.get(article.sourceId)
    if (!profile) {
      drop('unknown-source', article)
      continue
    }
    if (isCommentaryUrl(article.url)) {
      drop('not-a-report', article)
      continue
    }
    const parsed = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN
    eligible.push({ article, profile, time: Number.isNaN(parsed) ? Date.parse(now) : parsed })
  }
  return { eligible, duplicateUrls: articles.length - unique.length }
}

interface Cluster {
  /** Time-ordered, so [0] is the first report. */
  members: Candidate[]
  /** Set by the LLM grouping pass; undefined on the heuristic path. */
  title?: string
}

/** Shared by both paths: build each Event's dossier and run it through the corroboration gate. */
function assemble(clusters: Cluster[], now: string, drop: (r: DropReason, a: RawArticle) => void): { published: NewsEvent[]; pending: NewsEvent[] } {
  const published: NewsEvent[] = []
  const pending: NewsEvent[] = []
  for (const { members, title } of clusters) {
    const first = members.find((c) => c.profile.tier === 'wire') ?? members[0]
    const event: NewsEvent = {
      // Keyed to the earliest article, so an id survives later reports
      // joining the cluster. It does NOT survive an earlier report arriving
      // (BACKLOG.md: matters once manual confirmations must persist).
      id: `evt-${stableHash(members[0].article.url)}`,
      // Heuristic path: an outlet's own headline. LLM path: the grouping
      // pass's neutral rewrite (design §17b: "short, neutral, factual").
      title: title ?? first.title,
      eventTimestamp: new Date(members[0].time).toISOString(),
      // Union, first-mention order: the earliest report's principal country leads.
      linkedEntityIds: [...new Set(members.flatMap((c) => c.linkedEntityIds))],
      topicTags: [...new Set(members.flatMap((c) => c.topicTags))],
      systemicThemes: [...new Set(members.flatMap((c) => c.systemicThemes))],
      // The Event carries its most serious member claim; the gate then makes
      // that claim earn its tier via the WHOLE dossier's corroboration.
      severity: maxSeverity(members.map((c) => c.severity)),
      ...(members.some((c) => c.headOfStateDeathClaim) ? { headOfStateDeathClaim: true } : {}),
      reviewStatus: 'auto-published',
      sources: members.map(outletEntry),
      snapshotDate: now,
    }

    const decision = resolvePublishDecision(event)
    if (decision.outcome === 'below-floor') {
      for (const c of members) drop('below-floor', c.article)
    } else if (decision.outcome === 'pending-confirmation') {
      pending.push({ ...event, reviewStatus: decision.reviewStatus })
    } else {
      published.push({ ...event, reviewStatus: decision.reviewStatus })
    }
  }
  const newestFirst = (a: NewsEvent, b: NewsEvent) => b.eventTimestamp.localeCompare(a.eventTimestamp)
  return { published: published.sort(newestFirst), pending: pending.sort(newestFirst) }
}

// ---------------------------------------------------------------------------
// Phase 2 — keyword classification, heuristic clustering. Still the path when
// there is no API key, and the reference the LLM path is compared against.

export function buildEvents(articles: RawArticle[], { profiles, countryMatchers, now }: BuildContext): BuildResult {
  const dropped = emptyDropped()
  const drop = (reason: DropReason, a: RawArticle) => dropped[reason].push({ title: a.title, sourceId: a.sourceId })
  const { eligible, duplicateUrls } = prepare(articles, profiles, now, drop)

  const candidates: Candidate[] = []
  for (const { article, profile, time } of eligible) {
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
    candidates.push({ key: article.url, title: article.title, linkedEntityIds, time, article, profile, systemicThemes: [], ...classification })
  }

  const clusters = clusterArticles(candidates)
  const { published, pending } = assemble(
    clusters.map((members) => ({ members })),
    now,
    drop,
  )
  return { published, pending, dropped, articlesIn: articles.length, duplicateUrls, clusters: clusters.length }
}

// ---------------------------------------------------------------------------
// Local embeddings — same-event grouping by sentence-embedding similarity, and
// (when a classifier is supplied) relevance and topic tags from the same
// vectors. Free, keyless, offline after the one-time model download. Severity,
// countries and titles are still keyword/outlet-headline; the classifier's
// evaluation showed it does NOT beat the severity regexes (embeddingClassifier.ts).

export async function buildEventsWithEmbeddings(articles: RawArticle[], { profiles, countryMatchers, now }: BuildContext, embed: Embedder,
  options: {
    /** Cosine link threshold for clustering; defaults to EMBED_LINK_THRESHOLD. */
    threshold?: number
    /** Relevance gate + topic tags. Omit/null for keyword tags and no relevance gate. */
    classifier?: EmbeddingClassifier | null
  } = {},
): Promise<BuildResult> {
  const dropped = emptyDropped()
  const drop = (reason: DropReason, a: RawArticle) => dropped[reason].push({ title: a.title, sourceId: a.sourceId })
  const { eligible, duplicateUrls } = prepare(articles, profiles, now, drop)

  // Wide pre-filter, as on the LLM path: a country name OR a topic keyword. A story whose headline names no country
  // ("10-year Treasury yield tops 5%") can still join a cluster whose other members do.
  const candidates: Candidate[] = []
  const texts: string[] = []
  for (const { article, profile, time } of eligible) {
    const text = `${article.title}. ${article.description ?? ''}`
    const linkedEntityIds = resolveCountryIds(text, countryMatchers)
    const classification = classifyText(text)
    if (linkedEntityIds.length === 0 && classification.topicTags.length === 0) {
      drop('prefiltered', article)
      continue
    }
    candidates.push({ key: article.url, title: article.title, linkedEntityIds, time, article, profile, systemicThemes: [], keywordTopic: classification.topicTags.length > 0, ...classification })
    texts.push(embeddingText(article.title, article.description))
  }

  const vectors = candidates.length > 0 ? await embed(texts) : []
  const classifier = options.classifier ?? null
  if (classifier) {
    candidates.forEach((c, i) => {
      const pred = classifier.classify(vectors[i])
      c.relevance = pred.relevance
      c.topicTags = pred.tags
      // The tier regexes still decide severity; only the CAPS depend on tags (crime/sci-tech alone cap at Major), so re-apply them to the new tags.
      c.severity = applySeverityCaps(c.severity, { topicTags: pred.tags })
    })
  }
  const clustered = clusterByEmbedding(
    candidates.map((c, i) => ({ ...c, vector: vectors[i] })),
    options.threshold,
  )

  // A cluster is only publishable if SOME member gives it a country and a topic (the Event union, as everywhere else).
  const clusters: Cluster[] = []
  for (const members of clustered) {
    // Judged per CLUSTER, on the mean relevance: several outlets' headlines are far better evidence than one, and a single
    // mis-scored member can't sink or rescue an Event. Two regimes (embeddingClassifier.ts explains why):
    //  - keyword topic evidence present  -> the classifier is a mild gate (RELEVANCE_THRESHOLD);
    //  - none                            -> the classifier must be very sure (RESCUE_THRESHOLD) or the cluster is dropped, as before.
    const keywordTopic = members.some((m) => m.keywordTopic)
    const mean = members.reduce((a, m) => a + (m.relevance ?? 1), 0) / members.length
    if (classifier && (keywordTopic ? mean < RELEVANCE_THRESHOLD : mean < RESCUE_THRESHOLD)) {
      for (const m of members) drop(keywordTopic ? 'not-relevant' : 'no-topic', m.article)
    } else if (!members.some((m) => m.linkedEntityIds.length > 0)) {
      for (const m of members) drop('no-country', m.article)
    } else if (!classifier && !keywordTopic) {
      for (const m of members) drop('no-topic', m.article)
    } else {
      clusters.push({ members })
    }
  }
  const { published, pending } = assemble(clusters, now, drop)
  return { published, pending, dropped, articlesIn: articles.length, duplicateUrls, clusters: clustered.length }
}

// ---------------------------------------------------------------------------
// Phase 3 — LLM classification and same-event grouping.

export interface LlmBuildContext extends BuildContext {
  call: LlmCall
  /** Model id, for the cache key. */
  model: string
  /** Every UN member plus Taiwan, by registry id and display name. */
  countries: { id: string; name: string }[]
  themes: SystemicThemeConfig[]
  cache?: ClassificationCache
  /** Classify only the N newest candidates — a cheap first live run. */
  limit?: number
  batchSize?: number
}

/** One row per article the LLM saw, for calibration — never shipped, never shown to readers. */
export interface AuditRow {
  url: string
  source: string
  title: string
  route: string
  cached: boolean
  severity?: string
  severityReason?: string
  confidence?: string
  isReport?: boolean
  headOfStateDeathClaim?: boolean
}

export interface LlmBuildResult extends BuildResult {
  llm: {
    usage: LlmUsage
    candidates: number
    classified: number
    cacheHits: number
    failed: number
    /** Distinct reasons classification calls failed (auth, schema, truncation...), so a run can say WHY instead of just how many. */
    failureReasons: string[]
    grouping: GroupResult['anomalies']
    audit: AuditRow[]
  }
}

export async function buildEventsWithLlm(articles: RawArticle[], ctx: LlmBuildContext): Promise<LlmBuildResult> {
  const { profiles, countryMatchers, now } = ctx
  const dropped = emptyDropped()
  const drop = (reason: DropReason, a: RawArticle) => dropped[reason].push({ title: a.title, sourceId: a.sourceId })
  const { eligible, duplicateUrls } = prepare(articles, profiles, now, drop)

  // Wide pre-filter (design §6: "deliberately crude/wide — only needs to avoid
  // discarding real candidates"). Unlike Phase 2 it does NOT require a country
  // hit — the model links countries, which recovers "Trump ... ICC" style
  // stories the keyword matcher can't — so an article survives on EITHER a
  // country name OR a topic keyword. Sports and product news match neither.
  let candidates = eligible.filter(({ article }) => {
    const text = `${article.title}. ${article.description ?? ''}`
    const keep = resolveCountryIds(text, countryMatchers).length > 0 || resolveTopicTags(text).length > 0
    if (!keep) drop('prefiltered', article)
    return keep
  })
  if (ctx.limit !== undefined && candidates.length > ctx.limit) {
    candidates = [...candidates].sort((a, b) => b.time - a.time).slice(0, ctx.limit)
  }

  const usage = emptyUsage()
  const items: (ClassifyItem & { candidateIndex: number })[] = candidates.map(({ article, profile, time }, i) => ({
    id: `a${i}`,
    candidateIndex: i,
    source: profile.name,
    publishedAt: new Date(time).toISOString(),
    title: article.title,
    summary: article.description ?? '',
    url: article.url,
  }))
  const outcomes = await classifyArticles(items, { call: ctx.call, model: ctx.model, countries: ctx.countries, themes: ctx.themes, cache: ctx.cache, batchSize: ctx.batchSize, usage })

  const nameById = new Map(ctx.countries.map((c) => [c.id, c.name]))
  const audit: AuditRow[] = []
  const accepted: { candidate: Candidate; group: GroupItem }[] = []
  let cacheHits = 0
  let failed = 0
  const failureReasons = new Set<string>()
  for (const item of items) {
    const { article, profile, time } = candidates[item.candidateIndex]
    const outcome = outcomes.get(item.id)
    const base = { url: article.url, source: profile.name, title: article.title }
    if (!outcome || outcome.status === 'failed') {
      failed++
      if (outcome) failureReasons.add(outcome.reason)
      drop('classification-failed', article)
      audit.push({ ...base, route: 'classification-failed', cached: false })
      continue
    }
    if (outcome.cached) cacheHits++
    const c = outcome.result
    const route = routeClassification(c)
    audit.push({ ...base, route, cached: outcome.cached, severity: c.severity, severityReason: c.severityReason, confidence: c.confidence, isReport: c.isReport, headOfStateDeathClaim: c.headOfStateDeathClaim })
    if (route !== 'accept') {
      drop(route as DropReason, article)
      continue
    }
    const candidate: Candidate = {
      key: article.url,
      title: article.title,
      linkedEntityIds: c.countryIds,
      time,
      article,
      profile,
      topicTags: c.topicTags,
      severity: c.severity,
      systemicThemes: c.systemicThemes,
      // OR with the regex: over-flagging only routes an Event to the manual queue.
      headOfStateDeathClaim: c.headOfStateDeathClaim || matchesHeadOfStateDeath(`${article.title}. ${article.description ?? ''}`),
    }
    accepted.push({
      candidate,
      group: {
        id: item.id,
        key: article.url,
        source: profile.name,
        publishedAt: item.publishedAt,
        title: article.title,
        summary: article.description ?? '',
        countries: c.countryIds.map((id) => nameById.get(id) ?? id),
        topicTags: c.topicTags,
        linkedEntityIds: c.countryIds,
        time,
      },
    })
  }

  const grouped = await groupArticles(
    accepted.map((a) => a.group),
    { call: ctx.call, usage },
  )
  const candidateByUrl = new Map(accepted.map((a) => [a.candidate.key, a.candidate]))
  const clusters: Cluster[] = grouped.groups.map((g: EventGroup) => ({
    title: g.title,
    members: g.members.map((m) => candidateByUrl.get(m.key)!),
  }))
  const { published, pending } = assemble(clusters, now, drop)

  return {
    published,
    pending,
    dropped,
    articlesIn: articles.length,
    duplicateUrls,
    clusters: clusters.length,
    llm: { usage, candidates: candidates.length, classified: items.length - failed, cacheHits, failed, failureReasons: [...failureReasons].slice(0, 3), grouping: grouped.anomalies, audit },
  }
}
