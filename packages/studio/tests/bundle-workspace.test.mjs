/**
 * Keyless acceptance for read-only real-source Bundle inspection.
 *
 * Runs against an in-memory Bundle source port (no node:fs, no Git) to prove
 * the host-neutral read contract: complete file trees, byte-exact reads,
 * loader-compiled manifest/schema/validation summaries with Panel
 * classification, and loud rejection of unsafe paths, binary content,
 * duplicate physical sources, and compiled-catalog/source disagreements.
 *
 * Run (built plane): node tests/bundle-workspace.test.mjs
 */
import assert from 'node:assert/strict'
import { StudioBinaryContentError, StudioBundleSourceService } from '../lib/index.js'

const ROOT = '/install/demo_kit'
const ALPHA = `${ROOT}/skills/alpha`
const NATIVE = `${ROOT}/skills/native_view`

const SKILL_MD = '---\nname: alpha\ndescription: "Alpha facet."\n---\n\n# alpha\n\nAuthor the alpha method here.\n'
const SKILL_YAML = 'name: alpha\nversion: "1.0"\ntitle:\n  zh: "alpha"\n  en: "alpha"\nlabel:\n  zh: "alpha"\n  en: "alpha"\nexecution:\n  handoff: none\npresentation:\n  mode: none\n'
const SCHEMA_YAML = 'type: object\nproperties:\n  summary:\n    type: string\n'
const VALIDATION_YAML = 'skill: alpha\nrules:\n  - id: definition_contract\n    scope: [completion]\n    code: alpha.summary_present\n    message: describe the facet in `summary` before completing.\n    check:\n      non_empty_string: summary\n'
const NATIVE_YAML = 'name: native_view\nversion: "1.0"\ntitle:\n  zh: "native_view"\n  en: "native_view"\nlabel:\n  zh: "native_view"\n  en: "native_view"\nexecution:\n  handoff: none\npresentation:\n  mode: native\n  renderer: demo.native-view/v1\n'
const NOTES_MD = '# Alpha notes\n\n设计要一步一个证据。\n'

/** A valid two-Bundle Kit source tree plus one binary and one nested text file. */
function sourceFiles() {
  return {
    [`${ROOT}/mindset.md`]: '---\nname: demo_kit\nversion: "1.0"\ndescription: "Demo Studio Kit."\n---\n\n# demo_kit Design Mindset\n\nCalibrate design judgment.\n\n<design_skills>\n\n## alpha\n\nAlpha facet.\n\n## native_view\n\nNative view facet.\n\n</design_skills>\n',
    [`${ALPHA}/SKILL.md`]: SKILL_MD,
    [`${ALPHA}/skill.yaml`]: SKILL_YAML,
    [`${ALPHA}/schema.yaml`]: SCHEMA_YAML,
    [`${ALPHA}/validation.yaml`]: VALIDATION_YAML,
    [`${ALPHA}/reference/notes.md`]: NOTES_MD,
    // The loader skips dot entries, so a binary dotfile coexists with a
    // loadable Kit; the readable-file tree still excludes it.
    [`${ALPHA}/.icon.bin`]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]),
    [`${NATIVE}/SKILL.md`]: '---\nname: native_view\ndescription: "Native view facet."\n---\n\n# native_view\n\nMethod.\n',
    [`${NATIVE}/skill.yaml`]: NATIVE_YAML,
    [`${NATIVE}/schema.yaml`]: SCHEMA_YAML,
    [`${NATIVE}/validation.yaml`]: 'skill: native_view\nrules:\n  - id: r\n    scope: [completion]\n    code: native_view.r\n    message: m\n    check:\n      driver: demo.check/v1\n',
  }
}

/** In-memory read-only Bundle source port; Uint8Array values are binary. */
function sourcePort(files, roots) {
  const map = new Map(Object.entries(files))
  return {
    map,
    async listKitRoots() { return roots },
    async readText(path) {
      const value = map.get(path)
      if (value === undefined) return undefined
      if (typeof value !== 'string') throw new StudioBinaryContentError(path)
      return value
    },
    async listDir(path) {
      const prefix = `${path}/`
      const names = new Set()
      for (const key of map.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0])
      return [...names].sort()
    },
    async isDirectory(path) {
      const prefix = `${path}/`
      for (const key of map.keys()) if (key.startsWith(prefix)) return true
      return false
    },
    async listFiles(dir) {
      const prefix = `${dir}/`
      return [...map.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort()
    },
  }
}

