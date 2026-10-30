/** Keyless interaction acceptance for the shared read-only Studio controller. */
import assert from 'node:assert/strict'
import { StudioWorkspaceController } from '../lib/index.js'

const source = '---\nname: "web_app"\nversion: "1.0"\n---\n\n# Web App\n\n<design_skills>\n\n## questions\n\n</design_skills>\n'
const kitWorkspace = Object.freeze({
  name: 'web_app',
  version: '1.0',
  description: 'Web application mindset',
  mindsetSource: source,
  mounts: Object.freeze([Object.freeze({
    name: 'questions',
    version: '1.0',
    description: 'Capture product intent',
    mountedBy: Object.freeze([Object.freeze({ name: 'web_app', version: '1.0' })]),
  })]),
  resources: Object.freeze([Object.freeze({ path: 'shared/reference/a.md', bytes: 4 })]),
  relationVocabulary: Object.freeze({ schemaVersion: 1, pin: 'kit-empty:test', relations: Object.freeze([]) }),
})
const skillMd = '---\nname: questions\ndescription: "Capture product intent."\n---\n\n# questions\n\nMethod.\n'
const bundleWorkspace = Object.freeze({
  name: 'questions',
  version: '1.0',
  kit: 'web_app',
  description: 'Capture product intent',
  files: Object.freeze([
    Object.freeze({ path: 'SKILL.md', bytes: 10 }),
    Object.freeze({ path: 'skill.yaml', bytes: 12 }),
  ]),
  panel: Object.freeze({ kind: 'native', renderer: 'demo.questions/v1' }),
})
const workspaceQueries = []
const kitWorkspaceReads = []
const bundleWorkspaceReads = []
const bundleFileReads = []
let kitWorkspaceFails = false
let bundleWorkspaceFails = false
let bundleFileFails = false
let overrideBundleWorkspace
const client = {
  async workspace(query) {
    workspaceQueries.push(query)
    return Object.freeze({
      query,
      kits: Object.freeze([{ name: 'web_app', version: '1.0' }]),
      bundles: Object.freeze([{ name: 'questions', version: '1.0', description: 'Capture product intent', usedBy: Object.freeze([{ name: 'web_app', version: '1.0' }]) }]),
    })
  },
  async readKitWorkspace(name, version) {
    kitWorkspaceReads.push({ name, version })
    if (kitWorkspaceFails) throw new Error('kit workspace transport unavailable')
    if (name !== 'web_app' || version !== '1.0') {
      return Object.freeze({ diagnostics: Object.freeze([{ code: 'workspace.kit_missing', message: `no installed Kit ${name}@${version}`, subject: name }]) })
    }
    return Object.freeze({ workspace: kitWorkspace, diagnostics: Object.freeze([]) })
  },
  async readBundleWorkspace(name) {
    bundleWorkspaceReads.push(name)
    if (bundleWorkspaceFails) throw new Error('bundle workspace transport unavailable')
    if (overrideBundleWorkspace !== undefined) return overrideBundleWorkspace
    if (name !== 'questions') {
      return Object.freeze({ diagnostics: Object.freeze([{ code: 'bundle.missing', message: `no source Bundle ${name}`, subject: name }]) })
    }
    return Object.freeze({ workspace: bundleWorkspace, diagnostics: Object.freeze([]) })
  },
  async readBundleFile({ name, path }) {
    bundleFileReads.push({ name, path })
    if (bundleFileFails) throw new Error('bundle file transport unavailable')
    if (name !== 'questions' || (path !== 'SKILL.md' && path !== 'skill.yaml')) {
      return Object.freeze({ diagnostics: Object.freeze([{ code: 'bundle_file.missing', message: `no file ${path}`, subject: path }]) })
    }
    return Object.freeze({ file: Object.freeze({ path, content: path === 'SKILL.md' ? skillMd : 'name: questions\n' }), diagnostics: Object.freeze([]) })
  },
}

const controller = new StudioWorkspaceController(client)
let changes = 0
const dispose = controller.subscribe(() => { changes += 1 })
await controller.load()
assert.equal(controller.getSnapshot().phase, 'ready')
assert.deepEqual(controller.getSnapshot().view.kits, [{ name: 'web_app', version: '1.0' }], 'the Kit list is the entry view')
assert.deepEqual(workspaceQueries, [''])
console.log('the workspace loads once for the Kit-first entry')

