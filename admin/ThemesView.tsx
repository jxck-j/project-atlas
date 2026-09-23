import { useMemo, useState } from 'react'
import { ApiError, saveThemes, type ConfigPayload } from './api'
import { validateThemes, type ValidationIssue } from '../src/news/configValidation'
import type { SystemicThemeConfig } from '../src/news/types'
import { Banner, Button, Empty, Field, IssueList, Panel, TextInput } from './ui'

// The systemic-theme quarterly review (design §4b, §14). The one rule this
// view has to make unmissable: retirement is ARCHIVAL, never deletion — an
// archived theme keeps its linkage to every historical Event that carries its
// id, and can flip back to active. So there is an Archive button and no delete
// button, and an archived theme stays on screen rather than disappearing.

const today = () => new Date().toISOString().slice(0, 10)

const slugify = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export function ThemesView({ config, onSaved }: { config: ConfigPayload; onSaved: (themes: SystemicThemeConfig[]) => void }) {
  const [themes, setThemes] = useState<SystemicThemeConfig[]>(config.themes)
  const [newLabel, setNewLabel] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [rejected, setRejected] = useState<{ message: string; issues: ValidationIssue[] } | null>(null)

  const dirty = useMemo(() => JSON.stringify(themes) !== JSON.stringify(config.themes), [themes, config.themes])
  const issues = useMemo(() => validateThemes(themes), [themes])
  const active = themes.filter((t) => t.status === 'active').length
  // Same tripwire the sources tally has: sourceConfig.test.ts asserts the
  // Phase 1 starting state (ten themes, all active), which the first real
  // quarterly archive — this panel's whole purpose — necessarily invalidates.
  const testTripped = themes.length !== 10 || active !== themes.length

  const flip = (id: string) =>
    setThemes((all) =>
      all.map((t) => (t.id === id ? { ...t, status: t.status === 'active' ? 'archived' : 'active', statusChangedAt: today() } : t)),
    )

  const add = () => {
    const label = newLabel.trim()
    if (!label) return
    const id = slugify(label)
    if (themes.some((t) => t.id === id)) return
    setThemes((all) => [...all, { id, label, status: 'active', statusChangedAt: today() }])
    setNewLabel('')
  }

  const save = async () => {
    setSaved(null)
    setRejected(null)
    try {
      const result = await saveThemes(themes)
      setSaved(`Wrote ${config.files.themes} — ${result.saved} themes.`)
      onSaved(themes)
    } catch (err) {
      if (err instanceof ApiError) setRejected({ message: err.message, issues: err.issues })
      else throw err
    }
  }

  return (
    <Panel
      title="Systemic themes"
      subtitle={`${active} active of ${themes.length} · ${config.files.themes}`}
      actions={
        <>
          {dirty && <span className="font-mono text-[10px] text-amber-300/80">unsaved</span>}
          <Button onClick={() => setThemes(config.themes)} disabled={!dirty}>
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
      <IssueList issues={issues} heading={`${issues.length} problem(s) — saving is blocked`} />

      <Banner tone="info">
        Retirement is archival, never deletion. An archived theme keeps its linkage to every historical Event carrying its id and can be reactivated — which is why nothing here deletes.
      </Banner>

      {testTripped && (
        <Banner tone="warn">
          <code className="text-amber-100">src/news/sourceConfig.test.ts</code> asserts the Phase 1 starting state — ten themes, all active. This roster is now {themes.length} theme(s),
          {' '}{active} active, so update that expectation in the same commit or <code>npm test</code> will fail.
        </Banner>
      )}

      {themes.length === 0 ? (
        <Empty>No themes configured.</Empty>
      ) : (
        <ul className="divide-y divide-cyan-500/10 rounded border border-cyan-500/15">
          {themes.map((theme) => (
            <li key={theme.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className={`font-display text-sm ${theme.status === 'active' ? 'text-cyan-50' : 'text-cyan-100/35 line-through'}`}>{theme.label}</span>
              <span className="font-mono text-[10px] text-cyan-100/30">{theme.id}</span>
              {theme.statusChangedAt && <span className="font-mono text-[10px] text-cyan-100/25">changed {theme.statusChangedAt}</span>}
              <span
                className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  theme.status === 'active' ? 'border-emerald-400/30 text-emerald-300/80' : 'border-cyan-500/20 text-cyan-100/40'
                }`}
              >
                {theme.status}
              </span>
              <Button onClick={() => flip(theme.id)}>{theme.status === 'active' ? 'Archive' : 'Reactivate'}</Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Field label="New theme" hint={newLabel.trim() ? `id: ${slugify(newLabel)}` : 'The id is derived from the label and is what Events store.'}>
            <TextInput value={newLabel} onChange={setNewLabel} placeholder="e.g. Arctic Resource Competition" />
          </Field>
        </div>
        <Button onClick={add} disabled={!newLabel.trim() || themes.some((t) => t.id === slugify(newLabel))}>
          Add
        </Button>
      </div>
    </Panel>
  )
}
