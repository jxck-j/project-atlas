import type { SystemicThemeConfig } from './types'

// Systemic-theme list helpers (news-sourcing-design.md §4b). The list is a
// living set reviewed quarterly: retirement is archival, never deletion — an
// archived theme stays attached to its historical Events and can flip back to
// 'active' if the dynamic resurfaces, without losing any linkage.

/** Themes offered as live filter/badge choices going forward. Archived themes are excluded here but never removed from the config or from past Events. */
export function activeThemes(themes: SystemicThemeConfig[]): SystemicThemeConfig[] {
  return themes.filter((t) => t.status === 'active')
}

/** Label lookup that still resolves an archived theme, so a historical Event's badge keeps rendering. Falls back to the raw id for an id the config doesn't know. */
export function themeLabel(themes: SystemicThemeConfig[], id: string): string {
  return themes.find((t) => t.id === id)?.label ?? id
}
