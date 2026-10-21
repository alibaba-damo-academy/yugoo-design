/** Built assembled acceptance for the read-only DSH Studio service lifecycle. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import DshStudioManagementService from '../lib/index.js'

const ROOT = '/install/demo_kit'
const SKILL_MD = '---\nname: alpha\ndescription: "Alpha facet."\n---\n\n# alpha\n\nMethod.\n'
const MINDSET_MD = '---\nname: demo_kit\nversion: "1.0"\ndescription: "Demo Studio Kit."\n---\n\n# demo_kit\n\nBody.\n\n<design_skills>\n\n## alpha\n\nAlpha facet.\n\n</design_skills>\n'

function kitFiles(root = ROOT) {
  return {
    [`${root}/mindset.md`]: MINDSET_MD,
    [`${root}/skills/alpha/SKILL.md`]: SKILL_MD,
    [`${root}/skills/alpha/skill.yaml`]: `name: alpha\nversion: "1.0"\ntitle:\n  zh: "alpha"\n  en: "alpha"\nlabel:\n  zh: "alpha"\n  en: "alpha"\nexecution:\n  handoff: none\npresentation:\n  mode: none\n`,
    [`${root}/skills/alpha/schema.yaml`]: 'type: object\nproperties:\n  summary:\n    type: string\n',
    [`${root}/skills/alpha/validation.yaml`]: 'skill: alpha\nrules:\n  - id: r\n    scope: [completion]\n    code: alpha.r\n    message: m\n    check:\n      non_empty_string: summary\n',
    [`${root}/skills/alpha/.icon.bin`]: new Uint8Array([0x89, 0x50, 0xff]),
  }
}

/** In-memory stand-in for the DSH `ctx.fs` capability. */
function memoryFs(seed, aliases = {}) {
  const files = new Map(Object.entries(seed))
  const directories = new Set()
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'))
  }
  // An alias maps one path's resolved target elsewhere, simulating a symlink.
  const target = (path) => Object.freeze({ targetKey: aliases[path] ?? path, displayPath: path })
  const error = (code) => Object.assign(new Error(`fs: ${code}`), { code })
  return {
    files,
    async resolve(path) {
      if (files.has(path) || directories.has(path)) return target(path)
      throw error('FS_NOT_FOUND')
    },
    async stat(t) {
      if (files.has(t.targetKey)) return { version: 'v1', type: 'file', size: 1 }
      if (directories.has(t.targetKey)) return { version: 'v1', type: 'directory' }
      return undefined
    },
    async readText(t) {
      const value = files.get(t.targetKey)
      if (value === undefined) throw error('FS_NOT_FOUND')
      if (typeof value !== 'string') throw error('FS_NOT_TEXT')
      return value
    },
    async readBytes(t, _signal, maxBytes) {
      const value = files.get(t.targetKey)
      if (value === undefined) throw error('FS_NOT_FOUND')
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
      if (bytes.byteLength > maxBytes) throw error('FS_TOO_LARGE')
      return bytes
    },
    async listDir(t) {
      const prefix = `${t.targetKey}/`
      const names = new Map()
      for (const path of files.keys()) if (path.startsWith(prefix)) names.set(path.slice(prefix.length).split('/')[0], path)
      for (const dir of directories) if (dir.startsWith(prefix) && dir !== t.targetKey) names.set(dir.slice(prefix.length).split('/')[0], dir)
      return [...names.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, path]) => (
        files.has(path)
          ? { name, type: 'file', target: target(path) }
          : { name, type: 'directory', target: target(path) }
      ))
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
    },
    processPath(t) { return t.targetKey },
    fileUrl(t) { return `file://${t.targetKey}` },
  }
}

function designMock() {
  const kit = Object.freeze({
    name: 'demo_kit',
    version: '1.0',
    mindsetSource: MINDSET_MD,
    resources: Object.freeze({}),
    skills: Object.freeze([Object.freeze({ name: 'alpha', version: '1.0', description: 'Alpha facet.' })]),
  })
  return { listKits() { return [kit] } }
}

