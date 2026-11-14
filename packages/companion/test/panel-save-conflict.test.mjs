/** Real Companion HTTP + built Core + Git, synthetic project only. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { openCompanionProject } from '../src/project.mjs'

const state = answer => ({ questions: { goal: { prompt: 'Goal?', kind: 'text', answer, detail: '' } } })
test('Companion stale save preserves Native state and leaves no false preparing notification', async t => {
  const f = await fixture(); t.after(() => f.close())
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  const api = f.server.project, base = state('Base'), native = state('Native'), draft = state('Human draft')
  await call('savePanel', { skill: 'smart_questions', state: base, eventId: 'initial-legacy' })
  await api.store.write('smart_questions', native, { origin: 'agent', settleEvent: async () => {} })
  const canonical = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
  const head = await api.store.head(), bytes = await readFile(canonical, 'utf8')
  await assert.rejects(call('savePanel', { skill: 'smart_questions', state: draft,
    artifacts: { before: base, artifacts: [] }, eventId: 'rejected-stale' }), /PANEL_SAVE_CONFLICT/)
  assert.equal(await readFile(canonical, 'utf8'), bytes)
  assert.equal(await api.store.head(), head)
  let workspace = await call('readWorkspace', {})
  assert.ok(!workspace.savedContinuations.some(e => e.eventId === 'rejected-stale'))
  assert.deepEqual(f.messages, [], 'conflicts never send an Agent continuation')
  const request = { skill: 'smart_questions', state: draft, artifacts: { before: native }, eventId: 'rejected-stale' }
  const saved = await call('savePanel', request)
  assert.ok(saved.commit)
  await api.store.write('smart_questions', state('Later Native'), { origin: 'agent', settleEvent: async () => {} })
  const laterHead = await api.store.head()
  const reopened = await openCompanionProject(f.options)
  const replay = await reopened.savePanel(request)
  assert.equal(replay.commit, saved.commit, 'reopen exercises Git audit replay, not the in-memory save map')
  assert.equal(await api.store.head(), laterHead)
  assert.equal(JSON.parse(await readFile(canonical, 'utf8')).questions.goal.answer, 'Later Native')
})
