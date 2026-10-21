import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { createCssAssetHandler } from './css-asset-route.mjs'

function identity(prefix, resource) {
  if (!/^\/design-system-assets\/[a-z0-9-]+\/$/u.test(prefix)) throw Error('Invalid owned CSS asset prefix')
  const extension = extname(resource.source).slice(1).toLowerCase()
  return `${resource.sha256}.${extension}`
}

/** Explicit route representation for planCssResources; preserves each CSS suffix. */
export function cssAssetUrl(prefix, resource) {
  return prefix + identity(prefix, resource) + resource.suffix
}

/** Build-only collector. Emission is not proof that a host serves these assets.
 * Call addPlan after post-preprocessor planning; generateBundle emits the bytes
 * and a portable manifest. Private source paths remain only in watch/provenance.
 */
export function createCssResourceEmitter(prefix, { maxAssets = 512, maxAssetBytes = 32 * 1024 * 1024,
  maxTotalBytes = 64 * 1024 * 1024 } = {}) {
  for (const [value, ceiling] of [[maxAssets, 512], [maxAssetBytes, 32 * 1024 * 1024], [maxTotalBytes, 64 * 1024 * 1024]]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > ceiling) throw Error('Invalid CSS emission budget')
  }
  // Validate even an empty build's route before accepting any resources.
  createCssAssetHandler({ prefix, assets: [] })
  const pluginId = prefix.split('/')[2]
  const assets = new Map()
  let emitted = false
  return {
    addPlan(plan, addWatchFile) {
      if (emitted) throw Error('CSS asset collection is already emitted')
      if (!Array.isArray(plan?.resources) || typeof addWatchFile !== 'function') throw Error('CSS resource plan and watch callback required')
      if (plan.resources.length > 512) throw Error('CSS resource plan exceeds budget')
      // Validate the full next table before mutating the current collection.
      const next = new Map(assets)
      for (const resource of plan.resources) {
        if (!Buffer.isBuffer(resource?.bytes) || resource.bytes.length > maxAssetBytes) throw Error('Invalid CSS resource bytes or budget')
        const name = identity(prefix, resource)
        const bytes = resource.bytes
        const item = { name, bytes, sha256: resource.sha256, mime: resource.mime }
        const existing = next.get(name)
        if (existing && (!existing.bytes.equals(bytes) || existing.mime !== item.mime)) throw Error('Conflicting CSS asset identity')
        next.set(name, item)
      }
      // Deduplicate and check the entire next collection before any byte clone.
      // This also catches accumulation across individually valid stylesheets.
      const total = [...next.values()].reduce((sum, item) => sum + item.bytes.length, 0)
      if (next.size > maxAssets || total > maxTotalBytes) throw Error('CSS emission table exceeds budget')
      createCssAssetHandler({ prefix, assets: [...next.values()] })
      const snapshot = new Map([...next].map(([name, item]) => [name, { ...item, bytes: Buffer.from(item.bytes) }]))
      for (const resource of plan.resources) addWatchFile(resource.source)
      assets.clear()
      for (const [name, item] of snapshot) assets.set(name, item)
    },
    generateBundle(emitFile) {
      if (emitted || typeof emitFile !== 'function') throw Error('CSS assets require one explicit emission callback')
      emitted = true
      const entries = [...assets.values()].sort((a, b) => a.name.localeCompare(b.name)).map(item => ({
        name: item.name, file: `css-assets/${pluginId}/${item.name}`,
        sha256: item.sha256, bytes: item.bytes.length, mime: item.mime,
      }))
      for (const entry of entries) {
        const bytes = assets.get(entry.name).bytes
        if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('CSS asset changed before emission')
        emitFile({ type: 'asset', fileName: entry.file, source: Buffer.from(bytes) })
      }
      const manifest = { schema: 'design-system-css-assets-v1', prefix, assets: entries }
      emitFile({ type: 'asset', fileName: `css-assets/${pluginId}/manifest.json`, source: JSON.stringify(manifest, null, 2) + '\n' })
      return manifest
    },
  }
}
