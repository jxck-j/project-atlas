// Side-effect barrel: importing this module registers every v3/v3.3
// geopolitical overlay layer (each calls registerLayer() at import time —
// see any file for the pattern, same one placeholders/index.ts uses). This
// is the "real" (non-placeholder) layer set CLAUDE.md's Layer Engine
// section anticipated a future version would need a composition point for
// — see LayerEngine.tsx, which imports this alongside './placeholders'.
import './ParentOverlayLayer'
import './ClaimsOverlayLayer'
import './CategoryHighlightLayer'
import './StatesProvincesLayer'