// The read-only surface exposes no mutation vocabulary at all.
for (const absent of ['save', 'saveBundleFile', 'setMindsetSource', 'setBundleFileContent', 'createWorkingCopy', 'openWorkingCopy', 'closeEditor']) {
  assert.equal(controller[absent], undefined, `the controller exposes no ${absent}`)
}
console.log('the controller has no save, editor, or working-copy surface')

await controller.selectKit('web_app', '1.0')
assert.deepEqual(kitWorkspaceReads, [{ name: 'web_app', version: '1.0' }], 'selection reads the exact pin')
assert.equal(controller.getSnapshot().selectedKit, 'web_app')
assert.deepEqual(controller.getSnapshot().kitWorkspace, kitWorkspace)
assert.equal(controller.getSnapshot().kitTab, 'mindset', 'the Mindset section is the default foreground')

controller.setKitTab('mounts')
assert.equal(controller.getSnapshot().kitTab, 'mounts', 'the Mounted Bundles section is explicit controller state')

await controller.selectKit('absent_kit', '1.0')
assert.equal(controller.getSnapshot().diagnostics[0].code, 'workspace.kit_missing', 'an absent Kit diagnoses instead of opening')
assert.equal(controller.getSnapshot().selectedKit, 'web_app', 'a failed selection keeps the open workspace')

kitWorkspaceFails = true
await controller.selectKit('web_app', '1.0')
assert.equal(controller.getSnapshot().failure.code, 'request_failed')
assert.match(controller.getSnapshot().failure.message, /transport unavailable/)
kitWorkspaceFails = false
console.log('Kit Workspace reads require the exact pin and settle failures')

// A Bundle workspace overlays the Kit workspace it was opened from.
controller.setKitTab('mounts')
await controller.openBundleWorkspace('questions')
assert.deepEqual(bundleWorkspaceReads, ['questions'])
assert.deepEqual(controller.getSnapshot().bundleWorkspace, bundleWorkspace)
assert.deepEqual(controller.getSnapshot().kitWorkspace, kitWorkspace, 'the Kit workspace stays underneath the overlay')
assert.equal(controller.getSnapshot().selectedKit, 'web_app')
assert.deepEqual(bundleFileReads, [{ name: 'questions', path: 'SKILL.md' }], 'the first file opens in the viewer automatically')
assert.deepEqual(controller.getSnapshot().bundleFile, { name: 'questions', path: 'SKILL.md', content: skillMd })

await controller.openBundleFile('skill.yaml')
assert.equal(controller.getSnapshot().bundleFile.path, 'skill.yaml')
await controller.openBundleFile('absent.md')
assert.equal(controller.getSnapshot().bundleFile, undefined, 'a missing file closes the viewer')
assert.equal(controller.getSnapshot().diagnostics[0].code, 'bundle_file.missing')
console.log('the Bundle overlay opens the tree and views files byte-exactly')

// Closing the overlay returns to the Kit workspace exactly as it was.
await controller.openBundleWorkspace('questions')
controller.closeBundleWorkspace()
assert.equal(controller.getSnapshot().bundleWorkspace, undefined)
assert.equal(controller.getSnapshot().bundleFile, undefined)
assert.deepEqual(controller.getSnapshot().kitWorkspace, kitWorkspace, 'closing the overlay restores the Kit workspace without a re-read')
assert.equal(controller.getSnapshot().kitTab, 'mounts', 'the Kit Workspace section is preserved')
assert.ok(changes > 0)
console.log('closing the Bundle overlay returns to the open Kit workspace')

// The top-level Bundles section lists the catalog and opens the same workspace.
assert.equal(controller.getSnapshot().section, 'kits', 'Kits is the default top-level section')
controller.setSection('bundles')
assert.equal(controller.getSnapshot().section, 'bundles')
assert.equal(controller.getSnapshot().kitWorkspace, undefined, 'leaving the Kits section discards the open workspace')
controller.setBundleQuery('  QUEST  ')
assert.equal(controller.getSnapshot().bundleQuery, '  QUEST  ')
controller.setBundleQuery('')
await controller.openBundleWorkspace('questions')
assert.equal(controller.getSnapshot().section, 'bundles', 'opening from the Bundles list keeps the section')
controller.setSection('bundles')
assert.equal(controller.getSnapshot().bundleWorkspace, undefined, 'the active sidebar section returns from a Bundle to its catalog')
await controller.openBundleWorkspace('questions')
controller.closeBundleWorkspace()
assert.equal(controller.getSnapshot().bundleWorkspace, undefined)
assert.equal(controller.getSnapshot().section, 'bundles', 'closing an overlay opened from the Bundles list returns to that list')
await controller.selectKit('web_app', '1.0')
assert.equal(controller.getSnapshot().section, 'kits', 'selecting a Kit returns to the Kits section')
console.log('the top-level Kits/Bundles sections switch cleanly and keep overlay provenance')

