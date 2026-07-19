function Corner({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = 'absolute w-10 h-10 md:w-14 md:h-14'
  const posClasses: Record<string, string> = {
    tl: 'top-4 left-4 md:top-6 md:left-6 border-t-2 border-l-2',
    tr: 'top-4 right-4 md:top-6 md:right-6 border-t-2 border-r-2',
    bl: 'bottom-4 left-4 md:bottom-6 md:left-6 border-b-2 border-l-2',
    br: 'bottom-4 right-4 md:bottom-6 md:right-6 border-b-2 border-r-2',
  }
  return <div className={`${base} ${posClasses[position]} border-cyan-400/60`} />
}

export function HUDFrame() {
  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      <Corner position="tl" />
      <Corner position="tr" />
      <Corner position="bl" />
      <Corner position="br" />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 45%, rgba(2,6,9,0.55) 100%)',
        }}
      />

      {/* Scanlines */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-screen"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, #4CE0FF 0px, #4CE0FF 1px, transparent 1px, transparent 3px)',
        }}
      />
    </div>
  )
}
