import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { executeDesignCommand } from '../src/client/design-command.ts'

test('project creation uses public command admission with no prompt fallback', async () => {
  const calls = []
  await executeDesignCommand({ execute: async (...args) => {
    calls.push(args)
    return { ok: true, value: { result: { kind: 'success', text: 'created' } } }
  } }, 'session-1', '/yugoo new synthetic')
  assert.deepEqual(calls, [['session-1', '/yugoo new synthetic', []]])
  const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /\['slots', 'sessions', 'remote', 'remote\.session', 'remote\.commands', 'remote\.designPanel'/, 'Cordis requires namespace injection before access')
  const start = source.indexOf('function DesignProjectSidebarHost')
  assert.ok(start >= 0)
  const sidebar = source.slice(start, source.indexOf('function AdvisorySidebarHost', start))
  assert.match(sidebar, /runtime\.sendCommand/)
  assert.doesNotMatch(sidebar, /runtime\.sendPrompt/)
})

test('unsupported, unrecognized and refused commands fail without a prompt retry', async () => {
  await assert.rejects(executeDesignCommand(undefined, 's', '/yugoo list'), /API unavailable/)
  await assert.rejects(executeDesignCommand({ execute: async () => ({ ok: true, value: undefined }) }, 's', '/yugoo list'), /unknown or malformed/)
  await assert.rejects(executeDesignCommand({ execute: async () => ({ ok: false, error: { code: 'DENIED', message: 'refused' } }) }, 's', '/yugoo list'), /DENIED: refused/)
  await assert.rejects(executeDesignCommand({ execute: async () => ({ ok: true, value: { result: { kind: 'error', text: 'invalid name' } } }) }, 's', '/yugoo new'), /invalid name/)
})


test('command arguments remain exact rather than rewriting user-owned design paths', async () => {
  const line = '/yugoo open /projects/design space /design notes'
  await executeDesignCommand({ execute: async (_id, input) => {
    assert.equal(input, line)
    return { ok: true, value: { result: { kind: 'success' } } }
  } }, 'session-1', line)
})
