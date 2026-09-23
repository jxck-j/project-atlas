import type { ReactNode } from 'react'
import type { ValidationIssue } from '../src/news/configValidation'

// Shared presentational bits. Kept small on purpose — this is private tooling,
// so the bar is "legible and hard to misread", not the globe's visual polish.

export function Panel({ title, subtitle, children, actions }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-6 rounded border border-cyan-500/20 bg-[#070c12]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-[0.2em] text-cyan-300 uppercase">{title}</h2>
          {subtitle && <p className="mt-1 font-mono text-[11px] text-cyan-100/50">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Button({ onClick, children, tone = 'default', disabled }: { onClick: () => void; children: ReactNode; tone?: 'default' | 'primary' | 'danger'; disabled?: boolean }) {
  const tones = {
    default: 'border-cyan-500/30 text-cyan-100/80 hover:border-cyan-400/60 hover:text-cyan-100',
    primary: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20',
    danger: 'border-rose-400/50 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-3 py-1.5 font-display text-xs font-semibold tracking-[0.15em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] tracking-[0.15em] text-cyan-100/45 uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block font-mono text-[10px] text-cyan-100/35">{hint}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded border border-cyan-500/25 bg-[#04070a] px-2 py-1.5 font-mono text-xs text-cyan-50 outline-none focus:border-cyan-400/70 disabled:opacity-40'

export function TextInput({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return <input className={inputClass} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
}

export function TextArea({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea className={`${inputClass} resize-y`} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

/** `''` is the absent value — the config files carry no empty strings, only missing fields. */
export function Select({ value, onChange, options, disabled }: { value: string; onChange: (v: string) => void; options: readonly { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <select className={inputClass} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#04070a]">
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 font-mono text-[11px] text-cyan-100/70">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-cyan-400" />
      {label}
    </label>
  )
}

export function IssueList({ issues, heading }: { issues: ValidationIssue[]; heading: string }) {
  if (issues.length === 0) return null
  return (
    <div className="mb-4 rounded border border-rose-400/40 bg-rose-500/5 p-3">
      <p className="font-display text-xs font-semibold tracking-[0.15em] text-rose-300 uppercase">{heading}</p>
      <ul className="mt-2 space-y-1">
        {issues.map((issue, i) => (
          <li key={`${issue.id}-${issue.field}-${i}`} className="font-mono text-[11px] text-rose-200/80">
            <span className="text-rose-300">{issue.id || '(file)'}</span>
            {issue.field && <span className="text-rose-200/50">.{issue.field}</span>} — {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Banner({ tone, children }: { tone: 'info' | 'good' | 'warn'; children: ReactNode }) {
  const tones = {
    info: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-100/75',
    good: 'border-emerald-400/40 bg-emerald-400/5 text-emerald-200/85',
    warn: 'border-amber-400/40 bg-amber-400/5 text-amber-200/85',
  }
  return <div className={`mb-4 rounded border px-3 py-2 font-mono text-[11px] ${tones[tone]}`}>{children}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center font-mono text-xs text-cyan-100/35">{children}</p>
}
