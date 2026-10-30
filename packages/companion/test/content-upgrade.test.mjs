/** No content release/upgrade workflow remains reachable through the Host. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

test('removed content-upgrade operations preserve the current project and ordinary Bundle access', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const before = await f.server.project.store.head()
    const method = await call('prepareBundle', { skill: 'smart_questions' })
    for (const name of ['prepareContentUpgrade', 'readContentUpgradeDefinition', 'listContentUpgradeFiles', 'readContentUpgradeFile', 'writeContentUpgradeFile', 'validateContentUpgrade', 'finishContentUpgrade', 'recoverContentUpgrade', 'observePanelDraft']) {
      await assert.rejects(call(name), /method|unknown|allowed|unsupported/i)
    }
    assert.equal(await f.server.project.store.head(), before)
    assert.equal((await call('prepareBundle', { skill: 'smart_questions' })).method, method.method)
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})
