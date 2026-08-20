import type { FontSizeConfig } from './useApparentFontSize'

// Own plain .ts module (not exported from StateProvinceLabels.tsx itself)
// purely so oxlint's react-refresh rule doesn't flag a constant exported
// alongside a component from the same .tsx file — the same reasoning
// geoEntityEntries.ts's and useClickDragGuard.ts's own header comments
// already document for the identical situation.
//
// Reported directly, with a concrete example (Hessen, Germany): state/
// province name labels need to read about 1.67x bigger than
// CountryLabels.tsx/GeoEntityLabels.tsx's shared sizing (MIN_FONT_PX 6 /
// MAX_FONT_PX 11 / a 0.12 apparent-size ratio, see useApparentFontSize.ts)
// at every zoom level, not just at the top of its range — that formula was
// tuned for a whole country filling the view, not a much smaller admin-1
// shape at StateProvinceLabels.tsx's own, much closer reveal distance.
// Scaling all three numbers by the same 1.67x factor reproduces the exact
// same growth curve, just uniformly bigger, rather than changing its shape.
// This alone doesn't risk text spilling outside the state's own shape —
// PassiveEntityLabels' existing width-vs-apparent-size check
// (MAX_NAME_WIDTH_FRACTION) runs on top of whatever font size this config
// produces and falls back to an abbreviation once the full name would
// overrun the polygon's own on-screen footprint, exactly as it already
// does for country labels.
//
// Shared by StateProvinceLabels.tsx's passive label layer AND
// ProvinceFillLayer.tsx's <HoverLabel> (rendered for whichever province is
// actually hovered, replacing the passive label for that one entry in
// place) — the two are meant to read as the same size at all times (see
// EntityRenderLayer.tsx's own v5.2.8 history), so only widening one of them
// would just move the mismatch bug from "always too small" to "shrinks back
// down on hover."
export const STATE_LABEL_FONT_CONFIG: FontSizeConfig = { minFontPx: 10, maxFontPx: 18, fontToApparentRatio: 0.2 }
