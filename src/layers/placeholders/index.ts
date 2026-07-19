// Pure side-effect barrel: importing this registers every placeholder
// layer. This is the file that composes "which layers exist" — a real
// (non-placeholder) layer gets added here the same way, as one import line.
import './TerrainPlaceholder'
import './InfrastructurePlaceholder'
import './ConflictPlaceholder'
