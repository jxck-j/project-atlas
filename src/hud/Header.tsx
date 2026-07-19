export function Header() {
  return (
    <div className="pointer-events-none fixed top-0 left-0 right-0 z-20 flex flex-col items-center pt-6 md:pt-8">
      <div className="flex items-center gap-3 text-cyan-300/80">
        <span className="h-px w-8 bg-cyan-400/50" />
        <span className="font-mono text-[10px] md:text-xs tracking-[0.35em]">
          GLOBAL COMMAND INTERFACE
        </span>
        <span className="h-px w-8 bg-cyan-400/50" />
      </div>
      <h1 className="mt-2 font-display text-2xl md:text-4xl tracking-[0.2em] text-cyan-50 [text-shadow:0_0_18px_rgba(76,224,255,0.55)]">
        PROJECT ATLAS
      </h1>
      <span className="mt-1 font-mono text-[10px] tracking-[0.3em] text-amber-400/80">
        PHASE 01 :: TERRESTRIAL VISUALIZATION
      </span>
    </div>
  )
}
