import { createEmbeddingClassifier, type ClassifierWeights, type EmbeddingClassifier } from './embeddingClassifier'
import weights from './embeddingClassifierWeights.json'

// The trained relevance/tag classifier that ships with the build. Regenerate the
// weights with `npm run train:news-classifier`. Kept out of embeddingClassifier.ts
// so that module stays pure (no ~40 KB JSON import) and testable with hand-made weights.
// Constructing it throws if the weights were trained on a different embedding model.
export function loadShippedClassifier(): EmbeddingClassifier {
  return createEmbeddingClassifier(weights as unknown as ClassifierWeights)
}
