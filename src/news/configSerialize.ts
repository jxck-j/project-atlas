import type { SourceProfile, SystemicThemeConfig } from './types'

// How the Admin Console writes sources.json / systemicThemes.json back out.
//
// This is not cosmetic. Both files are hand-edited and diff-reviewed, and both
// are one record per LINE today — `JSON.stringify(x, null, 2)` would explode
// every one of 141 sources across ~10 lines and turn a one-field leaning edit
// into an unreadable whole-file diff. Key order is fixed for the same reason:
// a save must not reorder fields just because the console's form built the
// object in a different order than the file had them.

const SOURCE_KEY_ORDER = [
  'id',
  'name',
  'sourceType',
  'tier',
  'countryName',
  'pressControl',
  'leaning',
  'leaningSource',
  'leaningConfidence',
  'contested',
  'label',
  'specialistVerified',
  'caveat',
  'affiliationNote',
  'notes',
  'vetting',
  'pressFreedomContext',
] as const

const THEME_KEY_ORDER = ['id', 'label', 'status', 'statusChangedAt'] as const

/** Drops undefined/empty-string fields — an absent field and a blank one mean the same thing here, and the files only ever carry the absent form. */
function ordered<T extends object>(record: T, keyOrder: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const rest = Object.keys(record).filter((k) => !keyOrder.includes(k))
  for (const key of [...keyOrder, ...rest]) {
    const value = (record as Record<string, unknown>)[key]
    if (value === undefined || value === '' || value === null) continue
    out[key] = value
  }
  return out
}

const spacedObject = (o: Record<string, unknown>): string =>
  `{ ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`

/** Compact, one source per line — the format the file already has. */
export function serializeSources(sources: SourceProfile[]): string {
  return `[\n${sources.map((s) => `  ${JSON.stringify(ordered(s, SOURCE_KEY_ORDER))}`).join(',\n')}\n]\n`
}

/** One theme per line, spaced — the format that file already has (it's short enough to read as prose). */
export function serializeThemes(themes: SystemicThemeConfig[]): string {
  return `[\n${themes.map((t) => `  ${spacedObject(ordered(t, THEME_KEY_ORDER))}`).join(',\n')}\n]\n`
}
