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

test('legacy scenario drafts do not make unchanged published design evidence stale', async () => {
  const files = new Map([
    ['questions/questions.json', '{"questions":{}}'],
    ['_experiences/demo/view.json', '{"version":"old"}'],
    ['_experiences/demo/old/preview.html', '<p>Derived preview</p>'],
  ])
  const store = {
    listWorktreeFiles: async () => [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([path, text]) => ({ path, size: Buffer.byteLength(text), mtimeMs: 1, ctimeMs: 1, ino: 1 })),
    readWorktreeText: async path => files.get(path),
    readWorktreeBytes: async path => Buffer.from(files.get(path)),
  }
  const published = await projectWorktreeDesign(store, {}, [skill], 'same-checkpoint')
  files.set('_experiences/demo/old/draft.json', '{"sources":{}}')
  const live = await projectWorktreeDesign(store, {}, [skill], 'same-checkpoint')
  assert.notEqual(live.revision, published.revision, 'Display still observes retained legacy files')
  assert.equal(live.evidenceRevision, published.evidenceRevision, 'Uncommitted legacy drafts are not new design evidence')
  files.set('_experiences/demo/old/preview.html', '<p>Changed derived preview</p>')
  assert.equal((await projectWorktreeDesign(store, {}, [skill], 'same-checkpoint')).evidenceRevision, published.evidenceRevision)
  files.set('questions/questions.json', '{"questions":{"new":true}}')
  assert.notEqual((await projectWorktreeDesign(store, {}, [skill], 'same-checkpoint')).evidenceRevision, published.evidenceRevision, 'Real design edits still invalidate reviews')
})
