import { useCallback, useEffect, useState } from 'react'
import { fetchConfig, fetchReview, type ConfigPayload, type ReviewPayload } from './api'
import { ReviewQueueView } from './ReviewQueueView'
import { SourcesView } from './SourcesView'
import { ThemesView } from './ThemesView'
import { Banner, Empty } from './ui'
import type { SourceProfile, SystemicThemeConfig } from '../src/news/types'

// Atlas Admin Console (news-sourcing-design.md §14) — Phase 5. Private,
// local-only tooling for the News Engine's editorial inputs. Not part of the
// globe app and never built into dist/.
//
// Two rhythms in one tool, kept navigationally apart exactly as §14 asked:
// EDITORIAL is occasional upkeep (a source's leaning, the quarterly theme
// review); REVIEW QUEUE is rare, urgent and high-stakes. They share nothing
// but the shell.

type Tab = 'editorial' | 'review'

const TABS: { id: Tab; label: string }[] = [
  { id: 'editorial', label: 'Editorial data' },
  { id: 'review', label: 'Review queue' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('editorial')
  const [config, setConfig] = useState<ConfigPayload | null>(null)
  const [review, setReview] = useState<ReviewPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadReview = useCallback(() => {
    fetchReview().then(setReview).catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    fetchConfig().then(setConfig).catch((err: Error) => setError(err.message))
    loadReview()
  }, [loadReview])

  // A save rewrites the file, so the baseline the "unsaved" marker compares
  // against moves with it — otherwise the console keeps reporting a saved
  // change as a pending one. `tally` deliberately does NOT move: it's the
  // baseline for "sourceConfig.test.ts still asserts the old number", which
  // saving the file doesn't fix. That warning should persist until the test is
  // updated, which is the whole point of showing it.
  const onSourcesSaved = (sources: SourceProfile[]) => setConfig((c) => (c ? { ...c, sources } : c))
  const onThemesSaved = (themes: SystemicThemeConfig[]) => setConfig((c) => (c ? { ...c, themes } : c))

  const pendingCount = review?.pending.length ?? 0

  return (
    <div className="mx-auto min-h-full max-w-6xl px-6 py-8">
      <header className="mb-6 border-b border-cyan-500/20 pb-4">
        <h1 className="font-display text-xl font-semibold tracking-[0.25em] text-cyan-200 uppercase">Atlas Admin</h1>
        <p className="mt-1 font-mono text-[11px] text-cyan-100/40">
          News Engine editorial console · local only, no auth · writes the build's input files directly
        </p>
        <nav className="mt-4 flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded border px-3 py-1.5 font-display text-xs font-semibold tracking-[0.15em] uppercase transition-colors ${
                tab === t.id ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200' : 'border-cyan-500/20 text-cyan-100/45 hover:text-cyan-100/80'
              }`}
            >
              {t.label}
              {t.id === 'review' && pendingCount > 0 && (
                <span className="ml-2 rounded border border-rose-400/50 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {error && <Banner tone="warn">{error}</Banner>}

      {tab === 'editorial' ? (
        config ? (
          <>
            <SourcesView config={config} onSaved={onSourcesSaved} />
            <ThemesView config={config} onSaved={onThemesSaved} />
          </>
        ) : (
          <Empty>Loading editorial config…</Empty>
        )
      ) : review ? (
        <ReviewQueueView review={review} onReload={loadReview} />
      ) : (
        <Empty>Loading review queue…</Empty>
      )}
    </div>
  )
}
