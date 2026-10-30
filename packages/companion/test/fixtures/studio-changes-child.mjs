/** Fault injection lives only in this disposable test process. */
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, join } from 'node:path'

process.once('message', async ({ stateRoot, id, changes, fault }) => {
  const rename = fs.promises.rename.bind(fs.promises)
  const recordPath = join(stateRoot, 'studio-instance-drafts', `${id}.json`)
  const snapshotDirectory = join(stateRoot, 'studio-instance-drafts', 'snapshots')
  fs.promises.rename = async (from, to) => {
    const target = String(to), record = target === recordPath
    if (fault === 'snapshot-error' && dirname(target) === snapshotDirectory) throw new Error('injected snapshot rename failure')
    if (record && fault === 'record-error') throw new Error('injected record rename failure')
    if (record && fault === 'before-record') {
      process.send({ event: 'paused-before-record' })
      await new Promise(() => {})
    }
    await rename(from, to)
    if (record && fault === 'after-record') {
      process.send({ event: 'paused-after-record' })
      await new Promise(() => {})
    }
  }
  syncBuiltinESMExports()
  try {
    const { createStudioInstances } = await import('../../src/studio-instances.mjs')
    const { adapters } = await import('./studio-changes-fixture.mjs')
    const service = await createStudioInstances({ stateRoot, ...adapters() })
    await service.saveChanges({ id, expectedRevision: 0, changes })
    process.send({ event: 'unexpected-success' })
  } catch (error) { process.send({ event: 'failed', message: error.message }) }
  process.disconnect()
})
