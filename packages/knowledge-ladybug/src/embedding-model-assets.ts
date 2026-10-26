import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import { copyFile, lstat, mkdir, open, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { promisify } from 'node:util'
import { lock } from 'proper-lockfile'
import { fetch as modelFetch, EnvHttpProxyAgent } from 'undici'

const run = promisify(execFile)
export const DEFAULT_EMBEDDING_ASSETS = {
  model: 'Xenova/multilingual-e5-small', revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  // Official resolve/<revision> HEAD metadata: x-repo-commit, ETag / linked ETag.
  // Small-file ETags are Git blob SHA-1; LFS ETags are SHA-256 of file bytes.
  files: [
    { path: 'config.json', bytes: 658, hash: '4104f38273cc595fd9500fd243124e9f6cf383dc', kind: 'git-blob-sha1' },
    { path: 'tokenizer_config.json', bytes: 443, hash: '059214673d9d6d2ee319411e2ffec8c024b816d5', kind: 'git-blob-sha1' },
    { path: 'tokenizer.json', bytes: 17082730, hash: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39', kind: 'sha256' },
    { path: 'onnx/model_quantized.onnx', bytes: 118308185, hash: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193', kind: 'sha256' },
  ] satisfies Asset[],
}
interface Asset { path: string; bytes: number; hash: string; kind: string }
interface AssetResponse { status: number; headers: { get(name: string): string | null }; body: AsyncIterable<Uint8Array> | null }
type AssetFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<AssetResponse>
export class EmbeddingAssetError extends Error {
  readonly code: 'missing' | 'download' | 'integrity' | 'busy'
  constructor(code: 'missing' | 'download' | 'integrity' | 'busy') { super(`Embedding resource preparation: ${code}`); this.code = code }
}

// Undici uses lowercase ?? uppercase, including explicitly empty values.
const hasProcessProxy = (env: NodeJS.ProcessEnv) =>
  (env.https_proxy ?? env.HTTPS_PROXY) !== undefined || (env.http_proxy ?? env.HTTP_PROXY) !== undefined
const hasProcessBypass = (env: NodeJS.ProcessEnv) => (env.no_proxy ?? env.NO_PROXY) !== undefined

/** Pure projection; explicit process proxy configuration always wins. No env mutation. */
export function modelProxyOptions(platform: string, env: NodeJS.ProcessEnv, system = '') {
  if (hasProcessProxy(env)) return undefined
  if (platform !== 'darwin') return undefined
  const value = (key: string) => system.match(new RegExp(`^\\s*${key}\\s*:\\s*([^\\r\\n]+)`, 'm'))?.[1]?.trim()
  if (value('HTTPSEnable') !== '1') return undefined
  const host = value('HTTPSProxy'), port = Number(value('HTTPSPort'))
  if (!host || !/^(?:[a-zA-Z0-9.-]+|[a-fA-F0-9:]+)$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new EmbeddingAssetError('download')
  const exceptions = system.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]+)\}/)?.[1] ?? ''
  const noProxy = exceptions.split('\n').map(line => line.match(/^\s*\d+\s*:\s*(\S+)\s*$/)?.[1]).filter(Boolean).join(',')
  return { httpsProxy: `http://${host.includes(':') ? `[${host}]` : host}:${port}`, ...(hasProcessBypass(env) ? {} : { noProxy }) }
}

interface ProxyRuntime { platform?: string; env?: NodeJS.ProcessEnv; readSystem?: () => Promise<string> }
async function systemProxyOptions(options: ProxyRuntime = {}) {
  const platform = options.platform ?? process.platform, env = options.env ?? process.env
  if (platform !== 'darwin' || hasProcessProxy(env)) return undefined
  let system: string
  try { system = options.readSystem ? await options.readSystem() : (await run('/usr/sbin/scutil', ['--proxy'], { timeout: 3000, maxBuffer: 128 * 1024 })).stdout }
  catch { throw new EmbeddingAssetError('download') }
  return modelProxyOptions(platform, env, system)
}
/** Private per-child environment; never persisted or returned through IPC/status. */
export async function embeddingChildEnvironment(options: ProxyRuntime = {}): Promise<NodeJS.ProcessEnv | undefined> {
  const env = options.env ?? process.env, proxy = await systemProxyOptions(options)
  if (!proxy) return undefined
  return { ...env, HTTPS_PROXY: proxy.httpsProxy,
    ...(proxy.noProxy !== undefined ? { NO_PROXY: proxy.noProxy } : {}) }
}
async function assetNetwork() {
  const dispatcher = new EnvHttpProxyAgent(await systemProxyOptions())
  return {
    request: (async (url, init) => {
      const response = await modelFetch(url, { ...init, dispatcher, redirect: 'follow' })
      return { status: response.status, headers: response.headers, body: response.body as AsyncIterable<Uint8Array> | null }
    }) satisfies AssetFetch,
    close: () => dispatcher.close(),
  }
}

