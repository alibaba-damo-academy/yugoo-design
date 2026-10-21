import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { createCssAssetHandler } from './css-asset-route.mjs'

function ownedRead(root, relative, limit) {
  let file = root
  const parents = [{ path: root, info: lstatSync(root) }]
  const verifyParents = () => {
    for (const parent of parents) {
      const current = lstatSync(parent.path)
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== parent.info.dev || current.ino !== parent.info.ino || realpathSync(parent.path) !== parent.path) throw Error('Packaged CSS parent ownership changed')
    }
    if (realpathSync(file) !== file) throw Error('Packaged CSS resolved ownership changed')
  }
  const parts = relative.split('/')
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.' || part === '..' || /[\\\u0000-\u001f]/u.test(part)) throw Error('Invalid packaged CSS asset path')
    file = join(file, part)
    const info = lstatSync(file)
    if (info.isSymbolicLink() || !(index === parts.length - 1 ? info.isFile() : info.isDirectory())) throw Error('CSS package assets must be regular owned files')
    if (index !== parts.length - 1) parents.push({ path: file, info })
  }
  const checked = lstatSync(file)
  verifyParents()
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = fstatSync(fd)
    verifyParents()
    if (!info.isFile() || info.dev !== checked.dev || info.ino !== checked.ino || info.size !== checked.size) throw Error('Packaged CSS asset identity changed')
    if (info.size > limit) throw Error('Packaged CSS bytes exceed budget')
    const bytes = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    const final = fstatSync(fd)
    verifyParents()
    if (length !== info.size || final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs) throw Error('Packaged CSS asset changed')
    return bytes.subarray(0, length)
  } finally { closeSync(fd) }
}

/** Read only the current content-addressed manifest, never enumerate a directory.
 * Stale build files are neither admitted nor exposed. The package root is an
 * explicit owner-selected directory; native list paths are not accepted here.
 */
export function loadPackagedCssAssets(packageRoot, prefix) {
  createCssAssetHandler({ prefix, assets: [] })
  const root = realpathSync(packageRoot), pluginId = prefix.split('/')[2]
  const folder = `css-assets/${pluginId}`
  const manifestBytes = ownedRead(root, `${folder}/manifest.json`, 256 * 1024)
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
  if (manifest?.schema !== 'design-system-css-assets-v1' || manifest.prefix !== prefix || !Array.isArray(manifest.assets) || manifest.assets.length > 512) throw Error('Invalid packaged CSS asset manifest')
  const seen = new Set(), assets = []
  let total = 0
  // Check the whole declared table before allocating resource buffers.
  for (const entry of manifest.assets) {
    if (!/^[a-f0-9]{64}\.[a-z0-9]+$/u.test(entry?.name ?? '') || entry.file !== `${folder}/${entry.name}` || seen.has(entry.name)) throw Error('Invalid or duplicate packaged CSS identity')
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 32 * 1024 * 1024) throw Error('Invalid packaged CSS byte budget')
    total += entry.bytes
    if (total > 64 * 1024 * 1024) throw Error('Packaged CSS total exceeds budget')
    seen.add(entry.name)
  }
  for (const entry of manifest.assets) {
    const bytes = ownedRead(root, entry.file, entry.bytes)
    if (bytes.length !== entry.bytes) throw Error('Packaged CSS byte length mismatch')
    assets.push({ name: entry.name, bytes, sha256: entry.sha256, mime: entry.mime })
  }
  // Shared validator checks exact SHA, extension-derived MIME and table identity.
  const handler = createCssAssetHandler({ prefix, assets })
  return { handler, manifest, assets }
}
