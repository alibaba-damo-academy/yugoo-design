import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoPanelReconcileFence } from '../src/auto-panel-reconcile-fence.ts'

test('newer project event wins when two workspace reads finish in reverse order', async () => {
  const fence = new AutoPanelReconcileFence()
  let releaseOld
  const oldRead = new Promise(resolve => { releaseOld = resolve })
  const admitted = []
  const reconcile = async (sequence, read) => {
    fence.event('agent-a', sequence, false)
    if (!fence.begin('project-a', sequence)) return
    const target = await read
    if (fence.currentAgent('agent-a', sequence) && fence.current('project-a', sequence)) admitted.push(target)
  }
  const older = reconcile(1, oldRead)
  await reconcile(2, Promise.resolve('new revision'))
  releaseOld('old revision')
  await older
  assert.deepEqual(admitted, ['new revision'])
  assert.equal(fence.begin('project-a', 1), false)
  assert.equal(fence.begin('project-b', 1), true, 'other projects are independent')
  fence.dispose()
})

test('close invalidates an old read and reopening the same target has a new attempt owner', async () => {
  const fence = new AutoPanelReconcileFence()
  const initialOwner = fence.event('agent-a', 1, true)
  assert.equal(fence.begin('project-a', 1), true)
  fence.event('agent-a', 2, true) // close: selectedProjectForAgent will return undefined
  assert.equal(fence.currentAgent('agent-a', 1), false)
  const reopenedOwner = fence.event('agent-a', 3, true)
  assert.notEqual(reopenedOwner, initialOwner)
  assert.equal(fence.currentAgent('agent-a', 3), true)
  assert.equal(fence.begin('project-a', 3), true)
  fence.dispose()
})
