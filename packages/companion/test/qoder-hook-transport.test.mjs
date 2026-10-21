import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createQoderHookConnection, receiveQoderHook, registerQoderHook, QODER_NOTICE_FILE } from '../src/qoder-hook-transport.mjs'
import { requireNotificationAccepted } from '../src/notification-result.mjs'

test('Hook session isolation, concurrent/coalesced notifications, restart guard and unknown receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-qoder-hook-'))
  const sessionId = '00000000-0000-4000-8000-000000000001'
  const other = '00000000-0000-4000-8000-000000000002'
  let native = { pid: 1234, procStart: 10 }
  const options = { sessionId, nativeCwd: root, hookRoot: join(root, 'private'), timeoutMs: 2000, resolveSession: async () => native }
  const event = { hook_event_name: 'FileChanged', cwd: root, session_id: sessionId, file_path: join(root, QODER_NOTICE_FILE), event: 'change' }
  await registerQoderHook({ ...event, hook_event_name: 'SessionStart' }, options)
  const outputs = []; let consume = true, stopped = false, removeNextClaim = false
  const loop = (async () => {
    while (!stopped) {
      if (consume) {
        assert.equal(await receiveQoderHook({ ...event, session_id: other }, options), '')
        const receiverOptions = { ...options, afterClaim: async base => {
          if (removeNextClaim) { removeNextClaim = false; await rm(`${base}.claimed`) }
        } }
        const values = await Promise.all([receiveQoderHook(event, receiverOptions), receiveQoderHook(event, receiverOptions)])
        outputs.push(...values.filter(Boolean))
      }
      await delay(20)
    }
  })()
  try {
    const connection = await createQoderHookConnection(options)
    assert.deepEqual(outputs, []) // Readiness probe must not wake model.
    const results = await Promise.all([connection.send('FIRST'), connection.send('SECOND')])
    assert.ok(results.every(x => x.accepted && x.status === 'hook_received'))
    assert.equal(outputs.join('\n').match(/FIRST/g).length, 1)
    assert.equal(outputs.join('\n').match(/SECOND/g).length, 1)
    const changedCwd = join(root, 'design_files'); await mkdir(changedCwd)
    assert.deepEqual(await registerQoderHook({ ...event, cwd: changedCwd, hook_event_name: 'CwdChanged' }, options), [join(root, QODER_NOTICE_FILE)])
    event.cwd = changedCwd
    assert.equal((await connection.send('AFTER_CD')).accepted, true)
    assert.match(outputs.join('\n'), /AFTER_CD/)
    removeNextClaim = true
    const race = await Promise.all([connection.send('RACE_A'), connection.send('RACE_B')])
    assert.equal(race.filter(x => x.accepted).length, 1)
    assert.equal(outputs.join('\n').match(/RACE_[AB]/g).length, 1)
    assert.equal(await receiveQoderHook({ ...event, agent_id: 'worker' }, options), '')
    native = { pid: 5678, procStart: 20 }
    await assert.rejects(connection.send('stale'), /process changed/)
    native = { pid: 1234, procStart: 10 }
    consume = false
    // Drain an already-entered receiver iteration before testing no delivery.
    // Flipping consume alone cannot cancel its pending filesystem reads.
    stopped = true
    await loop
    const result = await connection.send('UNKNOWN')
    assert.deepEqual(result, { accepted: false, status: 'unknown' })
    assert.equal(await receiveQoderHook(event, options), '') // no late automatic replay
  } finally { stopped = true; await loop; await rm(root, { recursive: true, force: true }) }
})

test('Native Hook registration and late SessionEnd cannot remove a replacement instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-qoder-registration-'))
  const event = { hook_event_name: 'SessionStart', session_id: '00000000-0000-4000-8000-000000000001', cwd: root }
  let native = { pid: 1234, procStart: '1' }
  const options = { hookRoot: root, resolveSession: async () => native }
  try {
    await registerQoderHook(event, options)
    native = { pid: 5678, procStart: '2' }
    await registerQoderHook(event, options)
    await registerQoderHook({ ...event, hook_event_name: 'SessionEnd' }, { ...options, resolveSession: async () => ({ pid: 1234, procStart: '1' }) })
    const binding = join(root, event.session_id, 'binding.json')
    assert.equal(JSON.parse(await readFile(binding, 'utf8')).pid, 5678)
    await registerQoderHook({ ...event, hook_event_name: 'SessionEnd' }, options)
    assert.equal(JSON.parse(await readFile(binding, 'utf8')).pid, 5678)
    assert.match(requireNotificationAccepted({ accepted: true, status: 'hook_received' }, 'Qoder'), /Hook 已接收/)
    assert.throws(() => requireNotificationAccepted({ accepted: false, status: 'unknown' }, 'Qoder'), /不要盲目重发/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Missing Hook fails startup; existing user file and symlink are not overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-qoder-hook-'))
  const options = { sessionId: '00000000-0000-4000-8000-000000000001', nativeCwd: root, hookRoot: join(root, 'private'), timeoutMs: 100,
    resolveSession: async () => ({ pid: 1234, procStart: 1 }) }
  try {
    await registerQoderHook({ hook_event_name:'SessionStart', session_id:options.sessionId, cwd:root }, options)
    await assert.rejects(createQoderHookConnection(options), /Hook did not respond/)
    const trigger = join(root, QODER_NOTICE_FILE)
    await writeFile(trigger, 'user data')
    await assert.rejects(createQoderHookConnection(options), /existing file/)
    assert.equal(await readFile(trigger, 'utf8'), 'user data')
    await rm(trigger)
    const target = join(root, 'untouched'); await writeFile(target, 'safe')
    await symlink(target, trigger)
    await assert.rejects(createQoderHookConnection(options))
    assert.equal(await readFile(target, 'utf8'), 'safe')
  } finally { await rm(root, { recursive: true, force: true }) }
})
