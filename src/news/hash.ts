// Two independent FNV-1a passes -> 16 hex chars. Not cryptographic; it only
// has to make ids and cache keys stable across runs. Avoids node:crypto so
// this stays importable from the client bundle if the Admin Console (Phase 5)
// needs it.
export function stableHash(input: string): string {
  const pass = (seed: number) => {
    let h = seed
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
  return pass(0x811c9dc5) + pass(0x9747b28c)
}
