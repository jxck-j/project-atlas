// Minimal RFC 4180-style CSV parser (quoted fields, embedded commas,
// embedded newlines, "" as an escaped quote) — shared by
// scripts/buildCurrentStatus.mjs's two UCDP CSV sources. Neither xlsx (the
// SIPRI/Top-100 vendor files) nor a hand-rolled `split(',')` (breaks on any
// quoted field containing a comma, e.g. UCDP's own `"India, Pakistan"`
// location column) fits here — this project has no CSV dependency yet, and
// the format is simple enough not to need one.
//
// Returns an array of rows (each row an array of string fields), including
// the header row — callers build their own name->index map from row 0, the
// same pattern xlsx-based scripts already use via `sheet_to_json({header:
// 1})`. Rows with only a single empty field (trailing blank lines) are
// dropped.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.length > 1 || r[0] !== '')
}
