import { executePublicSyncFileStep } from '../public-sync-file-step.mjs'

process.once('message', async ({ input, stage }) => {
  await executePublicSyncFileStep({ ...input, onCheckpoint: async event => {
    if (event.stage !== stage) return
    process.send({ stage })
    await new Promise(() => {}) // Parent confirms live checkpoint, then terminates its owned child.
  } })
})
