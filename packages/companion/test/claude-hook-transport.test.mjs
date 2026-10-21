import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createClaudeHookConnection, receiveClaudeHook, registerClaudeHook, CLAUDE_NOTICE_FILE } from '../src/claude-hook-transport.mjs'
import { isClaudeExecutable, claudeProcess } from '../src/claude-connection.mjs'
import { receiveQoderHook, registerQoderHook } from '../src/qoder-hook-transport.mjs'

test('Claude Hook supports coalesced delivery, exact process generation, no replay and cwd changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-claude-hook-'))
  const sessionId = '00000000-0000-4000-8000-000000000001'
  let native = { pid: 1234, procStart: '10' }
  const options = { sessionId, hookRoot: join(root, 'private'), timeoutMs: 300, resolveSession: async () => native }
  const event = { hook_event_name: 'FileChanged', cwd: root, session_id: sessionId, file_path: join(root, CLAUDE_NOTICE_FILE), event: 'change' }
  let stopped = false, pause = false, loop
  const outputs = []
  try {
    assert.deepEqual(await registerClaudeHook({ ...event, hook_event_name: 'SessionStart' }, options), [event.file_path])
    loop = (async () => {
      while (!stopped) {
        if (!pause) outputs.push(...(await Promise.all([receiveClaudeHook(event, options), receiveClaudeHook(event, options)])).filter(Boolean))
        await delay(10)
      }
    })()
    const connection = await createClaudeHookConnection(options)
    assert.equal(connection.host, 'claude-code')
    assert.deepEqual(outputs, []) // readiness is transport-only, not a model turn
    assert.deepEqual(await connection.probe(), { status: 'available' })
    assert.deepEqual(outputs, [], 'an explicit availability check emits no model input')
    const receipts = await Promise.all([connection.send('FIRST'), connection.send('SECOND')])
    assert.ok(receipts.every(r => r.accepted && r.status === 'hook_received'))
    assert.equal(outputs.join('\n').match(/FIRST/g).length, 1)
    assert.equal(outputs.join('\n').match(/SECOND/g).length, 1)
    const nested = join(root, 'design_files'); await mkdir(nested)
    assert.deepEqual(await registerClaudeHook({ ...event, hook_event_name: 'CwdChanged', cwd: nested }, options), [event.file_path])
    event.cwd = nested
    assert.equal((await connection.send('AFTER_CD')).accepted, true)
    assert.equal(await receiveClaudeHook({ ...event, agent_id: 'worker' }, options), '')
    native = { pid: 1234, procStart: '11' }
    await assert.rejects(connection.probe(), /process changed/)
    await assert.rejects(connection.send('STALE'), /process changed/)
    await registerClaudeHook({ ...event, hook_event_name: 'SessionStart' }, options)
    assert.equal(await receiveClaudeHook(event, { ...options, resolveSession: async () => ({ pid: 1234, procStart: '10' }) }), '')
    await registerClaudeHook({ ...event, hook_event_name: 'SessionEnd' }, options)
    assert.equal(JSON.parse(await readFile(join(options.hookRoot, sessionId, 'binding.json'), 'utf8')).procStart, '11')
    native = { pid: 1234, procStart: '10' }
    await registerClaudeHook({ ...event, hook_event_name: 'SessionStart', cwd: root }, options)
    pause = true; stopped = true; await loop
    const result = await connection.send('UNCONFIRMED')
    assert.deepEqual(result, { accepted: false, status: 'unknown' })
    assert.equal(await receiveClaudeHook(event, options), '')
  } finally { stopped = true; await loop; await rm(root, { recursive: true, force: true }) }
})

test('Claude Hook fails closed for unregistered sessions, foreign triggers and missing receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-claude-hook-negative-'))
  const sessionId = '00000000-0000-4000-8000-000000000001'
  const options = { sessionId, hookRoot: join(root, 'private'), timeoutMs: 80, resolveSession: async () => ({ pid: 1234, procStart: '1' }) }
  const event = { session_id: sessionId, cwd: root, hook_event_name: 'SessionStart' }
  try {
    await assert.rejects(createClaudeHookConnection(options), /not registered/)
    await assert.rejects(registerClaudeHook({ ...event, session_id: '../another' }, options), /UUID/)
    await registerClaudeHook(event, options)
    await assert.rejects(createClaudeHookConnection(options), /Hook did not respond/)
    const trigger = join(root, CLAUDE_NOTICE_FILE)
    await writeFile(trigger, 'user content')
    await assert.rejects(createClaudeHookConnection(options), /existing file/)
    assert.equal(await readFile(trigger, 'utf8'), 'user content')
    // Even with an explicitly shared test root, the host trigger cannot be consumed by Qoder.
    await registerQoderHook(event, options)
    assert.equal(await receiveQoderHook({ ...event, hook_event_name: 'FileChanged', file_path: trigger, event: 'change' }, options), '')
    assert.equal(await receiveClaudeHook({ ...event, session_id: '00000000-0000-4000-8000-000000000002', hook_event_name: 'FileChanged', file_path: trigger }, options), '')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Claude native executable identification rejects namesakes, deleted executables and non-native node process', async () => {
  assert.equal(isClaudeExecutable('/home/user/.nvm/versions/node/v22/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe'), true)
  assert.equal(isClaudeExecutable('/home/user/.local/share/claude/versions/2.1.209'), true)
  for (const path of ['/tmp/claude.exe', '/usr/bin/node', '/tmp/claude', '/home/user/.local/share/claude/versions/../../evil', '/home/user/.local/share/claude/versions/2.1.209 (deleted)', '/tmp/node_modules/@anthropic-ai/claude-code/bin/not-claude']) assert.equal(isClaudeExecutable(path), false)
  assert.equal((await claudeProcess(process.pid)).claude, false)
  await assert.rejects(claudeProcess(1), /Invalid native PID/)
})
