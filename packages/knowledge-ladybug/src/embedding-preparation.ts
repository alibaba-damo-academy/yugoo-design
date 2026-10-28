import { isAbsolute } from 'node:path'
import { DesignSemanticIndex } from './semantic-index.ts'
import { inspectDefaultEmbeddingAssets, prepareDefaultEmbeddingAssets, EmbeddingAssetError } from './embedding-model-assets.ts'

const reasons = {
  missing: '固定版本模型资源缺失；允许下载后可显式准备。',
  incomplete: '固定版本模型资源不完整；允许下载后可显式续传。',
  integrity: '固定版本模型资源完整性校验失败；请显式重新准备。',
  download: '模型资源下载未完成；请检查网络及代理后显式重试。',
  busy: '另一进程正在准备模型资源；请在其完成后重试。',
  cancelled: '模型准备或推理检查已取消。',
  runtime: '模型缓存无法读取或运行依赖不可用。',
}

/** Installation diagnostic only: no project, provider database, publication or host configuration. */
export async function prepareLocalEmbedding(options: { cacheDir?: string; allowDownload?: boolean; probe?: boolean; signal?: AbortSignal } = {}) {
  if (options.cacheDir !== undefined && !isAbsolute(options.cacheDir)) throw new Error('Embedding cache must be an absolute path')
  const index = new DesignSemanticIndex({ localOnly: true, ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}) })
  const signal = options.signal ?? new AbortController().signal
  const { cacheDir, model, revision } = index.config
  let resources: Awaited<ReturnType<typeof inspectDefaultEmbeddingAssets>> | { state: 'unavailable' } = { state: 'unavailable' }
  const base = { schemaVersion: 1, kind: 'embedding-preparation', cacheDir, model, revision,
    downloadAllowed: options.allowDownload === true, semanticKagVerified: false,
    note: '仅检查本地语义索引资源与可选 CPU 推理；不更改基础设计、源事实投影或项目语义发布状态。' }
  try {
    resources = await inspectDefaultEmbeddingAssets(cacheDir, signal)
    if (options.allowDownload === true && resources.state !== 'ready') {
      await prepareDefaultEmbeddingAssets({ ...index.config, localOnly: false }, signal)
      resources = await inspectDefaultEmbeddingAssets(cacheDir, signal)
    }
    if (resources.state !== 'ready') {
      const code = resources.files.find(file => file.state !== 'ready')!.state as 'missing' | 'incomplete' | 'integrity'
      return { ...base, status: 'unavailable', resources, inference: { state: 'not-run' }, reasonCode: code, message: reasons[code] }
    }
    if (!options.probe) return { ...base, status: 'assets-ready', resources, inference: { state: 'not-checked' }, message: '固定模型资源完整；尚未验证实际 CPU 推理。使用 --probe 检查。' }
    // One constant text, no user/project content and no persistent vector cache.
    // The existing semantic runner owns CPU selection, native memory/time bounds and teardown.
    try {
      await index.compute('installation-probe', { checkpoint: 'installation-probe', nodes: [], edges: [], warnings: [], semanticUnits: [
        { id: 'installation-probe:0', nodeId: 'installation-probe', file: 'installation-probe.json', pointer: '', text: 'Local embedding readiness check.', digest: 'installation-probe-v1' },
      ] }, undefined, signal)
      return { ...base, status: 'ready', resources, inference: { state: 'ready', device: 'cpu' }, message: '固定模型资源完整，实际本地 CPU 推理通过。' }
    } catch {
      return { ...base, status: 'unavailable', resources, inference: { state: 'unavailable', device: 'cpu' },
        reasonCode: signal.aborted ? 'cancelled' : 'inference-unavailable',
        message: signal.aborted ? reasons.cancelled : '模型资源完整，但实际 CPU 推理未通过。请检查当前平台运行依赖、CPU 和内存。' }
    }
  } catch (error) {
    const code = signal.aborted ? 'cancelled' : error instanceof EmbeddingAssetError ? error.code : 'runtime'
    return { ...base, status: 'unavailable', resources, inference: { state: 'not-run' }, reasonCode: code, message: reasons[code] }
  } finally { await index.close() }
}
