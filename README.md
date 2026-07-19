# Project Atlas — Interactive Holographic Globe

A "Global Command Interface" — a command-center-style 3D globe visualization
covering all 193 UN member states, built with React, TypeScript, Vite, Three.js,
React Three Fiber, drei, and Tailwind CSS v4.

## Design direction

Rather than a photo-real Earth texture, the globe renders as a **holographic
wireframe projection**: a graticule grid, real-world country borders (from
Natural Earth GeoJSON/TopoJSON data) rendered as thin glowing lines, a subtle
Fresnel atmosphere rim, and pulsing capital-city markers — closer to a
Halo/TRON/JARVIS tactical display than a map app.

The HUD follows the same aesthetic throughout: a dark cyan/near-black
background, cyan for default UI state, amber for section labels and
emphasis, monospaced/tracked-out uppercase text (`JetBrains Mono` for body
text, `Chakra Petch` for display headings — see `src/index.css`), thin
bordered panels with a translucent backdrop blur, and a corner-bracket +
scanline overlay (`hud/HUDFrame.tsx`) reinforcing the "instrument panel"
feel.

## Stack

React 19 · TypeScript · Vite · Three.js · `@react-three/fiber` · `@react-three/drei`
· Tailwind CSS v4 · `topojson-client`/`topojson-server`/`topojson-simplify` ·
`earcut` · `world-atlas` (source geo data)

## Getting started

```bash
npm install
npm run dev        # start dev server (http://localhost:5173)
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build
npm run build:geo  # regenerate public/geo/countries-un193.json from world-atlas
```

There's no test suite in this repo — verify changes with `tsc -b --noEmit`,
`npm run lint` (oxlint), and by actually driving the dev server.

## Interaction

- **Drag** — orbit the camera around the globe (inertial damping, keeps drifting
  briefly after release). **Flick** — release a drag while still moving fast and
  the globe keeps spinning in that direction until grabbed again; a normal
  release just lets it settle.
- **Scroll / pinch** — zoom in and out (clamped so the camera can never clip
  inside the globe or zoom out past visual context).
- The globe **auto-rotates slowly when idle**, freezing as soon as a country is
  selected.
- **Hovering a country** brightens its border/fill and shows its name — inline
  for large countries, as a leader-line callout (pointing off to a label) for
  small ones, matching atlas annotation conventions.
- **Clicking a country** selects it immediately: it turns red, every other
  country dims, the intelligence panel slides in from the right with whatever
  data is available for it, and the globe's core shell goes from a translucent
  holographic sphere to fully solid. Clicking does **not** move the camera —
  the panel has an explicit **FOCUS CAMERA** button for that (a cinematic
  rotate-then-zoom tween). If the country has capital-city data, a marker with
  a pointed leader-line callout appears. A quick drag-then-release over a
  country is correctly ignored as a rotate gesture, not a click.
- **Reset to the global view** — press **Home**, double-click empty ocean, or
  click the 🌍 button in the top-left toolbar. Clears the current selection and
  cinematically flies the camera back to the default framing.
- The top-left **toolbar** also has 🔍 **Search** (type a country name, press
  Enter — selects it and flies the camera there) and ⚙ **Settings** (camera
  rotate/zoom sensitivity, with a reset).
- **Water body labels** (oceans always; seas/gulfs/straits/bays once you zoom
  in past a threshold) sit on the globe surface and hide themselves on the far
  side of the sphere so they don't float through it.
- Closing the intelligence panel (✕) clears the selection and resumes ambient
  rotation.

## Architecture