await controller.openBundleWorkspace('absent_bundle')
assert.equal(controller.getSnapshot().bundleWorkspace, undefined)
assert.equal(controller.getSnapshot().diagnostics[0].code, 'bundle.missing', 'an absent Bundle diagnoses instead of opening')

overrideBundleWorkspace = Object.freeze({
  workspace: Object.freeze({ ...bundleWorkspace, name: 'other' }),
  diagnostics: Object.freeze([]),
})
await controller.openBundleWorkspace('questions')
assert.equal(controller.getSnapshot().bundleWorkspace, undefined)
assert.equal(controller.getSnapshot().diagnostics[0].code, 'bundle.name_mismatch', 'a diverged Bundle identity is never displayed')
overrideBundleWorkspace = undefined

bundleWorkspaceFails = true
await controller.openBundleWorkspace('questions')
assert.equal(controller.getSnapshot().failure.code, 'request_failed')
bundleWorkspaceFails = false
bundleFileFails = true
await controller.openBundleWorkspace('questions')
assert.equal(controller.getSnapshot().failure.code, 'request_failed', 'a failed file read settles the workspace')
bundleFileFails = false
console.log('Bundle reads diagnose missing identities, verify identity, and settle failures')

// Leaving during an in-flight selection discards the late read.
let completeSelect
const realRead = client.readKitWorkspace
client.readKitWorkspace = (name, version) => new Promise((resolve) => { completeSelect = () => resolve(realRead(name, version)) })
const selecting = controller.selectKit('web_app', '1.0')
controller.backToList()
completeSelect()
await selecting
assert.equal(controller.getSnapshot().kitWorkspace, undefined, 'a late selection never revives a left workspace')
client.readKitWorkspace = realRead

// Leaving during an in-flight Bundle open discards the late reads.
await controller.selectKit('web_app', '1.0')
let completeBundle
const realBundle = client.readBundleWorkspace
client.readBundleWorkspace = (name) => new Promise((resolve) => { completeBundle = () => resolve(realBundle(name)) })
const opening = controller.openBundleWorkspace('questions')
controller.backToList()
completeBundle()
await opening
assert.equal(controller.getSnapshot().bundleWorkspace, undefined, 'a late Bundle workspace never revives a left context')
assert.equal(controller.getSnapshot().kitWorkspace, undefined, 'back to the list clears the whole context')
client.readBundleWorkspace = realBundle

// Opening a catalog card retains its exact version through workspace and file reads.
let requestedPin
const exactBundleRead = client.readBundleWorkspace
client.readBundleWorkspace = async (name, version) => { requestedPin = { name, version }; return exactBundleRead(name) }
await controller.openBundleWorkspace('questions', '9.9')
assert.deepEqual(requestedPin, { name: 'questions', version: '9.9' })
assert.equal(controller.getSnapshot().bundleWorkspace, undefined, 'a different version must not silently open')
assert.equal(controller.getSnapshot().diagnostics[0].code, 'bundle.name_mismatch')
client.readBundleWorkspace = exactBundleRead

// A slower obsolete workspace response is discarded.
let staleResolve
const realWorkspace = client.workspace
client.workspace = (query) => (query === 'stale'
  ? new Promise((resolve) => { staleResolve = () => resolve(realWorkspace(query)) })
  : realWorkspace(query))
const staleLoad = controller.load('stale')
await controller.load('')
staleResolve()
await staleLoad
assert.equal(controller.getSnapshot().view.query, '', 'a slower obsolete workspace response never overwrites a newer read')
client.workspace = realWorkspace
console.log('navigation invalidates in-flight reads and stale responses never overwrite newer ones')

dispose()
console.log('DESIGN STUDIO UI CONTROLLER OK')