async function mount({ fs, design, config } = {}) {
  const ctx = new Context()
  ctx.provide('design', design ?? designMock())
  ctx.provide('fs', fs ?? memoryFs(kitFiles()))
  const fiber = ctx.plugin(DshStudioManagementService, config ?? { kitSources: [{ root: ROOT }] })
  await fiber
  const service = ctx.get('studioManagement')
  assert.ok(service, 'service must publish after its sources validate')
  return { ctx, fiber, service }
}

// The public Remote surface is exactly six read methods: no create, save,
// edit, or working-copy endpoint exists.
const first = await mount()
assert.deepEqual(remoteMethods(first.service), [
  { method: 'workspace', invocation: { kind: 'direct' } },
  { method: 'readKitWorkspace', invocation: { kind: 'direct' } },
  { method: 'readKitFiles', invocation: { kind: 'direct' } },
  { method: 'readKitFile', invocation: { kind: 'direct' } },
  { method: 'readBundleWorkspace', invocation: { kind: 'direct' } },
  { method: 'readBundleFile', invocation: { kind: 'direct' } },
], 'the Gateway discovers only the six read-only methods')
for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(first.service))) {
  assert.equal(/save|create|write|edit|working/iu.test(name), false, `no mutation method may exist: ${name}`)
}
console.log('the public surface is read-only: six methods, no mutation vocabulary')

assert.deepEqual((await first.service.workspace('')).kits, [{ name: 'demo_kit', version: '1.0' }], 'workspace requires no Session or Agent service')

const kitWorkspace = await first.service.readKitWorkspace('demo_kit', '1.0')
assert.equal((await first.service.readKitFile('demo_kit', '1.0', 'mindset.md')).content, MINDSET_MD)
assert.ok((await first.service.readKitFiles('demo_kit', '1.0')).includes('mindset.md'))
assert.equal(kitWorkspace.workspace.mindsetSource, MINDSET_MD, 'the Kit workspace exposes the exact raw mindset source')
assert.deepEqual((await first.service.readKitWorkspace('absent', '1.0')).diagnostics[0].code, 'workspace.kit_missing')
assert.deepEqual((await first.service.readKitWorkspace('demo_kit', '9.9')).diagnostics[0].code, 'workspace.version_missing')

// Bundle reads come from the real source tree, byte-exact.
const bundleWorkspace = await first.service.readBundleWorkspace('alpha')
assert.deepEqual(bundleWorkspace.diagnostics, [])
assert.equal(bundleWorkspace.workspace.name, 'alpha')
assert.equal(bundleWorkspace.workspace.version, '1.0')
assert.equal(bundleWorkspace.workspace.kit, 'demo_kit')
assert.deepEqual(bundleWorkspace.workspace.files.map((file) => file.path), ['SKILL.md', 'schema.yaml', 'skill.yaml', 'validation.yaml'], 'the binary dotfile stays out of the tree')
const file = await first.service.readBundleFile('alpha', 'SKILL.md')
assert.equal(file.file.content, SKILL_MD, 'Bundle files read byte-identically from source')
assert.deepEqual((await first.service.readBundleFile('alpha', '.icon.bin')).diagnostics[0].code, 'bundle_file.binary')
assert.deepEqual((await first.service.readBundleFile('alpha', '../mindset.md')).diagnostics[0].code, 'bundle_file.path_forbidden')
assert.deepEqual((await first.service.readBundleWorkspace('absent')).diagnostics[0].code, 'bundle.missing')
console.log('Bundle reads serve the real source tree and reject binary content and traversal')

// A symlink whose resolved target escapes the configured root never leaks:
// the startup identity load rejects the whole source tree.
{
  await assert.rejects(
    mount({
      fs: memoryFs(
        { ...kitFiles(), '/install/demo_kit/skills/alpha/escape.md': 'outside secret', '/outside/secret.md': 'outside secret' },
        { '/install/demo_kit/skills/alpha/escape.md': '/outside/secret.md' },
      ),
    }),
    /escapes the configured Kit sources/u,
    'a source tree containing an escaping symlink fails loud at startup',
  )
  console.log('symlink escapes out of a configured root are rejected')
}

