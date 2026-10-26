import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const bridge = fileURLToPath(new URL('../src/codex-desktop-bridge.mjs', import.meta.url))

test('bridge startup never prints malformed private connection bytes or file paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-bridge-private-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'connection.json')
  const marker = 'PRIVATE_TEST_VALUE_NOT_FOR_LOGS'
  await writeFile(path, `{ "token": "${marker}", malformed`, { mode: 0o600 })
  await assert.rejects(exec(process.execPath, [bridge, '--connection', path]), error => {
    assert.equal(error.code, 1)
    assert.equal(error.stdout, '')
    assert.equal(error.stderr.trim(), 'CODEX_DESKTOP_BRIDGE_STOPPED')
    assert.ok(!error.stderr.includes(marker) && !error.stderr.includes(path))
    return true
  })
})

test('bridge rejects another thread before attempting native transport', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-bridge-thread-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'connection.json')
  await writeFile(path, JSON.stringify({ host: 'codex', codexDesktop: true,
    threadId: '00000000-0000-4000-8000-000000000001', nativeCwd: process.cwd() }), { mode: 0o600 })
  await assert.rejects(exec(process.execPath, [bridge, '--connection', path], {
    env: { ...process.env, CODEX_THREAD_ID: '00000000-0000-4000-8000-000000000002' },
  }), error => {
    assert.equal(error.code, 1)
    assert.equal(error.stdout, '')
    assert.equal(error.stderr.trim(), 'CODEX_DESKTOP_CONNECTION_MISMATCH')
    return true
  })
})
