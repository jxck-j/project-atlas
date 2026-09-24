import { TRANSLATION_MODELS, type Translator } from './translation'

// The one file that loads a translation model, the way localEmbedder.ts is the one that loads an embedding model:
// transformers.js runs the ONNX model in-process — keyless, offline after the one-time download (NLLB-200 600M is several
// hundred MB, OPUS-MT ~100 MB each), no text leaving the machine. Models load lazily, once each, on first use.
//
// ONE TEXT PER CALL, GREEDY. Not a missed optimisation: NLLB run over a batch through transformers.js does not stop at the end
// of each sentence and appends other-language junk to every item (measured on Russian headlines, 2026-09-24). Single-item greedy
// output was clean on every headline tried; beam search bought nothing visible for 2x the time.

export interface LocalTranslatorOptions {
  /** Where the downloaded models are cached. Pass a gitignored path (the build script uses debug/hf-cache). */
  cacheDir?: string
}

export async function createLocalTranslator({ cacheDir }: LocalTranslatorOptions = {}): Promise<Translator> {
  const { pipeline, env } = await import('@huggingface/transformers')
  if (cacheDir) env.cacheDir = cacheDir
  const loaded = new Map<string, Promise<Awaited<ReturnType<typeof pipeline>>>>()
  const load = (model: string) => {
    let p = loaded.get(model)
    if (!p) {
      p = pipeline('translation', model, { dtype: 'q8' })
      loaded.set(model, p)
    }
    return p
  }
  return async (text, language) => {
    const cfg = TRANSLATION_MODELS[language]
    if (!cfg) throw new Error(`no translation model configured for "${language}"`)
    const run = (await load(cfg.model)) as unknown as (
      input: string,
      options: Record<string, unknown>,
    ) => Promise<{ translation_text: string }[]>
    const result = await run(text.slice(0, 400), {
      max_new_tokens: 100,
      num_beams: 1,
      ...(cfg.srcLang ? { src_lang: cfg.srcLang, tgt_lang: 'eng_Latn' } : {}),
    })
    return result[0]?.translation_text ?? ''
  }
}