// A compiled catalog that disagrees with the source fails loud.
{
  const driftedKit = Object.freeze({ ...designMock().listKits()[0], skills: Object.freeze([Object.freeze({ name: 'alpha', version: '2.0', description: 'Alpha facet.' })]) })
  const drifted = await mount({ design: { listKits() { return [driftedKit] } } })
  const result = await drifted.service.readBundleWorkspace('alpha')
  assert.equal(result.workspace, undefined)
  assert.equal(result.diagnostics[0].code, 'studio.source_catalog_mismatch')
  await drifted.fiber.dispose()
  console.log('a compiled-catalog/source version disagreement fails loud')
}

// A legacy installed Kit cannot silently display a source-only relation
// vocabulary that its runtime does not have.
{
  const withRelations = {
    ...kitFiles(),
    [`${ROOT}/relations.yaml`]: `schema_version: 1\nrelations:\n  - type: demo_kit:corroborates\n    meaning: supports\n    direction: forward\n    label: { zh: 佐证, en: Corroborates }\n    description: { zh: A 佐证 B, en: A corroborates B }\n`,
  }
  await assert.rejects(mount({ fs: memoryFs(withRelations) }), /relations\.yaml does not match installed Kit/u)
}

// Without configured sources the catalog stays readable and Bundle reads diagnose.
{
  const unconfigured = await mount({ config: {} })
  assert.deepEqual((await unconfigured.service.workspace('')).kits, [{ name: 'demo_kit', version: '1.0' }])
  assert.equal((await unconfigured.service.readBundleWorkspace('alpha')).diagnostics[0].code, 'studio.source_not_configured')
  assert.equal((await unconfigured.service.readBundleFile('alpha', 'SKILL.md')).diagnostics[0].code, 'studio.source_not_configured')
  await unconfigured.fiber.dispose()
  console.log('an unconfigured installation keeps the catalog and diagnoses Bundle reads')
}

// Invalid source configuration fails loud at startup.
{
  await assert.rejects(mount({ config: { kitSources: [{ root: '/install/absent' }] } }), /FS_NOT_FOUND|not a directory|mindset\.md/u, 'an absent root fails loud')
  const noMindset = memoryFs({ '/install/bare/skills/alpha/SKILL.md': 'x' })
  await assert.rejects(mount({ fs: noMindset, config: { kitSources: [{ root: '/install/bare' }] } }), /mindset\.md/u, 'a root without mindset.md fails loud')
  await assert.rejects(
    mount({ fs: memoryFs({ ...kitFiles(), ...kitFiles('/install/other_kit') }), config: { kitSources: [{ root: ROOT }, { root: '/install/other_kit' }] } }),
    /two kitSources roots/u,
    'the same Kit in two roots fails loud',
  )
  await assert.rejects(
    mount({ config: { kitSources: [{ root: 'relative/path' }] } }),
    /must be absolute/u,
    'a relative root fails loud',
  )
  await assert.rejects(
    mount({ config: { kitSources: [{ root: ROOT, packageName: 'x' }] } }),
    /exactly one/u,
    'an ambiguous entry fails loud',
  )
  console.log('invalid or ambiguous source configuration fails loud at startup')
}

// Disposal rejects new work and drains admitted calls.
{
  const draining = await mount()
  const disposing = draining.fiber.dispose()
  await Promise.resolve()
  await assert.rejects(draining.service.workspace(''), /disposing/)
  await disposing
  console.log('disposal rejects new reads and drains admitted work')
}

console.log('DSH STUDIO READ-ONLY SERVICE OK')

