// Renderers for the HUD's icon set. The path data itself lives in
// iconPaths.ts — see that file for why the two are split.

export function Icon({ paths, size = 16 }: { paths: readonly string[]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

// The reference's brand mark — a ringed "A" monogram.
export function AtlasLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="rgba(40,90,180,0.12)" stroke="#3f7fe8" strokeWidth="2.5" />
      <path
        d="M24 9 L13 36 M24 9 L35 36 M10 27 L40 22"
        stroke="#eaf2ff"
        strokeWidth="3.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
