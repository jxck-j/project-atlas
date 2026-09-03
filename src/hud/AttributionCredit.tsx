// CC BY 4.0 / ODbL both require a persistent, visible credit — not just
// discoverable in a submenu. This is the first data-attribution UI this
// app has ever needed: every prior source (Natural Earth, Census TIGER,
// StatCan, World Bank WDI) is public domain or otherwise doesn't require
// display attribution — see city-boundaries-architecture.md's Open Items.
//
// Bottom-right: the one HUD corner nothing else claims (bottom-left is
// Telemetry/LegendPanel's stack — see App.tsx's own comment on why;
// TopNav owns the top edge; IntelligencePanel claims the right edge only
// while something's selected) — and it's the universal web-map
// attribution convention (Leaflet/Mapbox/Google Maps all default there).
//
// NOT mounted in App.tsx yet, deliberately — wiring this in is meant to
// happen at cutover (city-boundaries-architecture.md's migration plan step
// 5), alongside the data it credits actually going live. Crediting a
// source nothing on screen yet renders from would misrepresent what's
// actually showing.
interface AttributionEntry {
  label: string
  url: string
}

// Add an entry here per attribution-requiring source as it goes live —
// e.g. OpenStreetMap/geoBoundaries once the boundary extraction script
// (migration plan step 2) ships. GeoNames is the only one built so far.
const ATTRIBUTIONS: AttributionEntry[] = [{ label: 'GeoNames', url: 'https://www.geonames.org/' }]

export function AttributionCredit() {
  if (ATTRIBUTIONS.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-2 right-3 z-20 flex gap-3 font-mono text-[9px] text-[#5a79ab]">
      {ATTRIBUTIONS.map((a) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto opacity-70 transition-opacity hover:text-[#dce8fb] hover:opacity-100 hover:underline"
        >
          {a.label}
        </a>
      ))}
    </div>
  )
}
