/** Keyless acceptance for the host-neutral Kit workspace read model. */
import assert from 'node:assert/strict'
import { StudioManagementService } from '../lib/index.js'

const longMindset = `# Web App Mindset\n${'Design the product one evidence-backed step at a time. 设计要一步一个证据。'.repeat(12)}`
const longRawSource = `---\nversion: "1.0"\nname: 'kit_a'\ndescription: First kit\n---\n${longMindset}`
const v2Mindset = '# Web App Mindset v2\nSecond installed version of the same Kit name.'
const v2RawSource = `---\nversion: "2.0"\nname: 'kit_a'\ndescription: First kit v2\n---\n${v2Mindset}`
const sharedBundle = { name: 'shared', version: '1.0', definition: { description: 'Shared workflow capability' } }
const analysisBundle = { name: 'analysis', version: '1.0', definition: { description: 'Analysis capability' } }
const snapshot = Object.freeze({
  kits: Object.freeze([
    Object.freeze({
      name: 'kit_a',
      version: '1.0',
      definition: Object.freeze({
        name: 'kit_a',
        version: '1.0',
        description: 'First kit',
        mindsetSource: longRawSource,
        mindset: longMindset,
        skills: [],
        relationVocabulary: Object.freeze({schemaVersion:1,kit:'kit_a',kitVersion:'1.0',revision:'kit-v1:abc',relations:Object.freeze([
          Object.freeze({type:'kit_a:validates',meaning:'supports',direction:'forward',label:Object.freeze({zh:'验证',en:'Validates'}),description:Object.freeze({zh:'验证关系',en:'Validation relation'}),domain:Object.freeze(['kit_a/source#/items']),range:Object.freeze(['kit_a/target#/items']),cardinality:Object.freeze({from:'many',to:'one'}),reasoning:Object.freeze({impact:true}),evidence:Object.freeze({minimum:'explicit'})}),
        ])}),
        resources: Object.freeze({
          'shared/reference/zeta.md': 'zeta',
          'shared/reference/alpha.md': 'alpha-content',
        }),
      }),
      bundles: Object.freeze([sharedBundle, analysisBundle]),
    }),
    Object.freeze({
      name: 'kit_a',
      version: '2.0',
      definition: Object.freeze({
        name: 'kit_a',
        version: '2.0',
        description: 'First kit v2',
        mindsetSource: v2RawSource,
        mindset: v2Mindset,
        skills: [],
        resources: Object.freeze({}),
      }),
      bundles: Object.freeze([analysisBundle]),
    }),
    Object.freeze({
      name: 'kit_b',
      version: '1.0',
      definition: Object.freeze({ name: 'kit_b', version: '1.0', mindsetSource: '---\nname: "kit_b"\nversion: "1.0"\n---\n# B', mindset: '# B', skills: [], resources: Object.freeze({}) }),
      bundles: Object.freeze([sharedBundle]),
    }),
  ]),
})

const catalog = { async snapshot() { return snapshot } }
const service = new StudioManagementService(catalog)

// One exact installed version resolves by name+version.
const latest = await service.readKitWorkspace('kit_a', '1.0')
assert.deepEqual(latest.diagnostics, [])
const workspace = latest.workspace
assert.equal(workspace.name, 'kit_a')
assert.equal(workspace.version, '1.0')
assert.equal(workspace.description, 'First kit')

// The complete raw installed mindset source, frontmatter included, is exposed
// for reading: no summary bound, no truncation, byte-identical to the
// DesignKit-retained installation bytes.
assert.equal(workspace.mindsetSource, longRawSource)
assert.equal(workspace.mindsetSource.length, longRawSource.length)

// Mounts keep catalog order and express reverse references only: the shared
// Bundle version is mounted by two different Kits, and the analysis Bundle by
// two versions of one Kit (many-to-many); a mount never implies ownership.
assert.deepEqual(workspace.mounts.map((mount) => mount.name), ['shared', 'analysis'])
assert.deepEqual(workspace.mounts[0], {
  name: 'shared',
  version: '1.0',
  description: 'Shared workflow capability',
  mountedBy: [
    { name: 'kit_a', version: '1.0' },
    { name: 'kit_b', version: '1.0' },
  ],
})
assert.deepEqual(workspace.mounts[1].mountedBy, [
  { name: 'kit_a', version: '1.0' },
  { name: 'kit_a', version: '2.0' },
])

// Resources project only loader-compiled paths, sorted, with byte sizes.
assert.deepEqual(workspace.resources, [
  { path: 'shared/reference/alpha.md', bytes: new TextEncoder().encode('alpha-content').length },
  { path: 'shared/reference/zeta.md', bytes: new TextEncoder().encode('zeta').length },
])
assert.deepEqual(workspace.relationVocabulary, {schemaVersion:1,pin:'kit-v1:abc',relations:[{
  type:'kit_a:validates',meaning:'supports',direction:'forward',label:{zh:'验证',en:'Validates'},description:{zh:'验证关系',en:'Validation relation'},
  domain:['kit_a/source#/items'],range:['kit_a/target#/items'],cardinality:{from:'many',to:'one'},reasoning:{impact:true},evidence:{minimum:'explicit'},
}]})

// The view is JSON-only and deeply frozen: no live definition object leaks.
const roundTrip = JSON.parse(JSON.stringify(workspace))
assert.deepEqual(roundTrip, workspace)
assert.ok(!JSON.stringify(workspace).includes('definition'))
assert.ok(Object.isFrozen(workspace) && Object.isFrozen(workspace.mounts[0]))

// Exact version pins resolve; foreign or absent identities diagnose.
const pinned = await service.readKitWorkspace('kit_a', '1.0')
assert.equal(pinned.workspace?.version, '1.0')

// A second installed version of the same name resolves by exact name+version:
// requesting 2.0 returns the 2.0 workspace, never a misdiagnosis against the
// first same-name entry.
const second = await service.readKitWorkspace('kit_a', '2.0')
assert.deepEqual(second.diagnostics, [])
assert.equal(second.workspace?.version, '2.0')
assert.equal(second.workspace?.mindsetSource, v2RawSource)
assert.deepEqual(second.workspace?.mounts.map((mount) => mount.name), ['analysis'])

const wrongVersion = await service.readKitWorkspace('kit_a', '99.0')
assert.equal(wrongVersion.workspace, undefined)
assert.equal(wrongVersion.diagnostics[0].code, 'workspace.version_missing')
assert.match(wrongVersion.diagnostics[0].message, /"1\.0", "2\.0"/, 'the diagnosis lists every installed version of the name')
const missingKit = await service.readKitWorkspace('kit_none', '1.0')
assert.equal(missingKit.workspace, undefined)
assert.equal(missingKit.diagnostics[0].code, 'workspace.kit_missing')

// A Kit without a description renders an empty string, not undefined.
const bare = await service.readKitWorkspace('kit_b', '1.0')
assert.equal(bare.workspace?.description, '')
assert.deepEqual(bare.workspace?.resources, [])
assert.deepEqual(bare.workspace?.relationVocabulary, {schemaVersion:1,pin:'legacy-unavailable',relations:[]})

console.log('STUDIO KIT WORKSPACE READ MODEL OK')
