import type { ConfirmationRecord, ReviewDecision } from '../src/news/confirmations'
import type { ValidationIssue, LeaningTally } from '../src/news/configValidation'
import type { NewsEvent, SourceProfile, SystemicThemeConfig } from '../src/news/types'

// Typed client for the console's own dev-server API (admin/server/adminApi.ts).

export interface ConfigPayload {
  sources: SourceProfile[]
  themes: SystemicThemeConfig[]
  /** UN-193 topology names plus Taiwan — the allowed values for a country-native source's countryName. */
  countryNames: string[]
  tally: LeaningTally
  files: { sources: string; themes: string }
}

export interface ReviewPayload {
  pending: NewsEvent[]
  confirmations: ConfirmationRecord[]
  /** False when no build has written a queue yet — distinct from an empty queue. */
  queueBuilt: boolean
  files: { pending: string; confirmations: string }
}

/** A refused write, carrying the invariants it would have broken. Thrown, not returned, so a caller can't forget to check it. */
export class ApiError extends Error {
  issues: ValidationIssue[]
  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message)
    this.name = 'ApiError'
    this.issues = issues
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, body.issues ?? [])
  return body as T
}

const json = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

export const fetchConfig = () => call<ConfigPayload>('/api/config')
export const fetchReview = () => call<ReviewPayload>('/api/review')

export const saveSources = (sources: SourceProfile[]) => call<{ saved: number; tally: LeaningTally }>('/api/sources', json('PUT', sources))
export const saveThemes = (themes: SystemicThemeConfig[]) => call<{ saved: number }>('/api/themes', json('PUT', themes))

export const submitDecision = (eventId: string, decision: ReviewDecision, note: string) =>
  call<{ records: ConfirmationRecord[]; file: string }>('/api/review/decision', json('POST', { eventId, decision, note }))
