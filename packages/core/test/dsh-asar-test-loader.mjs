/** Read-only loader for focused tests against an explicitly supplied official ASAR. */
import { openSync, readSync, closeSync, readFileSync, realpathSync } from 'node:fs'
import { registerHooks, createRequire, isBuiltin } from 'node:module'
import { createHash } from 'node:crypto'
import { posix, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function loadDshTestRuntime({ asar, webAnchor }) {
  if (Boolean(asar) === Boolean(webAnchor)) throw new Error('Set exactly one of DSH_TEST_ASAR or DSH_TEST_WEB_ANCHOR')
  if (asar) return loadDshAsar(asar)
  const require = createRequire(realpathSync(webAnchor))
  const observations = new Map()
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('@deepseek-ai/')) return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true }
    return next(specifier, context)
  } })
  return { observations, readPackageFile(name, relative) {
    let root = dirname(require.resolve(name))
    while (true) {
      try { if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === name) break }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      const parent = dirname(root)
      if (parent === root) throw new Error('Cannot locate runtime package: ' + name)
      root = parent
    }
    const file = join(root, relative), bytes = readFileSync(file)
    observations.set(file, createHash('sha256').update(bytes).digest('hex'))
    return bytes.toString()
  }, close() { hooks.deregister() } }
}

export function loadDshAsar(archive) {
  if (!archive) throw new Error('DSH_TEST_ASAR must name the actual official Host archive')
  const fd = openSync(archive, 'r')
  const prefix = Buffer.alloc(16)
  readSync(fd, prefix, 0, 16, 0)
  const size = prefix.readUInt32LE(12)
  if (size > 32 * 1024 ** 2) throw new Error('ASAR header exceeds the focused test budget')
  const bytes = Buffer.alloc(size)
  readSync(fd, bytes, 0, size, 16)
  const header = JSON.parse(bytes.toString())
  const offset = 8 + prefix.readUInt32LE(4)
  const observations = new Map()
  // A file URL keeps unmodified SDK createRequire(import.meta.url) valid.
  // Member bytes still come only from the verified archive through load().
  const prefixUrl = pathToFileURL(archive + '/').href
  function read(member) {
    if (member.split('/').includes('..')) throw new Error('Invalid ASAR member')
    let entry = header
    for (const segment of member.split('/')) entry = entry?.files?.[segment]
    if (!entry || entry.files || entry.link || entry.unpacked || entry.size > 4 * 1024 ** 2) throw new Error('Not a bounded ordinary ASAR member: ' + member)
    const buffer = Buffer.alloc(entry.size)
    readSync(fd, buffer, 0, buffer.length, offset + Number(entry.offset))
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    if (sha256 !== entry.integrity?.hash) throw new Error('ASAR member integrity mismatch: ' + member)
    observations.set(member, sha256)
    return buffer.toString()
  }
  function target(value) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') return target(value.node ?? value.import ?? value.default)
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('@deepseek-ai/') || (context.parentURL?.startsWith(prefixUrl)
        && !specifier.startsWith('.') && !specifier.startsWith('/')
        && !specifier.includes(':') && !isBuiltin(specifier))) {
        // SDK externals must come from the same verified Host archive, never
        // the development dependency graph or a source alias.
        const parts = specifier.split('/')
        const count = specifier.startsWith('@') ? 2 : 1
        const root = 'dsh/node_modules/' + parts.slice(0, count).join('/')
        const manifest = JSON.parse(read(root + '/package.json'))
        const key = parts.length === count ? '.' : './' + parts.slice(count).join('/')
        const entry = target(typeof manifest.exports === 'string' && key === '.' ? manifest.exports : manifest.exports?.[key])
          ?? (key === '.' ? manifest.main : undefined)
        if (!entry) throw new Error('No test import export: ' + specifier)
        return { url: new URL(posix.join(root, entry), prefixUrl).href, shortCircuit: true }
      }
      if (context.parentURL?.startsWith(prefixUrl) && specifier.startsWith('.')) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
      return next(specifier, context)
    },
    load(url, context, next) {
      if (!url.startsWith(prefixUrl)) return next(url, context)
      return { format: url.endsWith('.cjs') ? 'commonjs' : url.endsWith('.json') ? 'json' : 'module',
        source: read(decodeURIComponent(url.slice(prefixUrl.length))), shortCircuit: true }
    },
  })
  return { read, readPackageFile: (name, relative) => read('dsh/node_modules/' + name + '/' + relative), observations, close() { hooks.deregister(); closeSync(fd) } }
}
