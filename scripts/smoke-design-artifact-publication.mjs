/** Focused trusted artifact publication ordering and no-partial-publication smoke. */
import assert from 'node:assert/strict'
import {
  buildPinnedDesignArtifactInput,
  landedDesignArtifactSourceNames,
  publishTrustedDesignArtifacts,
  revalidateDesignArtifactDependencies,
} from '../packages/core/lib/index.js'

const dependencies = {
  sourceRevision: 'a'.repeat(40),
  files: [{ path: 'source/source.json', sha256: 'b'.repeat(64) }],
}
const limits = { maxArtifactCount: 3, maxTextBytes: 100, maxBinaryBytes: 100, maxTotalBytes: 200 }

const calls = []
const success = await publishTrustedDesignArtifacts({
  modelResult: { markdown: '# PRD' },
  dependencies,
  limits,
  prepare: async () => {
    calls.push('prepare')
    return { state: { status: 'completed' }, artifacts: { 'prd/prd.md': '# PRD' } }
  },
  validate: async () => { calls.push('validate') },
  revalidateDependencies: async () => { calls.push('revalidate') },
  commit: async () => { calls.push('commit'); return 'committed' },
})
assert.equal(success, 'committed')
assert.deepEqual(calls, ['prepare', 'validate', 'revalidate', 'commit'])

for (const phase of ['prepare', 'validate', 'revalidate']) {
  let commits = 0
  await assert.rejects(publishTrustedDesignArtifacts({
    modelResult: {}, dependencies, limits,
    prepare: async () => {
      if (phase === 'prepare') throw new Error('prepare failed')
      return { state: {}, artifacts: { 'prd/prd.md': '# PRD' } }
    },
    validate: async () => { if (phase === 'validate') throw new Error('validation failed') },
    revalidateDependencies: async () => { if (phase === 'revalidate') throw new Error('pin changed') },
    commit: async () => { commits += 1 },
  }))
  assert.equal(commits, 0, `${phase} failure must not publish`)
}

await assert.rejects(publishTrustedDesignArtifacts({
  modelResult: {}, dependencies, limits: { ...limits, maxTextBytes: 3 },
  prepare: async () => ({ state: {}, artifacts: { 'prd/prd.md': 'oversize' } }),
  validate: async () => {}, revalidateDependencies: async () => {}, commit: async () => {},
}), /size limit/)
await assert.rejects(publishTrustedDesignArtifacts({
  modelResult: {}, dependencies: { ...dependencies, files: [{ path: '../escape', sha256: 'b'.repeat(64) }] }, limits,
  prepare: async () => ({ state: {}, artifacts: { 'prd/prd.md': 'safe' } }),
  validate: async () => {}, revalidateDependencies: async () => {}, commit: async () => {},
}), /stay inside/)

const pinnedFiles = new Map([
  ['a/a.json', '{"records":[]}\n'],
  ['a/view.svg', '<svg/>'],
])
const inputLimits = { maxFileCount: 2, maxPathBytes: 64, maxFileBytes: 100, maxTotalBytes: 200 }
assert.deepEqual(
  landedDesignArtifactSourceNames(['a', 'b', 'c'], ['a/a.json', 'b/view.svg', 'c/c.json']),
  ['a', 'c'],
  'only canonical state makes a candidate Bundle a landed artifact source',
)
const prepared = await buildPinnedDesignArtifactInput({
  sourceRevision: 'c'.repeat(40),
  activeSourceSkills: ['a'],
  paths: [...pinnedFiles.keys()],
  limits: inputLimits,
  readText: async (path) => pinnedFiles.get(path),
})
assert.equal(prepared.input.sources[0].state.records.length, 0)
assert.equal(prepared.input.sources[0].artifacts[0].path, 'a/view.svg')
await revalidateDesignArtifactDependencies(prepared.dependencies, async (path) => pinnedFiles.get(path))
pinnedFiles.set('a/view.svg', '<svg>changed</svg>')
await assert.rejects(
  revalidateDesignArtifactDependencies(prepared.dependencies, async (path) => pinnedFiles.get(path)),
  /digest changed/,
)
await assert.rejects(buildPinnedDesignArtifactInput({
  sourceRevision: 'c'.repeat(40), activeSourceSkills: ['a'], paths: ['a/view.svg'], limits: inputLimits,
  readText: async (path) => pinnedFiles.get(path),
}), /missing canonical source/)
await assert.rejects(buildPinnedDesignArtifactInput({
  sourceRevision: 'c'.repeat(40), activeSourceSkills: ['a'], paths: ['a/a.json', 'a/b', 'a/c'], limits: inputLimits,
  readText: async () => '{}',
}), /maxFileCount/)
await assert.rejects(buildPinnedDesignArtifactInput({
  sourceRevision: 'c'.repeat(40), activeSourceSkills: ['a'], paths: ['a/a.json'], limits: { ...inputLimits, maxPathBytes: 3 },
  readText: async () => '{}',
}), /maxPathBytes/)
await assert.rejects(buildPinnedDesignArtifactInput({
  sourceRevision: 'c'.repeat(40), activeSourceSkills: ['a'], paths: ['a/a.json'], limits: { ...inputLimits, maxTotalBytes: 3 },
  readText: async () => '{}',
}), /maxTotalBytes/)
await assert.rejects(buildPinnedDesignArtifactInput({
  sourceRevision: 'c'.repeat(40), activeSourceSkills: ['a'], paths: ['a/a.json', 'a/unsafe\nname'], limits: inputLimits,
  readText: async () => '{}',
}), /stay inside/)

console.log('TRUSTED ARTIFACT PUBLICATION OK')
