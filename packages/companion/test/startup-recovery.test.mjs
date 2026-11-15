import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, stat, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'

for (const mode of ['native', 'managed']) test(`${mode}: an ownerless review lock cannot prevent conversation startup or leak resources at close`, async () => {
  const serverOptions = mode === 'managed' ? { backgroundReviews: true, reviewExecutor: async () => { throw Error('This fixture never executes a reviewer') } } : {}
  const f = await fixture({ withTranscript: true, serverOptions })
  let server
  const errors = [], previousError = console.error
  try {
    await f.server.close()
    const lock = join(f.options.stateRoot, f.server.project.project.metadata.id, 'review.lock')
    await mkdir(lock)
    console.error = (...args) => errors.push(args.join(' '))
    // The old implementation rejects here after its lock timeout, having already
    // opened HTTP and written a connection file that no caller can then close.
    server = await startCompanion({ ...f.options, ...serverOptions })
    assert.equal((await fetch(server.origin)).status, 200)
    assert.equal((await callCompanion(server.connectionPath, { method: 'readConversation' })).conversation.available, true)
    assert.deepEqual(await readdir(lock), [], 'unknown ownership never authorizes deleting a lock')
    const workspace = await callCompanion(server.connectionPath, { method: 'readWorkspace' })
    assert.equal(workspace.projectId, f.server.project.project.metadata.id)
    assert.ok(workspace.design)
    assert.equal(workspace.conversation.available, true)
    assert.match(workspace.backgroundReviews.error, /Review storage is locked/)
    assert.equal(workspace.reviewStatusError, workspace.backgroundReviews.error)
    assert.equal(workspace.clarity.assessment, null)
    await assert.rejects(callCompanion(server.connectionPath, { method: 'prepareReviews', params: { profiles: ['alignment'] } }), /Review storage is locked/, 'display recovery does not bypass review mutation locking')
    const origin = server.origin, connectionPath = server.connectionPath
    await server.close(); server = undefined
    assert.ok(errors.some(error => /review recovery:.*Review storage is locked/.test(error)), 'the derived error remains visible')
    await assert.rejects(fetch(origin))
    await assert.rejects(stat(connectionPath), { code: 'ENOENT' })
    assert.deepEqual(await readdir(lock), [])
  } finally {
    await server?.close()
    console.error = previousError
    await f.close()
  }
})

test('connection-file startup failure closes HTTP, frontend and the owned transport', async () => {
  const f = await fixture()
  let origin, closed = 0, frontendClosed = 0
  try {
    await f.server.close()
    const connections = join(f.options.stateRoot, 'connections')
    await rm(connections, { recursive: true })
    await writeFile(connections, 'owned failure fixture')
    const connection = { ...f.options.connection, async close() { await new Promise(resolve => setImmediate(resolve)); closed++ } }
    await assert.rejects(startCompanion({ ...f.options, connection, devFrontend: async input => {
      origin = input.origin
      assert.equal((await fetch(origin)).status, 200)
      return { close() { frontendClosed++ } }
    } }), error => ['EEXIST', 'ENOTDIR'].includes(error.code) && error.path === connections)
    assert.equal(closed, 1)
    assert.equal(frontendClosed, 1)
    await assert.rejects(fetch(origin))
    assert.equal((await stat(connections)).isFile(), true, 'failed connection creation never owns an existing path')
  } finally { await f.close() }
})