// Auto-discovered sources are read from the live registry, without a second
// source allowlist or a Studio restart. Removal cannot leave stale source access.
{
  const dynamicKit = { ...designMock().listKits()[0], sourceRoot: ROOT }
  let kits = []
  const dynamic = await mount({ design: { listKits: () => kits }, config: { followInstalledSources: true } })
  assert.equal((await dynamic.service.readBundleWorkspace('alpha')).diagnostics[0].code, 'studio.source_not_configured')
  kits = [dynamicKit]
  const workspace = await dynamic.service.readBundleWorkspace('alpha')
  assert.deepEqual(workspace.diagnostics, [])
  assert.equal(workspace.workspace.kit, 'demo_kit')
  assert.equal((await dynamic.service.readBundleFile('alpha', 'SKILL.md')).file.content, SKILL_MD)
  const missingKit = { ...dynamicKit, name: 'missing_kit', sourceRoot: '/install/missing', skills: [{ name: 'missing_bundle', version: '1.0' }] }
  kits = [dynamicKit, missingKit]
  assert.equal((await dynamic.service.readBundleWorkspace('missing_bundle')).diagnostics[0].code, 'studio.source_unavailable')
  assert.equal((await dynamic.service.readBundleFile('missing_bundle', 'SKILL.md')).diagnostics[0].code, 'studio.source_unavailable')
  assert.equal((await dynamic.service.readBundleFile('alpha', 'SKILL.md')).file.content, SKILL_MD, 'retained missing Kit does not break another healthy source')
  kits = []
  assert.equal((await dynamic.service.readBundleFile('alpha', 'SKILL.md')).diagnostics[0].code, 'studio.source_not_configured')
  await dynamic.fiber.dispose()
  console.log('Studio follows hot-discovered sources and does not retain removed registry roots')
}

// Kit files use the same exact pin and canonical filesystem boundary as the
// Bundle source viewer. These are source/service fixtures, not native UI proof.
{
  const fs = memoryFs(kitFiles())
  const current = { ...designMock().listKits()[0], sourceRoot: ROOT }
  const oldRoot = '/install/retained'
  const old = { ...current, version: '0.9', sourceRoot: oldRoot }
  fs.files.set(`${ROOT}/kit.yaml`, 'version: 1\nmounts: []\n')
  fs.files.set(`${oldRoot}/mindset.md`, 'retained mindset')
  const originalResolve = fs.resolve
  fs.resolve = async path => path === oldRoot ? { targetKey: oldRoot, displayPath: oldRoot } : originalResolve(path)
  const originalStat = fs.stat
  fs.stat = async target => target.targetKey === oldRoot ? { type: 'directory', version: 'v1' } : originalStat(target)
  const design = { listKits: () => [current], resolveKit: pin => pin.kit === current.name ? ({ '1.0': current, '0.9': old })[pin.version] : undefined }
  const runtime = await mount({ fs, design, config: { followInstalledSources: true } })
  assert.ok((await runtime.service.readKitFiles('demo_kit', '1.0')).includes('kit.yaml'))
  assert.deepEqual(await runtime.service.readKitFile('demo_kit', '1.0', 'kit.yaml'), { content: 'version: 1\nmounts: []\n' })
  assert.equal((await runtime.service.readKitFile('demo_kit', '0.9', 'mindset.md')).content, 'retained mindset', 'retained exact pin does not resolve to latest')
  for (const version of ['9.9', '1.0.0', '', undefined]) await assert.rejects(runtime.service.readKitFiles('demo_kit', version), /version_missing/)
  await assert.rejects(runtime.service.readKitFiles('absent', '1.0'), /version_missing/)
  for (const path of ['', '/mindset.md', '../mindset.md', 'a/../mindset.md', 'a\\mindset.md', 'C:/mindset.md', '.git/config', '.GIT/config', 'node_modules/a.md', 'NODE_MODULES/a.md']) {
    await assert.rejects(runtime.service.readKitFile('demo_kit', '1.0', path), /path_forbidden/)
  }
  await assert.rejects(runtime.service.readKitFile('demo_kit', '1.0', 'absent.md'), /kit_file.missing/)
  await assert.rejects(runtime.service.readKitFile('demo_kit', '1.0', 'skills/alpha/.icon.bin'), /kit_file.binary/)
  fs.files.set(`${ROOT}/oversize.md`, 'x'.repeat(1024 * 1024 + 1))
  await assert.rejects(runtime.service.readKitFile('demo_kit', '1.0', 'oversize.md'), /kit_file.too_large/)
  fs.files.set(`${ROOT}/bom.txt`, '\ufefforiginal\r\n')
  assert.equal((await runtime.service.readKitFile('demo_kit', '1.0', 'bom.txt')).content, '\ufefforiginal\r\n', 'UTF-8 BOM and CRLF remain byte-exact')
  fs.files.set(`${ROOT}/nul.txt`, 'text\0binary')
  await assert.rejects(runtime.service.readKitFile('demo_kit', '1.0', 'nul.txt'), /kit_file.binary/)
  await runtime.fiber.dispose()
  await assert.rejects(runtime.service.readKitFiles('demo_kit', '1.0'), /disposing/)
}

