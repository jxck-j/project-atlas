import { useMemo, useState } from 'react'
import { ApiError, saveSources, type ConfigPayload } from './api'
import { leaningTally, validateSources, type ValidationIssue } from '../src/news/configValidation'
import type { AnalysisProfile, OutletProfile, SourceProfile } from '../src/news/types'
import { Banner, Button, Checkbox, Empty, Field, IssueList, Panel, Select, TextArea, TextInput } from './ui'

// Source leaning/vetting review (design §14's first named job — the AllSides
// pass that was done by hand in a chat session). One roster, one editor, one
// save; the console holds the whole array in state and writes it as a unit,
// because the invariants it must not break (unique ids, the tally) are
// properties of the roster, not of a record.

const BLANK = { value: '', label: '—' }
const opts = (...values: string[]) => [BLANK, ...values.map((v) => ({ value: v, label: v }))]

const LEANINGS = opts('left', 'lean-left', 'center', 'lean-right', 'right')
const CONFIDENCES = opts('high', 'medium', 'low/initial')
const TIERS = opts('wire', 'broadsheet', 'broadcast', 'regional-specialist', 'country-native')
const PRESS_CONTROLS = opts('state-controlled', 'state-run-democratic', 'independent', 'exile')
const VETTINGS = [
  { value: 'confirmed', label: 'confirmed' },
  { value: 'provisional', label: 'provisional' },
]

type Filter = 'all' | 'provisional' | 'contested' | 'unrated' | 'country-native' | 'analysis'

const FILTERS: { id: Filter; label: string; match: (s: SourceProfile) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  // The standing re-vetting backlog: the design doc flagged these as not
  // directly reconfirmed, and this is the surface that clears them.
  { id: 'provisional', label: 'Provisional', match: (s) => s.vetting === 'provisional' },
  { id: 'contested', label: 'Contested', match: (s) => s.sourceType === 'outlet' && !!s.contested },
  { id: 'unrated', label: 'Unrated', match: (s) => s.sourceType === 'outlet' && !s.leaning && !s.pressControl },
  { id: 'country-native', label: 'Country-native', match: (s) => s.sourceType === 'outlet' && s.tier === 'country-native' },
  { id: 'analysis', label: 'Analysis orgs', match: (s) => s.sourceType === 'analysis' },
]

/** Sets a field, deleting it when the form blanks it — the files carry absent fields, never empty strings. */
function withField<T extends SourceProfile>(source: T, field: string, value: string | boolean | undefined): T {
  const next = { ...source } as Record<string, unknown>
  if (value === '' || value === undefined || value === false) delete next[field]
  else next[field] = value
  return next as T
}

