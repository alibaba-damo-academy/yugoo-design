import test from 'node:test'
import assert from 'node:assert/strict'

const { register } = await import('tsx/esm/api')
register()
const { projectWorktreeDesign } = await import('../src/panel-worktree.ts')

const old = { state: { questions: {} }, origin: 'agent', panelYaml: 'old: declarative',
  skillManifest: { presentation: { mode: 'declarative', renderer: 'pilot-design/v2' } } }
const skill = { name: 'questions', metadata: { skillManifest: { presentation: { mode: 'auto' } } } }

test('current Kit presentation replaces stale Journal metadata over unchanged worktree state', async () => {
  const store = {
    listWorktreeFiles: async () => [{ path: 'questions/questions.json', size: 16, mtimeMs: 1, ctimeMs: 1, ino: 1 }],
    readWorktreeText: async () => JSON.stringify(old.state),
    readWorktreeBytes: async () => undefined,
  }
  const projection = await projectWorktreeDesign(store, { questions: old }, [skill], 'base')
  assert.deepEqual(projection.design.questions.skillManifest, skill.metadata.skillManifest)
  assert.equal(projection.design.questions.panelYaml, undefined)
  assert.deepEqual(projection.design.questions.state, old.state)
})

test('a deleted canonical file is not resurrected from a historical publication', async () => {
  const store = { listWorktreeFiles: async () => [], readWorktreeText: async () => undefined, readWorktreeBytes: async () => undefined }
  const projection = await projectWorktreeDesign(store, { questions: old }, [skill], 'base')
  assert.equal(projection.design.questions, undefined)
})
