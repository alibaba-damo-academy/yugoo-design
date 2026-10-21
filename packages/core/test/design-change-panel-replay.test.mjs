import assert from 'node:assert/strict'
import { test } from 'node:test'

const { register } = await import('tsx/esm/api')
register()
const { default: DesignService } = await import('../src/design-service.ts')

for (const origin of ['panel', 'agent']) test(`a committed ${origin} event is settled and notified once, but a missing settlement can be repaired`, async () => {
  const service = Object.create(DesignService.prototype)
  const agent = { id: 'agent-a' }
  const projectId = 'project-a'
  const kit = { name: 'test-kit', version: '1.0' }
  const records = []
  const notifications = []
  let failNextAppend = false, failAfterAppend = false
  service.authorizeProjectWrite = async () => kit
  service.withJournal = async (_agent, action) => action('state-root', 'agent-a')
  service.journals = {
    read: async () => ({ revision: records.length, records, snapshot: { latestKitSelection: { kit: kit.name, version: kit.version } } }),
    append: async (_root, _conversation, fact) => {
      if (failNextAppend) { failNextAppend = false; throw new Error('temporary Journal outage') }
      const revision = records.length + 1
      records.push({ ...fact, revision })
      if (failAfterAppend) { failAfterAppend = false; throw new Error('append landed then failed') }
      return { revision }
    },
  }
  service.activeWorkspaces = new Map()
  service.notifyWorkspaceChange = change => { notifications.push(change) }
  const payload = { kit: kit.name, version: kit.version, skill: 'decision_brief', origin, ...(origin === 'agent' ? { execution: { invocationId: 'producer-1', stateStatus: 'complete', handoff: 'none' } } : {}), commit: 'a'.repeat(40), state: { questions: {} } }
  assert.equal(await service.recordDesignChange(agent, projectId, payload), 1)
  assert.equal(await service.recordDesignChange(agent, projectId, payload), 1)
  assert.equal(records.length, 1)
  assert.equal(notifications.length, 1)
  await assert.rejects(service.recordDesignChange(agent, projectId, { ...payload, state: { questions: { changed: true } } }), /reused with different facts/)
  const nextPayload = { ...payload, commit: 'b'.repeat(40) }
  assert.equal(await service.recordDesignChange(agent, projectId, nextPayload), 2)
  assert.equal(records.length, 2)
  assert.equal(notifications.length, 2)
  const repairPayload = { ...payload, commit: 'c'.repeat(40) }
  failNextAppend = true
  await assert.rejects(service.recordDesignChange(agent, projectId, repairPayload), /temporary Journal outage/)
  assert.equal(records.length, 2)
  assert.equal(await service.recordDesignChange(agent, projectId, repairPayload), 3)
  assert.equal(records.length, 3)
  assert.equal(notifications.length, 3)
  const durablePayload = { ...payload, commit: 'd'.repeat(40) }
  failAfterAppend = true
  await assert.rejects(service.recordDesignChange(agent, projectId, durablePayload), /append landed then failed/)
  assert.equal(records.length, 4)
  assert.equal(notifications.length, 3)
  assert.equal(await service.recordDesignChange(agent, projectId, durablePayload), 4)
  assert.equal(await service.recordDesignChange(agent, projectId, durablePayload), 4)
  assert.equal(records.length, 4, 'durable append replay does not duplicate the Journal fact')
  assert.equal(notifications.length, 4, 'missing post-append notification is actually recovered')
  if (origin === 'agent') await assert.rejects(service.recordDesignChange(agent, projectId, {
    ...durablePayload, execution: { ...payload.execution, stateStatus: 'pending' },
  }), /reused with different facts/)
})