function OutletEditor({ source, countryNames, onChange }: { source: OutletProfile; countryNames: string[]; onChange: (next: OutletProfile) => void }) {
  const set = (field: string, value: string | boolean | undefined) => onChange(withField(source, field, value))
  const isNative = source.tier === 'country-native'
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Name">
        <TextInput value={source.name} onChange={(v) => set('name', v)} />
      </Field>
      <Field label="Tier">
        <Select
          value={source.tier ?? ''}
          options={TIERS}
          onChange={(v) => {
            // Leaving country-native must take its country-only fields with
            // it, or the save is refused for fields the form no longer shows.
            let next = withField(source, 'tier', v)
            if (v !== 'country-native') {
              next = withField(next, 'countryName', undefined)
              next = withField(next, 'pressControl', undefined)
              next = withField(next, 'pressFreedomContext', undefined)
            }
            onChange(next)
          }}
        />
      </Field>

      {isNative ? (
        <>
          <Field label="Country" hint="Must match a UN-193 topology name (or Taiwan).">
            <Select value={source.countryName ?? ''} options={[BLANK, ...countryNames.map((n) => ({ value: n, label: n }))]} onChange={(v) => set('countryName', v)} />
          </Field>
          <Field label="Press control" hint="Replaces leaning — AllSides' left/right doesn't apply here.">
            <Select value={source.pressControl ?? ''} options={PRESS_CONTROLS} onChange={(v) => onChange(withField(withField(source, 'pressControl', v), 'leaning', undefined))} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Press-freedom context" hint='Required. Format: "RSF World Press Freedom Index 2026: 177/180 (score …)."'>
              <TextArea rows={2} value={source.pressFreedomContext ?? ''} onChange={(v) => set('pressFreedomContext', v)} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Affiliation note" hint="For competing-authority outlets (Yemen's two SABAs, Libya) a single label can't separate.">
              <TextInput value={source.affiliationNote ?? ''} onChange={(v) => set('affiliationNote', v)} />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Leaning">
            <Select value={source.leaning ?? ''} options={LEANINGS} onChange={(v) => onChange(v === '' ? withField(withField(withField(withField(source, 'leaning', undefined), 'leaningSource', undefined), 'leaningConfidence', undefined), 'contested', false) : withField(source, 'leaning', v))} />
          </Field>
          <Field label="Leaning source" hint="Required with a leaning. AllSides first; Ad Fontes / MBFC only as fallback.">
            <TextInput value={source.leaningSource ?? ''} onChange={(v) => set('leaningSource', v)} disabled={!source.leaning} />
          </Field>
          <Field label="Leaning confidence" hint="AllSides' own stated confidence. Leave blank where it states none.">
            <Select value={source.leaningConfidence ?? ''} options={CONFIDENCES} onChange={(v) => set('leaningConfidence', v)} disabled={!source.leaning} />
          </Field>
          <div className="flex items-end pb-1">
            <Checkbox checked={!!source.contested} onChange={(v) => set('contested', v)} label="Contested rating" />
          </div>
        </>
      )}

      <Field label="Caveat" hint="Surfaced in the reader-facing caption bar, not buried.">
        <TextInput value={source.caveat ?? ''} onChange={(v) => set('caveat', v)} />
      </Field>
      <Field label="Vetting">
        <Select value={source.vetting} options={VETTINGS} onChange={(v) => set('vetting', v)} />
      </Field>
      <div className="md:col-span-2">
        <Field label="Notes">
          <TextArea value={source.notes ?? ''} onChange={(v) => set('notes', v)} />
        </Field>
      </div>
    </div>
  )
}

function AnalysisEditor({ source, onChange }: { source: AnalysisProfile; onChange: (next: AnalysisProfile) => void }) {
  const set = (field: string, value: string | boolean | undefined) => onChange(withField(source, field, value))
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Name">
        <TextInput value={source.name} onChange={(v) => set('name', v)} />
      </Field>
      <Field label="Vetting">
        <Select value={source.vetting} options={VETTINGS} onChange={(v) => set('vetting', v)} />
      </Field>
      <div className="flex items-end pb-1">
        <Checkbox checked={!!source.specialistVerified} onChange={(v) => set('specialistVerified', v)} label="Specialist-verified (own verification methodology)" />
      </div>
      <div className="md:col-span-2">
        <Field label="Notes">
          <TextArea value={source.notes ?? ''} onChange={(v) => set('notes', v)} />
        </Field>
      </div>
      <p className="font-mono text-[10px] text-cyan-100/35 md:col-span-2">
        Label is fixed at “Non-partisan analysis” and an analysis org never carries a leaning (§7) — neither is editable.
      </p>
    </div>
  )
}

function badge(source: SourceProfile): { text: string; className: string } {
  if (source.sourceType === 'analysis') return { text: 'analysis', className: 'text-violet-300/80 border-violet-400/30' }
  if (source.pressControl) return { text: source.pressControl, className: 'text-amber-300/80 border-amber-400/30' }
  if (source.leaning) return { text: source.leaning, className: 'text-cyan-300/80 border-cyan-400/30' }
  return { text: 'unrated', className: 'text-cyan-100/40 border-cyan-500/20' }
}