```
src/
  scene/                    Everything inside the R3F <Canvas>
    Scene.tsx                Canvas setup (frameloop="never" — see FrameRateCap),
                               lighting, starfield; composes Globe + camera + probes
    Globe.tsx                 Composes graticule, Countries, CapitalMarker,
                               WaterLabels, and the core/atmosphere shells;
                               owns the ambient self-rotation and the
                               double-click-on-ocean / hover-coordinate handlers
                               on the core sphere
    Countries.tsx             Renders one merged border lineSegments + one merged
                               fill mesh PER COUNTRY (not per ring/polygon — see
                               countryGeometry.ts); owns hover state, cursor, and
                               kicks off selection on click
    countryGeometry.ts         GeoJSON -> antimeridian-safe border segments /
                               earcut-triangulated fill geometry / centroid /
                               angular extent, all merged per-country and
                               projected onto the sphere
    useCountryFeatures.ts     Fetches + parses countries-un193.json once,
                               shared via a singleton useSyncExternalStore
    CameraControls.tsx        OrbitControls setup: clipping-safe distance
                               bounds, sensitivity wiring, Home-key handling,
                               composes the flight/reset/flick hooks below
    useFlickAutoRotate.ts     Pointer-velocity tracking: stop-on-drag /
                               resume-on-flick for ambient rotation
    useCameraFlight.ts        Cinematic tween to a selected country — triggered
                               only by flyToSelectedCountry(), not by selection
    useCameraReset.ts         Cinematic tween back to the default global view
    globeRotation.ts          Non-reactive publisher of the globe's current Y
                               rotation, read by SearchBar to aim a fly-to
                               without a clicked mesh to read a world matrix from
    tweenMath.ts              Shared easing + angle-interpolation helpers
    AtmosphereMaterial.tsx    Custom Fresnel-glow shader material (drei shaderMaterial)
    TelemetryProbe.tsx        Samples camera spherical coords + FPS each frame
                               -> HUD telemetryStore
    FrameRateCap.tsx          Manually drives R3F's render loop (advance()) at a
                               hard 60fps cap — see CLAUDE.md for a real bug this
                               caused if you touch it
    constants.ts              Shared GLOBE_RADIUS + camera distance bounds
  hud/                       Plain DOM/Tailwind overlay, siblings of the Canvas
    HUDFrame.tsx               Corner brackets, vignette, scanline overlay
    Header.tsx                 Top title bar
    Toolbar.tsx                Top-left icon bar: reset view / search / settings
    SearchBar.tsx               Country name -> select + fly-to
    SettingsPanel.tsx           Camera sensitivity sliders (toggled via Toolbar)
    Telemetry.tsx               Bottom-left live orbit readout (az/el/range)
    CommandBar.tsx               Bottom status bar: ready/connected/country
                                 count/FPS/hover coordinates
    IntelligencePanel.tsx       Right-side sliding panel with the selected
                                 country's profile data + FOCUS CAMERA button
    hudPanelStore.ts             Which single toolbar dropdown is open
    selectionStore.ts             Selected country + camera flight/reset triggers
    settingsStore.ts              User-adjustable camera sensitivity
    telemetryStore.ts             Camera telemetry, FPS, hover lat/lng
  data/
    unMembers.ts               The 193 UN member states' raw Natural-Earth names
                               + display-name overrides — used by the build
                               script below, not at runtime
    waterBodies.ts              Ocean/sea/gulf/strait/bay label coordinates
    countryProfiles.ts          Illustrative government/capital/population/GDP
                               data for ~60 of the 193 countries, keyed by name
  utils/
    geo.ts                    lat/lng <-> Vector3 sphere projection and its inverse
  App.tsx                     Composes Scene + all HUD layers
  index.css                   Tailwind v4 entry + font tokens + reduced-motion
scripts/
  buildCountryTopology.mjs   Build-time asset generator (npm run build:geo):
                             filters world-atlas's 10m data to the 193 UN
                             members, simplifies coastlines, re-quantizes
public/geo/
  countries-un193.json       Generated output of the script above — the only
                             geo asset actually fetched at runtime
```

This separation (scene layer vs. HUD layer, data vs. rendering, a small pub/sub
store instead of React context re-renders on every animation frame) gives new
features — more overlays, live data, further camera choreography — clean seams
to build against without refactoring the globe itself.

## Notes for future work

- `scene/constants.ts` exports `GLOBE_RADIUS` so any new overlay feature
  (markers, arcs, selection highlights) can share the same sphere projection
  without reaching into `Globe.tsx` and risking circular imports.
- `telemetryStore.ts` / `settingsStore.ts` / `selectionStore.ts` / `hudPanelStore.ts`'s
  pattern (publish from inside the R3F frame loop or a DOM event handler,
  subscribe from plain components via `useSyncExternalStore`) is the intended
  pattern for any other camera- or scene-driven HUD data — avoids re-rendering
  the whole React tree at 60fps.
- **`countryProfiles.ts` is illustrative demo data, not a live feed.**
  Government/capital are stable facts; population and GDP are rounded,
  approximate snapshots that will drift out of date. Swap in a real data
  source before this is anything but a portfolio piece. Only ~60 of the 193
  countries are covered; the intelligence panel degrades gracefully ("No
  profile data available") for the rest.
- The Military / Economy / Diplomacy / Technology / Current Status sections
  in the intelligence panel are intentionally left as labeled placeholders
  ("Awaiting data feed") — the brief didn't specify what should populate
  them, and fabricating country-level assessments for a defense-context demo
  isn't something to do casually. That's real future work.
- See `CLAUDE.md` for the harder-won technical details: antimeridian
  triangulation, why country geometry is merged per-country instead of
  per-ring/per-polygon (a real 7,234→386 draw-call fix), and a
  `frameloop="never"`/`advance()` units bug worth not repeating.
