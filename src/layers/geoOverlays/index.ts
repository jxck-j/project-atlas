// Side-effect barrel: importing this module registers both v3 geopolitical
// overlay layers (each calls registerLayer() at import time — see either
// file for the pattern, same one placeholders/index.ts uses). This is the
// "real" (non-placeholder) layer set CLAUDE.md's Layer Engine section
// anticipated a future version would need a composition point for — see
// LayerEngine.tsx, which imports this alongside './placeholders'.
import './ParentOverlayLayer'
import './ClaimsOverlayLayer'