export function SourcesView({ config, onSaved }: { config: ConfigPayload; onSaved: (sources: SourceProfile[]) => void }) {
  const [sources, setSources] = useState<SourceProfile[]>(config.sources)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [rejected, setRejected] = useState<{ message: string; issues: ValidationIssue[] } | null>(null)

  const dirty = useMemo(() => JSON.stringify(sources) !== JSON.stringify(config.sources), [sources, config.sources])
  // Live, so a rule break is visible while typing rather than only on a
  // refused save. Country names are checked server-side too, where the
  // topology actually lives.
  const issues = useMemo(() => validateSources(sources, new Set(config.countryNames)), [sources, config.countryNames])
  const tally = useMemo(() => leaningTally(sources), [sources])
  const tallyMoved = tally.left !== config.tally.left || tally.center !== config.tally.center || tally.right !== config.tally.right

  const matcher = FILTERS.find((f) => f.id === filter)!.match
  const visible = sources.filter((s) => matcher(s) && (query === '' || s.name.toLowerCase().includes(query.toLowerCase()) || s.id.includes(query.toLowerCase())))

  const update = (next: SourceProfile) => setSources((all) => all.map((s) => (s.id === next.id ? next : s)))

  const save = async () => {
    setSaved(null)
    setRejected(null)
    try {
      const result = await saveSources(sources)
      setSaved(`Wrote ${config.files.sources} — ${result.saved} sources.`)
      onSaved(sources)
    } catch (err) {
      if (err instanceof ApiError) setRejected({ message: err.message, issues: err.issues })
      else throw err
    }
  }

  return (
    <Panel
      title="Sources"
      subtitle={`${sources.length} profiles · ${config.files.sources}`}
      actions={
        <>
          {dirty && <span className="font-mono text-[10px] text-amber-300/80">unsaved</span>}
          <Button onClick={() => setSources(config.sources)} disabled={!dirty}>
            Revert
          </Button>
          <Button onClick={save} tone="primary" disabled={!dirty || issues.length > 0}>
            Save
          </Button>
        </>
      }
    >
      {saved && <Banner tone="good">{saved}</Banner>}
      {rejected && <Banner tone="warn">{rejected.message}</Banner>}
      <IssueList issues={rejected?.issues ?? []} heading="The server refused this write" />
      <IssueList issues={issues} heading={`${issues.length} invariant(s) broken — saving is blocked`} />

      {tallyMoved && (
        <Banner tone="warn">
          Left/Center/Right is now {tally.left}/{tally.center}/{tally.right}, was {config.tally.left}/{config.tally.center}/{config.tally.right}.
          <code className="ml-1 text-amber-100">src/news/sourceConfig.test.ts</code> asserts that tally — update its expectation in the same commit, or <code>npm test</code> will fail.
        </Banner>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const count = sources.filter(f.match).length
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded border px-2.5 py-1 font-display text-[11px] tracking-[0.1em] uppercase transition-colors ${
                filter === f.id ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200' : 'border-cyan-500/20 text-cyan-100/50 hover:text-cyan-100/80'
              }`}
            >
              {f.label} <span className="text-cyan-100/35">{count}</span>
            </button>
          )
        })}
        <div className="ml-auto w-56">
          <TextInput value={query} onChange={setQuery} placeholder="filter by name or id…" />
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty>No source matches this filter.</Empty>
      ) : (
        <ul className="divide-y divide-cyan-500/10 rounded border border-cyan-500/15">
          {visible.map((source) => {
            const tag = badge(source)
            const open = openId === source.id
            const broken = issues.some((i) => i.id === source.id)
            return (
              <li key={source.id} className={broken ? 'bg-rose-500/5' : undefined}>
                <button type="button" onClick={() => setOpenId(open ? null : source.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cyan-400/5">
                  <span className="font-display text-sm text-cyan-50">{source.name}</span>
                  <span className="font-mono text-[10px] text-cyan-100/30">{source.id}</span>
                  <span className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px] ${tag.className}`}>{tag.text}</span>
                  {source.sourceType === 'outlet' && source.contested && <span className="rounded border border-amber-400/30 px-1.5 py-0.5 font-mono text-[10px] text-amber-300/80">contested</span>}
                  {source.vetting === 'provisional' && <span className="rounded border border-amber-400/30 px-1.5 py-0.5 font-mono text-[10px] text-amber-300/80">provisional</span>}
                  <span className="font-mono text-[10px] text-cyan-100/30">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="border-t border-cyan-500/10 bg-[#04070a] px-4 py-4">
                    {source.sourceType === 'outlet' ? (
                      <OutletEditor source={source} countryNames={config.countryNames} onChange={update} />
                    ) : (
                      <AnalysisEditor source={source} onChange={update} />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