// A view lists authored files but excludes package-management internals and
// escaping symlinks; direct requests cannot use those entries to escape.
{
  const fs = memoryFs({
    ...kitFiles(),
    [`${ROOT}/.git/config`]: 'private',
    [`${ROOT}/.GIT/config`]: 'private',
    [`${ROOT}/node_modules/private/index.js`]: 'private',
    [`${ROOT}/NODE_MODULES/private/index.js`]: 'private',
    [`${ROOT}/escape.md`]: 'decoy',
    '/outside/secret.md': 'outside secret',
  }, { [`${ROOT}/escape.md`]: '/outside/secret.md' })
  const kit = { ...designMock().listKits()[0], sourceRoot: ROOT }
  const runtime = await mount({ fs, design: { listKits: () => [kit] }, config: { followInstalledSources: true } })
  const paths = await runtime.service.readKitFiles('demo_kit', '1.0')
  assert.ok(!paths.some(path => /\.git|node_modules|escape/i.test(path)))
  await assert.rejects(runtime.service.readKitFile('demo_kit', '1.0', 'escape.md'), /kit_file.path_forbidden/)
  await runtime.fiber.dispose()
}

// Real checked-in Kit documents round-trip through the DSH service unchanged.
{
  const source = new URL('../../skills-web-app/kits/web_app/', import.meta.url)
  const [mindset, manifest] = await Promise.all(['mindset.md', 'kit.yaml'].map(path => readFile(new URL(path, source), 'utf8')))
  const metadata = parse(mindset.split('---')[1])
  const kit = { ...designMock().listKits()[0], name: metadata.name, version: String(metadata.version), mindsetSource: mindset, sourceRoot: ROOT }
  const runtime = await mount({ fs: memoryFs({ [`${ROOT}/mindset.md`]: mindset, [`${ROOT}/kit.yaml`]: manifest }), design: { listKits: () => [kit] }, config: { followInstalledSources: true } })
  assert.deepEqual(await runtime.service.readKitFiles(kit.name, kit.version), ['kit.yaml', 'mindset.md'])
  assert.equal((await runtime.service.readKitFile(kit.name, kit.version, 'mindset.md')).content, mindset)
  assert.equal((await runtime.service.readKitFile(kit.name, kit.version, 'kit.yaml')).content, manifest)
  await runtime.fiber.dispose()
}

{
  const unconfigured = await mount({ config: {} })
  await assert.rejects(unconfigured.service.readKitFiles('demo_kit', '1.0'), /studio.source_not_configured/)
  await unconfigured.fiber.dispose()
  const missing = { ...designMock().listKits()[0], sourceRoot: '/install/removed' }
  const runtime = await mount({ design: { listKits: () => [missing] }, config: { followInstalledSources: true } })
  await assert.rejects(runtime.service.readKitFiles('demo_kit', '1.0'), /studio.source_unavailable/)
  await runtime.fiber.dispose()
}
console.log('KIT FILE READS: exact pins, authored documents, confinement, binary/size and source diagnostics OK')

// Tree budgets bound enumeration even if the host exposes a cyclic/deep tree.
{
  const kit = { ...designMock().listKits()[0], sourceRoot: ROOT }
  for (const mode of ['depth', 'entries']) {
    const fs = memoryFs(kitFiles())
    const child = { targetKey: `${ROOT}/nested`, displayPath: `${ROOT}/nested` }
    fs.listDir = async () => mode === 'depth'
      ? [{ name: 'nested', type: 'directory', target: child }]
      : Array.from({ length: 20001 }, (_, index) => ({ name: `${index}.txt`, type: 'file', target: child }))
    const runtime = await mount({ fs, design: { listKits: () => [kit] }, config: { followInstalledSources: true } })
    await assert.rejects(runtime.service.readKitFiles('demo_kit', '1.0'), new RegExp(`${mode === 'depth' ? 'depth' : 'entry'} limit`))
    await runtime.fiber.dispose()
  }
}