function skillSnapshot(name, version) {
  return Object.freeze({ name, version, definition: Object.freeze({ name, version, description: `${name} facet.` }) })
}

/** Compiled catalog agreeing with the source tree. */
function agreeingCatalog() {
  return {
    async snapshot() {
      return Object.freeze({
        kits: Object.freeze([Object.freeze({
          name: 'demo_kit',
          version: '1.0',
          definition: Object.freeze({ name: 'demo_kit', version: '1.0' }),
          bundles: Object.freeze([skillSnapshot('alpha', '1.0'), skillSnapshot('native_view', '1.0')]),
        })]),
      })
    },
  }
}

const port = sourcePort(sourceFiles(), [ROOT])
const service = new StudioBundleSourceService(agreeingCatalog(), port)

// The workspace lists the complete readable file tree with compiled summaries.
const opened = await service.readBundleWorkspace('alpha')
assert.deepEqual(opened.diagnostics, [])
const workspace = opened.workspace
assert.equal(workspace.name, 'alpha')
assert.equal(workspace.version, '1.0')
assert.equal(workspace.kit, 'demo_kit')
assert.equal(workspace.description, 'Alpha facet.')
assert.deepEqual(workspace.files, [
  { path: 'SKILL.md', bytes: new TextEncoder().encode(SKILL_MD).length },
  { path: 'reference/notes.md', bytes: new TextEncoder().encode(NOTES_MD).length },
  { path: 'schema.yaml', bytes: new TextEncoder().encode(SCHEMA_YAML).length },
  { path: 'skill.yaml', bytes: new TextEncoder().encode(SKILL_YAML).length },
  { path: 'validation.yaml', bytes: new TextEncoder().encode(VALIDATION_YAML).length },
], 'the tree lists nested UTF-8 files and excludes the binary asset')
assert.deepEqual(workspace.manifest.presentation, { mode: 'none' })
assert.deepEqual(workspace.schema, { type: 'object', properties: { summary: { type: 'string' } } })
assert.deepEqual(workspace.validation, { rules: 1, drivers: [] })
assert.equal(workspace.panel, undefined, 'a presentation-less Bundle has no Panel classification')
assert.ok(!workspace.files.some((file) => file.path === '.icon.bin'), 'the binary dotfile stays out of the readable tree')
const roundTrip = JSON.parse(JSON.stringify(workspace))
assert.deepEqual(roundTrip, workspace, 'the view is JSON-only')
console.log('the Bundle workspace is the readable source tree with compiled summaries')

// Panel classification distinguishes provider-owned native Panels, and driver
// references surface in the validator summary.
const native = await service.readBundleWorkspace('native_view')
assert.deepEqual(native.workspace.panel, { kind: 'native', renderer: 'demo.native-view/v1' })
assert.deepEqual(native.workspace.validation, { rules: 1, drivers: ['demo.check/v1'] })
console.log('native Panels classify as provider-owned and validator drivers surface')

// File reads are byte-exact, including multibyte content.
const read = await service.readBundleFile({ name: 'alpha', path: 'reference/notes.md' })
assert.deepEqual(read.diagnostics, [])
assert.equal(read.file.content, NOTES_MD)
assert.equal((await service.readBundleFile({ name: 'alpha', path: 'SKILL.md' })).file.content, SKILL_MD)

// Unsafe paths, directories, missing files, and binary content diagnose.
for (const path of ['../mindset.md', '.git/config', '/etc/passwd', 'a/../../b', './SKILL.md', 'x\\y.md', 'reference']) {
  const rejected = await service.readBundleFile({ name: 'alpha', path })
  assert.equal(rejected.file, undefined)
  assert.ok(['bundle_file.path_forbidden', 'bundle_file.missing'].includes(rejected.diagnostics[0].code), `path ${JSON.stringify(path)} is rejected`)
}
assert.equal((await service.readBundleFile({ name: 'alpha', path: '../mindset.md' })).diagnostics[0].code, 'bundle_file.path_forbidden')
assert.equal((await service.readBundleFile({ name: 'alpha', path: 'reference' })).diagnostics[0].code, 'bundle_file.missing', 'a directory never resolves as a file')
assert.equal((await service.readBundleFile({ name: 'alpha', path: '.icon.bin' })).diagnostics[0].code, 'bundle_file.binary')
assert.equal((await service.readBundleWorkspace('absent')).diagnostics[0].code, 'bundle.missing')
console.log('traversal, .git, directories, and binary content are rejected explicitly')

