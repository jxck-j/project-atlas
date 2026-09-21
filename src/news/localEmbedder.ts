import { EMBEDDING_MODEL, type Embedder, type Vector } from './embeddingClustering'

// The one file that loads an embedding model. transformers.js runs the ONNX
// model in-process — no API key, no per-call cost, no data leaving the machine;
// the only network use is the one-time model download from huggingface.co
// (~33 MB), after which it works offline. Imported lazily so nothing that just
// wants the pure clustering pays for onnxruntime.

const BATCH = 64

export interface LocalEmbedderOptions {
  /** Where the downloaded model is cached. Pass a gitignored path (the build script uses debug/hf-cache). */
  cacheDir?: string
  model?: string
}

export async function createLocalEmbedder({ cacheDir, model = EMBEDDING_MODEL }: LocalEmbedderOptions = {}): Promise<Embedder> {
  const { pipeline, env } = await import('@huggingface/transformers')
  if (cacheDir) env.cacheDir = cacheDir
  // q8: the quantised weights the thresholds were tuned on.
  const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' })
  return async (texts) => {
    const out: Vector[] = []
    for (let i = 0; i < texts.length; i += BATCH) {
      const tensor = await extractor(texts.slice(i, i + BATCH), { pooling: 'mean', normalize: true })
      for (const row of tensor.tolist() as number[][]) out.push(row)
    }
    return out
  }
}
