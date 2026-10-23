import assert from 'node:assert/strict'
import test from 'node:test'
import { realpath } from 'node:fs/promises'
import { assertNodeVersion, assertNodeExecutablePath, inspectNodeRuntime, nodeRuntimeCandidates,
  resolveNodeRuntime, verifyNodeRuntime } from '../src/npm-node-runtime.mjs'

test('the engine minimum accepts odd and future majors without a new upper bound', () => {
  for (const version of ['22.19.0', 'v22.22.3', '23.11.1', '24.22.1', '26.0.0']) assert.ok(assertNodeVersion(version))
  for (const version of ['20.19.0', '22.18.9', '24.0.0-nightly', 'node24', '24', '99999999999999999999.0.0'])
    assert.throws(() => assertNodeVersion(version))
})

test('candidate discovery uses explicit selection and public installation locations, never application scans', () => {
  const environment = { Path: 'C:\\first;C:\\second;C:\\first;relative', LOCALAPPDATA: 'C:\\user\\local', ProgramFiles: 'C:\\Program Files' }
  assert.deepEqual(nodeRuntimeCandidates({ environment, platform: 'win32' }), [
    { executable: 'C:\\first\\node.exe', source: 'path' }, { executable: 'C:\\second\\node.exe', source: 'path' },
    { executable: 'C:\\Program Files\\nodejs\\node.exe', source: 'system-installation' },
    { executable: 'C:\\user\\local\\nodejs\\node.exe', source: 'system-installation' }])
  assert.deepEqual(nodeRuntimeCandidates({ nodeExecutable: 'C:\\chosen\\node.exe', environment, platform: 'win32' }),
    [{ executable: 'C:\\chosen\\node.exe', source: 'explicit' }])
  assert.equal(nodeRuntimeCandidates({ environment: { ...environment, YUGOO_NODE_EXECUTABLE: 'C:\\shared\\node.exe' }, platform: 'win32' })[0].source, 'environment')
})

test('private Preview, plugin and temporary paths are refused even as explicit locators', () => {
  for (const executable of ['C:\\YuGoo\\QwenWorkPreview\\tools\\node.exe', 'C:\\YuGoo\\WorkBuddyPreview\\tools\\node.exe',
    'C:\\app\\node_modules\\node\\node.exe', 'C:\\app\\resources\\app\\node.exe',
    'C:\\DSH\\resources\\runtime\\primary-runtime\\dependencies\\node\\node.exe',
    'C:\\Users\\me\\.loongsuite-pilot\\runtime\\node.exe', 'C:\\temp\\runtime\\node.exe', 'relative\\node.exe', '/drive-relative/node.exe'])
    assert.throws(() => assertNodeExecutablePath(executable, { platform: 'win32', environment: { TEMP: 'C:\\temp' } }))
  assert.equal(assertNodeExecutablePath('C:\\Users\\me\\.nvm\\v24\\node.exe', { platform: 'win32', environment: {} }), 'C:\\Users\\me\\.nvm\\v24\\node.exe')
})

const fake = (executable, version = '24.22.1') => ({ executable, version, sha256: 'a'.repeat(64), platform: 'win32', arch: 'x64', verified: true })
test('selection skips an incompatible public Node and pins one existing installation for all callers', async () => {
  const calls = [], options = { platform: 'win32', arch: 'x64', environment: { PATH: 'C:\\old;C:\\shared' },
    inspect: async executable => { calls.push(executable); return fake(executable, executable.includes('old') ? '20.19.0' : '24.22.1') } }
  const first = await resolveNodeRuntime(options), second = await resolveNodeRuntime(options)
  assert.equal(first.executable, 'C:\\shared\\node.exe'); assert.deepEqual(first, second)
  assert.equal(first.ownership, 'external'); assert.equal(first.installed, false); assert.equal(first.removal, 'not-owned-do-not-delete')
  assert.equal(calls.length, 4)
})

test('an invalid explicit selection cannot silently fall back to a different runtime', async () => {
  const calls = []
  await assert.rejects(resolveNodeRuntime({ nodeExecutable: 'C:\\old\\node.exe', platform: 'win32', arch: 'x64', environment: { PATH: 'C:\\shared' },
    inspect: async executable => { calls.push(executable); return fake(executable, '20.0.0') } }), /required/)
  assert.deepEqual(calls, ['C:\\old\\node.exe'])
})

test('PATH cannot smuggle a Preview runtime, including through a resolved alias', async () => {
  let calls = 0
  await assert.rejects(resolveNodeRuntime({ platform: 'win32', arch: 'x64', environment: { PATH: 'C:\\YuGoo\\QwenWorkPreview\\tools;C:\\alias' },
    inspect: async () => { calls++; return fake('C:\\YuGoo\\QwenWorkPreview\\node.exe') } }), { code: 'YUGOO_NODE_REQUIRED' })
  assert.equal(calls, 1)
})

test('platform, architecture and actual verification are required before selection', async () => {
  for (const override of [{ platform: 'linux' }, { arch: 'arm64' }, { verified: false }])
    await assert.rejects(resolveNodeRuntime({ nodeExecutable: 'C:\\shared\\node.exe', platform: 'win32', arch: 'x64', environment: {},
      inspect: async executable => ({ ...fake(executable), ...override }) }))
})

test('missing prerequisites have an actionable result without creating or acquiring a runtime', async () => {
  await assert.rejects(resolveNodeRuntime({ environment: {}, platform: 'win32', arch: 'x64' }), error => {
    assert.equal(error.code, 'YUGOO_NODE_REQUIRED'); assert.match(error.message, /did not download/); assert.deepEqual(error.rejected, []); return true
  })
})

test('real standalone Node is observed and hashed; changed receipt pins are rejected', async () => {
  const selected = { ...await inspectNodeRuntime(process.execPath), source: 'explicit' }
  assert.equal(selected.executable, await realpath(process.execPath)); assert.match(selected.sha256, /^[a-f0-9]{64}$/)
  assert.equal(selected.version, process.versions.node); assert.equal(selected.verified, true)
  await verifyNodeRuntime(selected)
  await assert.rejects(verifyNodeRuntime({ ...selected, sha256: '0'.repeat(64) }), /sha256 changed/)
})
