import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { createCompanionKnowledge } from '../src/knowledge.mjs'
import { GitVersioning, nodeDesignProjectSpawn } from '../../core/lib/index.js'
import * as runtime from '../../knowledge-ladybug/lib/index.js'

after(() => runtime.shutdownLadybugKnowledgeRuntime())

test('Companion KAG persists in project Git and restores into a fresh machine cache without regenerating sources', async () => {
  const f = await fixture()
  const project = f.server.project
  const projectRoot = project.project.root
  let knowledge
  try {
    await project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '可恢复的任务看板' } } },
      { origin: 'agent', settleEvent: async () => {} })
    const sourceCheckpoint = await project.store.head()
    const source = await readFile(join(project.project.designFilesRoot, 'smart_questions/smart_questions.json'))
    const options = { project, stateRoot: f.options.stateRoot, loadRuntime: async () => runtime, embedding: { provider: 'disabled' } }
    knowledge = createCompanionKnowledge(options)
    await knowledge.notify()
    const first = JSON.parse((await knowledge.readGraph()).content)
    assert.equal(first.knowledgeStatus, 'current')
    assert.ok(first.nodes.length > 0)
    const savedCheckpoint = await project.store.head()
    assert.notEqual(savedCheckpoint, sourceCheckpoint, 'The archive is a real project commit')
    assert.equal(await project.store.sameDesignEvidenceAt(sourceCheckpoint, savedCheckpoint), true)
    const relative = 'design_records/knowledge/archive.json'
    const bytes = await readFile(join(projectRoot, relative), 'utf8')
    const git = new GitVersioning(nodeDesignProjectSpawn, projectRoot)
    assert.equal(await git.readTextAt(savedCheckpoint, relative), bytes, 'Archive bytes, not just a cache pointer, are committed')
    assert.equal(JSON.parse(bytes).archive.projectId, project.project.metadata.id)
    await knowledge.close()
    knowledge = createCompanionKnowledge({ ...options, stateRoot: join(f.root, 'fresh-machine-cache') })
    const restored = JSON.parse((await knowledge.readGraph()).content)
    assert.equal(restored.knowledgeStatus, 'current')
    assert.deepEqual(restored.nodes, first.nodes)
    assert.deepEqual(restored.edges, first.edges)
    assert.equal(await project.store.head(), savedCheckpoint, 'Opening a cache is not a design or record rewrite')
    assert.deepEqual(await readFile(join(project.project.designFilesRoot, 'smart_questions/smart_questions.json')), source)
    assert.equal(f.messages.length, 0, 'Restoring knowledge never dispatches foreground or review work')
  } finally { await knowledge?.close(); await f.close() }
})
