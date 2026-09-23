import { useState } from 'react'
import { ApiError, submitDecision, type ReviewPayload } from './api'
import { deriveCorroboration } from '../src/news/corroboration'
import { findConfirmation, type ConfirmationRecord } from '../src/news/confirmations'
import type { NewsEvent } from '../src/news/types'
import { Banner, Button, Empty, Panel, TextArea } from './ui'

// The head-of-state/government death review queue (design §8, §14) — the one
// manual-review surface the whole pipeline has.
//
// §14 asked for this to be kept visually and navigationally distinct from the
// editorial-data views, because the two rhythms are nothing alike: source
// leanings are quarterly upkeep, this is rare and urgent and publishes a claim
// about someone being killed. Hence its own tab, its own red framing, and a
// confirm button that makes you look at the dossier first.

function Dossier({ event }: { event: NewsEvent }) {
  const distinct = new Set(event.sources.map((s) => s.sourceId)).size
  return (
    <div className="mt-3 rounded border border-cyan-500/15 bg-[#04070a] p-3">
      <p className="mb-2 font-mono text-[10px] tracking-[0.15em] text-cyan-100/40 uppercase">
        Dossier — {event.sources.length} report(s), {distinct} distinct source(s) · {deriveCorroboration(event.sources)}
      </p>
      <ul className="space-y-1.5">
        {event.sources.map((source) => (
          <li key={source.id} className="font-mono text-[11px]">
            <span className="text-cyan-200/80">{'outlet' in source ? source.outlet : source.sourceId}</span>
            {'pressControl' in source && source.pressControl && <span className="ml-1 text-amber-300/70">[{source.pressControl}]</span>}
            <span className="ml-1 text-cyan-100/30">{source.timestamp.replace('T', ' ').slice(0, 16)}</span>
            <a href={source.refUrl} target="_blank" rel="noreferrer" className="ml-2 text-cyan-400/70 underline decoration-dotted hover:text-cyan-300">
              open report ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QueueItem({ event, prior, onDecided }: { event: NewsEvent; prior: ConfirmationRecord | undefined; onDecided: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = async (decision: 'confirmed' | 'rejected') => {
    setBusy(true)
    setError(null)
    try {
      await submitDecision(event.id, decision, note)
      onDecided()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded border border-rose-400/30 bg-rose-500/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded border border-rose-400/40 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-rose-300 uppercase">head-of-state death claim</span>
        <span className="font-mono text-[10px] text-cyan-100/35">{event.eventTimestamp.replace('T', ' ').slice(0, 16)}</span>
        <span className="font-mono text-[10px] text-cyan-100/25">{event.id}</span>
      </div>
      <h3 className="mt-2 font-display text-base text-cyan-50">{event.title}</h3>
      {prior && (
        <Banner tone="warn">
          Already decided <strong>{prior.decision}</strong> on {prior.decidedAt.slice(0, 10)}
          {prior.note ? ` — “${prior.note}”` : ''}. It is queued again because the current build still matches it; deciding again replaces that record.
        </Banner>
      )}

      <Dossier event={event} />

      <div className="mt-3">
        <TextArea rows={2} value={note} onChange={setNote} placeholder="What settled it? (which report, what was checked) — stored with the decision" />
      </div>
      {error && <Banner tone="warn">{error}</Banner>}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={() => decide('confirmed')} tone="primary" disabled={busy}>
          Confirm & publish
        </Button>
        <Button onClick={() => decide('rejected')} tone="danger" disabled={busy}>
          Reject
        </Button>
        <span className="font-mono text-[10px] text-cyan-100/35">
          Takes effect on the next <code>npm run build:news:events</code>.
        </span>
      </div>
    </li>
  )
}

export function ReviewQueueView({ review, onReload }: { review: ReviewPayload; onReload: () => void }) {
  const [showTrail, setShowTrail] = useState(false)
  const trail = [...review.confirmations].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))

  return (
    <>
      <Panel title="Review queue" subtitle={`${review.pending.length} awaiting a decision · ${review.files.pending}`} actions={<Button onClick={onReload}>Reload</Button>}>
        <Banner tone="info">
          A claim here has already cleared the Critical corroboration floor — the gate holds it anyway, because a head-of-state death is the
          highest-consequence, most rumor-prone claim the pipeline handles. It is never in the public asset and never reaches a reader until confirmed.
        </Banner>

        {!review.queueBuilt ? (
          <Empty>
            No queue file yet — run <code className="text-cyan-300">npm run build:news:events</code> first.
          </Empty>
        ) : review.pending.length === 0 ? (
          <Empty>Queue is empty. Nothing awaiting confirmation.</Empty>
        ) : (
          <ul className="space-y-4">
            {review.pending.map((event) => (
              <QueueItem key={event.id} event={event} prior={findConfirmation(review.confirmations, event)} onDecided={onReload} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Decision trail"
        subtitle={`${trail.length} recorded · ${review.files.confirmations}`}
        actions={<Button onClick={() => setShowTrail((v) => !v)}>{showTrail ? 'Hide' : 'Show'}</Button>}
      >
        <Banner tone="info">
          Decisions live outside the repo (the gitignored archive, this machine only) because they are not regenerable — the build is stateless, so
          without this store a confirmation would publish once and silently vanish on the next run. Rejected rumors are not committed to git for the same
          reason they are not served from <code>public/</code>.
        </Banner>
        {!showTrail ? null : trail.length === 0 ? (
          <Empty>No decision has been recorded on this machine.</Empty>
        ) : (
          <ul className="divide-y divide-cyan-500/10 rounded border border-cyan-500/15">
            {trail.map((record) => (
              <li key={`${record.eventId}-${record.decidedAt}`} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${record.decision === 'confirmed' ? 'border-emerald-400/40 text-emerald-300/80' : 'border-rose-400/40 text-rose-300/80'}`}>
                    {record.decision}
                  </span>
                  <span className="font-display text-sm text-cyan-100/80">{record.title}</span>
                  <span className="ml-auto font-mono text-[10px] text-cyan-100/30">{record.decidedAt.replace('T', ' ').slice(0, 16)}</span>
                </div>
                {record.note && <p className="mt-1 font-mono text-[11px] text-cyan-100/45">{record.note}</p>}
                <p className="mt-1 font-mono text-[10px] text-cyan-100/25">{record.articleUrls.length} article URL(s) recorded as the match key</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
