// The reference's 24x24 / 1.6-stroke icon set, as raw path data.
//
// Kept in a plain .ts module rather than alongside the <Icon> component in
// icons.tsx for the same reason scene/geoEntityEntries.ts is split out of
// GeoEntities.tsx: a .tsx file that exports both components and non-component
// values breaks React Fast Refresh, and oxlint's react-refresh rule flags it
// correctly. Consumers import the data from here and the renderer from
// icons.tsx.
export const ICONS = {
  overview: ['M3 9l9-6 9 6v11a1 1 0 01-1 1H4a1 1 0 01-1-1z', 'M9 21V12h6v9'],
  globe: ['M12 2a10 10 0 100 20 10 10 0 000-20z', 'M2 12h20', 'M12 2a15 15 0 010 20', 'M12 2a15 15 0 000 20'],
  city: ['M4 21V8l5-4 5 4v13', 'M14 21V11l6-3v13', 'M2 21h20'],
  military: ['M12 2l2.5 6.5H21l-5 4 2 6.5-6-4-6 4 2-6.5-5-4h6.5z'],
  economy: ['M3 21h18', 'M6 17v-6', 'M11 17V8', 'M16 17v-4', 'M21 17V5'],
  infrastructure: ['M12 3v18', 'M5 21V9l7-6 7 6v12', 'M8 21v-6h8v6'],
  conflict: ['M12 2v6', 'M12 16v6', 'M2 12h6', 'M16 12h6', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
  environment: ['M12 3c4 4 7 7 7 11a7 7 0 11-14 0c0-4 3-7 7-11z'],
  weather: ['M17 16a4 4 0 000-8 6 6 0 00-11.5 1.5A3.5 3.5 0 006 16z', 'M8 20l1-2', 'M13 20l1-2'],
  filter: ['M3 5h18l-7 8v6l-4-2v-4z'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17l9 5 9-5'],
  search: ['M11 4a7 7 0 100 14 7 7 0 000-14z', 'M21 21l-4.5-4.5'],
  star: ['M12 3l2.7 5.9 6.3.6-4.8 4.2 1.4 6.2-5.6-3.3-5.6 3.3 1.4-6.2L3 9.5l6.3-.6z'],
  bell: ['M18 9a6 6 0 10-12 0c0 7-2 8-2 8h16s-2-1-2-8', 'M10 21a2 2 0 004 0'],
  user: ['M12 4a4 4 0 100 8 4 4 0 000-8z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  settings: [
    'M12 9a3 3 0 100 6 3 3 0 000-6z',
    'M19.4 13.5a7.6 7.6 0 000-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 00-2.6-1.5L14 2h-4l-.5 2.6A7.6 7.6 0 006.9 6.1l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 000 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 002.6 1.5L10 22h4l.5-2.6a7.6 7.6 0 002.6-1.5l2.3 1 2-3.4z',
  ],
  shield: ['M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z'],
  diplomacy: ['M12 4a4 4 0 100 8 4 4 0 000-8z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  technology: ['M13 2L4 14h6l-1 8 9-12h-6z'],
  pin: ['M12 21s-7-6.5-7-11a7 7 0 0114 0c0 4.5-7 11-7 11z', 'M12 8a2 2 0 100 4 2 2 0 000-4z'],
  target: ['M12 4a8 8 0 100 16 8 8 0 000-16z', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
  bookmark: ['M6 3h12v18l-6-4-6 4z'],
  chevronsLeft: ['M11 17l-5-5 5-5', 'M18 17l-5-5 5-5'],
  chevronsRight: ['M13 17l5-5-5-5', 'M6 17l5-5-5-5'],
} as const
