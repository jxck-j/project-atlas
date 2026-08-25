# Current Status assets

Drop the sanctioned/embargo logo here. `hud/IntelligencePanel.tsx`'s CURRENT
STATUS row currently renders a compact "S" text badge (`SanctionBadge` in
that file), colored red/orange/yellow by `sanctionTier` — once a real asset
lands in this folder, swap that badge over to it (per tier, if the asset
comes in more than one variant, or as a single mark recolored the same way
the text badge is now).

See `scripts/buildCurrentStatus.mjs` for where `sanctionTier`/
`sanctionPrograms` actually comes from (a static, three-tier OFAC seed —
RED fully verified, ORANGE/YELLOW flagged in `BACKLOG.md` for verification
against each country's own OFAC program page), and
`Intelligence Docs/intelligence-engine-scoring-design.md` §3.5 for the
locked data model.
