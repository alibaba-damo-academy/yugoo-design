import { embeddingWindows, combineEmbeddingWindows } from './embedding-text.mjs'
let extractor
process.on('disconnect', () => process.exit(0))
process.on('message', async ({ texts, config }) => {
  let phase = 'runtime'
  try {
    // Load native dependencies inside the error boundary; import failures must
    // reach the parent as a bounded category, never raw paths or input text.
    const { pipeline, env } = await import('@huggingface/transformers')
    if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
      const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
      setGlobalDispatcher(new EnvHttpProxyAgent())
    }
    env.backends.onnx.wasm.numThreads = 1
    phase = 'model'
    env.cacheDir = config.cacheDir
    env.allowRemoteModels = !config.localOnly
    extractor ??= await pipeline('feature-extraction', config.model, {
      revision: config.revision, dtype: 'q8', device: 'cpu',
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      progress_callback: info => { if (info.status === 'download') process.send?.({ progress: config.localOnly ? '正在加载本地模型文件；离线模式，设计文本不上传' : '正在准备模型文件（首次可能下载）；设计文本不上传' }) },
    })
    phase = 'inference'
    const groups = texts.map(text => embeddingWindows(text, config.prefix, extractor.tokenizer))
    const windows = groups.flat(), vectors = []
    // Keep inference memory bounded even when one graph chunk needs several model windows.
    for (let start = 0; start < windows.length; start += 4) {
      const result = await extractor(windows.slice(start, start + 4).map(w => w.input), { pooling: 'mean', normalize: true, truncation: false })
      vectors.push(...result.tolist())
    }
    let offset = 0
    process.send?.({ vectors: groups.map(group => {
      const result = combineEmbeddingWindows(vectors.slice(offset, offset + group.length), group)
      offset += group.length
      return result
    }) })
  } catch { process.send?.({ error: phase }) }
})
