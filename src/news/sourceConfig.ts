import sourcesJson from './sources.json'
import themesJson from './systemicThemes.json'
import type { SourceProfile, SystemicThemeConfig } from './types'

// Typed views over the two editorial config files. They stay plain JSON, not
// .ts consts, because they're the shared source of truth for two consumers
// with no TypeScript: scripts/buildNews.mjs reads them with fs, and the
// Admin Console (design doc §14) edits them in place. The casts are safe only
// because sourceConfig.test.ts validates the files' shape on every test run.

export const SOURCES = sourcesJson as SourceProfile[]
export const SYSTEMIC_THEMES = themesJson as SystemicThemeConfig[]

export function getSourceProfile(id: string): SourceProfile | undefined {
  return SOURCES.find((s) => s.id === id)
}
