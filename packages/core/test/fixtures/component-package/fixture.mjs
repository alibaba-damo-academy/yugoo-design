import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
export const fixtureRoot = new URL('./minimal/', import.meta.url)
export const host = { nativePanelApi: 1, reactVersion: '18.3.1', reactDOMVersion: '18.3.1' }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export async function fixture() {
  const manifest = await readFile(new URL('component-package.json', fixtureRoot))
  const files = new Map(await Promise.all((await readdir(fixtureRoot)).filter(name => name !== 'component-package.json').map(async name => [name, await readFile(new URL(name, fixtureRoot))])))
  const pin = JSON.parse(await readFile(new URL('./minimal-pin.json', import.meta.url), 'utf8'))
  return { source: { manifest, files }, pin }
}
/** Independently compute the specified byte fingerprint with Node crypto. */
export function sourcePin(source) {
  const manifest = JSON.parse(source.manifest)
  const files = [...source.files].map(([path, bytes]) => [path, sha256(bytes)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  return { name: manifest.name, version: manifest.version, integrity: sha256(JSON.stringify({ manifest: sha256(source.manifest), files })) }
}
export function revise(source, change, changeFiles = () => {}) {
  const files = new Map([...source.files].map(([path, bytes]) => [path, Buffer.from(bytes)]))
  changeFiles(files)
  const manifest = JSON.parse(source.manifest)
  manifest.files = [...files].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })).sort((a, b) => a.path < b.path ? -1 : 1)
  change(manifest)
  return { manifest: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), files }
}
export function npmEdit(files, change) {
  const value = JSON.parse(files.get('package.json')); change(value)
  files.set('package.json', Buffer.from(JSON.stringify(value, null, 2) + '\n'))
}
