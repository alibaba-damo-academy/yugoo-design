/** Read-only loader for focused tests against an explicitly supplied official ASAR. */
import { openSync, readSync, closeSync, readFileSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { registerHooks, createRequire, isBuiltin } from 'node:module'
import { createHash } from 'node:crypto'
import { posix, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

export function loadDshTestRuntime({ asar, webAnchor }) {
  if (Boolean(asar) === Boolean(webAnchor)) throw new Error('Set exactly one of DSH_TEST_ASAR or DSH_TEST_WEB_ANCHOR')
  if (asar) return loadDshAsar(asar)
  const require = createRequire(realpathSync(webAnchor))
  const observations = new Map()
  // Node 24 runs synchronous require.resolve through these hooks too. Allow
  // only that nested resolution to use its exact createRequire anchor.
  let resolvingAnchor = false
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('@deepseek-ai/') && !resolvingAnchor) {
      resolvingAnchor = true
      try { return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true } }
      finally { resolvingAnchor = false }
    }
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
  let commonRoot, commonFiles = 0, commonBytes = 0
  const commonPackages = new Map(), materialized = new Map()
  function info(member) {
    if (member.split('/').includes('..')) throw new Error('Invalid ASAR member')
    let entry = header
    for (const segment of member.split('/')) entry = entry?.files?.[segment]
    return entry
  }
  function readBytes(member) {
    const entry = info(member)
    if (!entry || entry.files || entry.link || entry.unpacked || entry.size > 4 * 1024 ** 2) throw new Error('Not a bounded ordinary ASAR member: ' + member)
    const buffer = Buffer.alloc(entry.size)
    readSync(fd, buffer, 0, buffer.length, offset + Number(entry.offset))
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    if (sha256 !== entry.integrity?.hash) throw new Error('ASAR member integrity mismatch: ' + member)
    observations.set(member, sha256)
    return buffer
  }
  const read = member => readBytes(member).toString()
  function target(value, conditions) {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(entry => target(entry, conditions)).find(Boolean)
    if (value && typeof value === 'object') {
      for (const [condition, entry] of Object.entries(value)) {
        if (condition === 'default' || conditions.has(condition)) {
          const selected = target(entry, conditions)
          if (selected) return selected
        }
      }
    }
  }
  function file(member, seen = new Set()) {
    if (seen.has(member)) throw new Error('Cyclic ASAR package entry: ' + member)
    seen.add(member)
    if (info(member) && !info(member).files) return member
    for (const suffix of ['.js', '.json', '.cjs']) if (info(member + suffix) && !info(member + suffix).files) return member + suffix
    if (info(member)?.files) {
      if (info(member + '/package.json')) {
        const main = JSON.parse(read(member + '/package.json')).main
        if (typeof main === 'string' && main !== '.') return file(posix.join(member, main), seen)
      }
      for (const name of ['index.js', 'index.cjs', 'index.json']) if (info(member + '/' + name)) return member + '/' + name
    }
    throw new Error('No ordinary ASAR module: ' + member)
  }
  function packageRoot(member) {
    let directory = posix.dirname(member)
    while (directory !== '.') {
      if (info(directory + '/package.json')) return directory
      directory = posix.dirname(directory)
    }
    throw new Error('ASAR module has no package manifest: ' + member)
  }
  function format(member) {
    if (member.endsWith('.cjs')) return 'commonjs'
    if (member.endsWith('.mjs')) return 'module'
    if (member.endsWith('.json')) return 'json'
    if (!member.endsWith('.js')) throw new Error('Unsupported ASAR module format: ' + member)
    return JSON.parse(read(packageRoot(member) + '/package.json')).type === 'module' ? 'module' : 'commonjs'
  }
  // Node22's imported-CJS require performs a real-path preflight before its
  // next resolve hook. Stage only a bounded, byte-verified CJS package closure,
  // never the SDK/release tree or development dependencies. Native addons stay
  // excluded; the focused tests do not grant native loading through this seam.
  function materialize(root) {
    if (commonPackages.has(root)) return commonPackages.get(root)
    commonRoot ??= mkdtempSync(join(tmpdir(), 'dsh-asar-cjs-'))
    // Publish a package only after its entire dependency closure succeeds.
    // A failed budget/integrity check must never leave a reusable partial tree.
    const packages = new Map(), files = new Map(), directories = []
    let fileCount = 0, byteCount = 0
    const visit = (member, entry) => {
      if (entry.files) { for (const [name, child] of Object.entries(entry.files)) visit(member + '/' + name, child); return }
      if (entry.link || entry.unpacked || member.endsWith('.node')) return
      if (commonFiles + ++fileCount > 512 || commonBytes + (byteCount += entry.size) > 8 * 1024 ** 2) throw new Error('ASAR CJS fixture closure exceeds budget')
      const bytes = readBytes(member), path = join(commonRoot, member)
      const created = mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      if (created) directories.push(created)
      writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 })
      files.set(pathToFileURL(path).href, member)
    }
    const stage = packageMember => {
      if (commonPackages.has(packageMember)) return commonPackages.get(packageMember)
      if (packages.has(packageMember)) return packages.get(packageMember)
      const destination = join(commonRoot, packageMember)
      packages.set(packageMember, destination) // Transaction-local cycle guard.
      visit(packageMember, info(packageMember))
      const manifest = JSON.parse(read(packageMember + '/package.json'))
      for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
        const dependency = 'dsh/node_modules/' + name
        if (info(dependency + '/package.json')) stage(dependency)
        else if (Object.hasOwn(manifest.dependencies ?? {}, name)) throw new Error('Missing archived CJS dependency: ' + name)
      }
      return destination
    }
    let destination
    try { destination = stage(root) }
    catch (error) {
      for (const directory of directories.reverse()) rmSync(directory, { recursive: true, force: true })
      throw error
    }
    for (const [member, path] of packages) commonPackages.set(member, path)
    for (const [url, member] of files) materialized.set(url, member)
    commonFiles += fileCount; commonBytes += byteCount
    return destination
  }
  function moduleUrl(member) {
    if (format(member) !== 'commonjs') return new URL(member, prefixUrl).href
    const root = packageRoot(member), destination = materialize(root)
    return pathToFileURL(join(destination, posix.relative(root, member))).href
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (materialized.has(context.parentURL) && specifier.startsWith('file:')) {
        if (!materialized.has(specifier)) throw new Error('CJS fixture resolved outside its verified archive closure')
        return { url: specifier, shortCircuit: true }
      }
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
        const exports = typeof manifest.exports === 'string' && key === '.' ? manifest.exports : manifest.exports?.[key]
          ?? (key === '.' && manifest.exports && !Object.keys(manifest.exports).some(name => name.startsWith('.')) ? manifest.exports : undefined)
        const entry = target(exports, new Set(context.conditions))
          ?? (key === '.' ? manifest.main : undefined)
        if (!entry) throw new Error('No test import export: ' + specifier)
        return { url: moduleUrl(file(posix.join(root, entry))), shortCircuit: true }
      }
      if (context.parentURL?.startsWith(prefixUrl) && specifier.startsWith('.')) {
        const member = decodeURIComponent(new URL(specifier, context.parentURL).href.slice(prefixUrl.length))
        return { url: moduleUrl(file(member)), shortCircuit: true }
      }
      return next(specifier, context)
    },
    load(url, context, next) {
      if (materialized.has(url)) {
        const member = materialized.get(url)
        if (createHash('sha256').update(readFileSync(new URL(url))).digest('hex') !== observations.get(member)) throw new Error('Staged ASAR member changed')
        return { format: format(member), source: read(member), shortCircuit: true }
      }
      if (!url.startsWith(prefixUrl)) return next(url, context)
      const member = decodeURIComponent(url.slice(prefixUrl.length))
      return { format: format(member), source: read(member), shortCircuit: true }
    },
  })
  return { read, readPackageFile: (name, relative) => read('dsh/node_modules/' + name + '/' + relative), observations,
    close() { hooks.deregister(); closeSync(fd); if (commonRoot) rmSync(commonRoot, { recursive: true, force: true }) } }
}
