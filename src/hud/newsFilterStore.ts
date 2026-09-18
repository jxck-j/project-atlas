import { create } from 'zustand'

// Carries a single country id across the tab switch from
// IntelligencePanel.tsx's "MORE ››" link to NewsPanel.tsx — the one real gap
// in existing HUD state: nothing else currently threads a filter across a
// TopNavTab change. Set right before calling setTopNavTab('news');
// NewsPanel reads and clears it once on open (a "consumed once" value, not
// a persistent filter setting — reopening the News tab later via the tab
// bar itself should show the unfiltered global default, not silently keep
// filtering to whatever country was last inspected).
const useNewsFilterStore = create<{ pendingNewsCountryId: string | null }>(() => ({
  pendingNewsCountryId: null,
}))

export function setPendingNewsCountryId(id: string) {
  useNewsFilterStore.setState({ pendingNewsCountryId: id })
}

export function consumePendingNewsCountryId(): string | null {
  const id = useNewsFilterStore.getState().pendingNewsCountryId
  if (id !== null) useNewsFilterStore.setState({ pendingNewsCountryId: null })
  return id
}