// An uncataloged physical Bundle diagnoses instead of guessing.
port.map.set(`${ROOT}/skills/ghost/SKILL.md`, '# Ghost\n')
assert.equal((await service.readBundleWorkspace('ghost')).diagnostics[0].code, 'bundle.not_in_catalog')

// A broken source diagnoses through the loader.
const brokenPort = sourcePort(sourceFiles(), [ROOT])
brokenPort.map.set(`${ALPHA}/skill.yaml`, 'name: [unclosed\n')
const broken = new StudioBundleSourceService(agreeingCatalog(), brokenPort)
assert.equal((await broken.readBundleWorkspace('alpha')).diagnostics[0].code, 'kit.load')
console.log('uncataloged and unloadable sources diagnose without silent-empty results')

// The same Bundle name in two configured roots fails loud.
const secondRoot = '/install/other_kit'
const duplicatePort = sourcePort(sourceFiles(), [ROOT, secondRoot])
duplicatePort.map.set(`${secondRoot}/skills/alpha/SKILL.md`, '# Other alpha\n')
const duplicated = new StudioBundleSourceService(agreeingCatalog(), duplicatePort)
const duplicate = await duplicated.readBundleWorkspace('alpha')
assert.equal(duplicate.workspace, undefined)
assert.equal(duplicate.diagnostics[0].code, 'studio.duplicate_source')
console.log('one Bundle name in two configured sources fails loud')

// Compiled-catalog/source identity disagreements fail loud by exact name+version.
const missingKit = new StudioBundleSourceService({
  async snapshot() { return Object.freeze({ kits: Object.freeze([]) }) },
}, sourcePort(sourceFiles(), [ROOT]))
assert.equal((await missingKit.readBundleWorkspace('alpha')).diagnostics[0].code, 'studio.source_catalog_mismatch')

const driftedBundle = new StudioBundleSourceService({
  async snapshot() {
    return Object.freeze({
      kits: Object.freeze([Object.freeze({
        name: 'demo_kit',
        version: '1.0',
        definition: Object.freeze({}),
        bundles: Object.freeze([skillSnapshot('alpha', '2.0'), skillSnapshot('native_view', '1.0')]),
      })]),
    })
  },
}, sourcePort(sourceFiles(), [ROOT]))
const drifted = await driftedBundle.readBundleWorkspace('alpha')
assert.equal(drifted.workspace, undefined)
assert.equal(drifted.diagnostics[0].code, 'studio.source_catalog_mismatch')
console.log('a compiled catalog that disagrees with the source fails loud')

console.log('STUDIO BUNDLE SOURCE READ MODEL OK')

// An independent Bundle remains inspectable with no Kit owner at all.
const independentDefinition = { name: 'alpha', version: '1.0', description: 'Independent alpha' }
const independentCatalog = { snapshot: async () => ({ kits: [], bundles: [
  { name: 'alpha', version: '1.0', definition: independentDefinition },
] }) }
const independentPort = sourcePort(sourceFiles(), [])
independentPort.resolveBundleRoot = async pin => pin.name === 'alpha' && pin.version === '1.0' ? ALPHA : undefined
const independentService = new StudioBundleSourceService(independentCatalog, independentPort)
const standalone = await independentService.readBundleWorkspace('alpha', '1.0')
assert.deepEqual(standalone.diagnostics, [])
assert.equal(standalone.workspace.kit, undefined, 'no synthetic Kit ownership')
assert.ok(standalone.workspace.files.some(file => file.path === 'SKILL.md'))
assert.equal((await independentService.readBundleFile({ name: 'alpha', version: '1.0', path: 'SKILL.md' })).file.content, SKILL_MD)
assert.equal((await independentService.readBundleWorkspace('alpha', '9.0')).diagnostics[0].code, 'bundle.missing')
assert.equal((await independentService.readBundleFile({ name: 'alpha', version: '1.0', path: '../mindset.md' })).diagnostics[0].code, 'bundle_file.path_forbidden')
const ambiguousService = new StudioBundleSourceService({ snapshot: async () => ({ kits: [], bundles: [
  { name: 'alpha', version: '1.0', definition: independentDefinition },
  { name: 'alpha', version: '2.0', definition: { ...independentDefinition, version: '2.0' } },
] }) }, independentPort)
assert.equal((await ambiguousService.readBundleWorkspace('alpha')).diagnostics[0].code, 'studio.ambiguous_version')
console.log('STUDIO INDEPENDENT BUNDLE SOURCE READ MODEL OK')
