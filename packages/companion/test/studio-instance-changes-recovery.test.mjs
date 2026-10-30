/** Real filesystem errors/process death at atomic write boundaries; no real profiles. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, rmdir } from 'node:fs/promises'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudioInstances } from '../src/studio-instances.mjs'
import { adapters, additions, pin } from './fixtures/studio-changes-fixture.mjs'

for (const fault of ['snapshot-error', 'record-error', 'before-record', 'after-record']) {
  test(`atomic multifile save: ${fault} never exposes a partial file set`, async t => {
    const stateRoot = await mkdtemp(join(tmpdir(), `studio-atomic-${fault}-`))
    t.after(() => rm(stateRoot, { recursive: true, force: true }))
    const options = { stateRoot, ...adapters() }, service = await createStudioInstances(options)
    const record = await service.copy({ kind: 'bundle', bundle: pin }), changes = additions()
    const before = new Map(await Promise.all(changes.map(async ({ path }) => [path, (await service.readFile({ id: record.id, path })).content])))
    const child = fork(new URL('./fixtures/studio-changes-child.mjs', import.meta.url), { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk })
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
    const exited = once(child, 'exit'), event = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Child did not reach ${fault}: ${stderr}`)), 15000)
      child.once('message', message => { clearTimeout(timeout); resolve(message) })
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Child exited before ${fault}: ${stderr}`)) })
    })
    child.send({ stateRoot, id: record.id, changes, fault })
    const message = await event
    if (fault.endsWith('error')) { assert.equal(message.event, 'failed'); assert.match(message.message, /injected/); await exited }
    else {
      assert.match(message.event, /^paused-/)
      if (fault === 'before-record') await assert.rejects(service.saveChanges({ id: record.id, expectedRevision: 0, changes: [{ path: 'SKILL.md', content: 'Concurrent writer must not win.' }] }), /saved elsewhere/)
      child.kill('SIGKILL'); await exited
    }
    const reopened = await createStudioInstances(options), visible = await reopened.read(record.id)
    const committed = fault === 'after-record'
    assert.equal(visible.revision, committed ? 1 : 0)
    for (const { path, content } of changes) assert.equal((await reopened.readFile({ id: record.id, path })).content, committed ? content : before.get(path))
    const diskRecord = JSON.parse(await readFile(join(stateRoot, 'studio-instance-drafts', `${record.id}.json`), 'utf8'))
    assert.equal(diskRecord.baseSnapshot, visible.baseSnapshot)
    if (!fault.endsWith('error')) {
      // Existing recovery contract: the owning process is now verified dead;
      // clear only this disposable test's empty stale lock before another write.
      await assert.rejects(reopened.saveFile({ id: record.id, expectedRevision: visible.revision, path: 'SKILL.md', content: 'retry' }), /saved elsewhere/)
      await rmdir(join(stateRoot, 'studio-instance-drafts/write.lock'))
    }
    const retry = await reopened.saveChanges({ id: record.id, expectedRevision: visible.revision, changes })
    assert.equal(retry.revision, visible.revision + 1)
  })
}