async function size(path: string) {
  try { const value = await lstat(path); if (!value.isFile() || value.isSymbolicLink()) throw new EmbeddingAssetError('integrity'); return value.size }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function valid(path: string, asset: Asset) {
  if (await size(path) !== asset.bytes) return false
  const hash = createHash(asset.kind === 'git-blob-sha1' ? 'sha1' : 'sha256')
  if (asset.kind === 'git-blob-sha1') hash.update(`blob ${asset.bytes}\0`)
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex') === asset.hash
}

/** Private resource preparation. No model/native session or Design text enters this path.
 * Download has its own bounded lifetime; the existing 180s inference budget is unchanged.
 * A failed pass keeps resumable staging bytes and never publishes a partial canonical file.
 */
export async function prepareEmbeddingAssetSet(root: string, files: Asset[], localOnly: boolean, options: {
  signal: AbortSignal; baseUrl: string; fetch?: AssetFetch; progress?: (done: number, total: number) => void
}) {
  if (files.some(file => !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file.path) || file.path.split('/').some(p => p === '..') || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !['sha256', 'git-blob-sha1'].includes(file.kind))) throw new EmbeddingAssetError('integrity')
  options.signal.throwIfAborted()
  await mkdir(root, { recursive: true })
  const compromised = new AbortController()
  let release: (() => Promise<void>) | undefined
  let network: Awaited<ReturnType<typeof assetNetwork>> | undefined
  try {
    try { release = await lock(root, { retries: 0, stale: 600000, update: 10000, onCompromised: () => compromised.abort() }) }
    catch { throw new EmbeddingAssetError('busy') }
    const signal = AbortSignal.any([options.signal, compromised.signal, AbortSignal.timeout(600000)])
    for (const asset of files) {
      signal.throwIfAborted()
      const target = join(root, asset.path)
      if (await valid(target, asset)) continue
      if (localOnly) throw new EmbeddingAssetError('missing')
      await mkdir(dirname(target), { recursive: true })
      const staged = target + '.yugoo-download.part'
      let offset = await size(staged)
      if (offset === undefined) {
        const old = await size(target)
        if (old !== undefined && old > 0 && old < asset.bytes) { await copyFile(target, staged, constants.COPYFILE_EXCL); offset = old }
        else offset = 0
      }
      if (offset >= asset.bytes) offset = 0
      if (!options.fetch) network ??= await assetNetwork()
      const response = await (options.fetch ?? network!.request)(options.baseUrl + '/' + asset.path, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal })
      let received = offset
      let append = false
      if (offset && response.status === 206 && response.headers.get('content-range') === `bytes ${offset}-${asset.bytes - 1}/${asset.bytes}`) append = true
      else if (response.status === 200) received = 0
      else { if (response.body) for await (const _ of response.body) { break } throw new EmbeddingAssetError('download') }
      if (!response.body) throw new EmbeddingAssetError('download')
      const output = await open(staged, append ? 'a' : 'w')
      try {
        for await (const bytes of response.body) {
          signal.throwIfAborted(); received += bytes.byteLength
          if (received > asset.bytes) throw new EmbeddingAssetError('integrity')
          await output.writeFile(bytes)
          options.progress?.(received, asset.bytes)
        }
        await output.sync()
      } finally { await output.close() }
      if (!await valid(staged, asset)) throw new EmbeddingAssetError('integrity')
      signal.throwIfAborted()
      if (await size(target) !== undefined) await copyFile(target, target + '.rejected-' + randomUUID(), constants.COPYFILE_EXCL)
      await rename(staged, target)
    }
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason
    if (error instanceof EmbeddingAssetError) throw error
    throw new EmbeddingAssetError('download')
  } finally {
    await network?.close()
    await release?.()
  }
}

export async function prepareDefaultEmbeddingAssets(config: { model: string; revision: string; cacheDir: string; localOnly: boolean }, signal: AbortSignal, progress?: (done: number, total: number) => void) {
  if (config.model !== DEFAULT_EMBEDDING_ASSETS.model || config.revision !== DEFAULT_EMBEDDING_ASSETS.revision) return
  await prepareEmbeddingAssetSet(join(config.cacheDir, config.model, config.revision), DEFAULT_EMBEDDING_ASSETS.files, config.localOnly, {
    signal, progress, baseUrl: `https://huggingface.co/${config.model}/resolve/${config.revision}`,
  })
}
