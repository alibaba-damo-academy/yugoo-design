import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesWindowsWorker, windowsCommandArgs, windowsProcess } from '../src/windows-native-platform.mjs'
import { validatePrivateSddl, validateAncestorSddl } from '../src/windows-private-storage.mjs'
const sid = 'S-1-5-21-1-2-3-1001'
test('Windows ACL rejects other principals, inheritance and missing user rights', () => {
  const valid = `O:${sid}G:SYD:P(A;OICI;FA;;;${sid})(A;;FA;;;SY)`
  assert.doesNotThrow(() => validatePrivateSddl(valid, sid, { protectedAcl: true }))
  for (const sddl of [valid.replace(sid, 'BA'), valid.replace('D:P', 'D:AI'), valid + '(A;;FR;;;WD)', valid.replace('FA;;;'+sid, 'FR;;;'+sid), valid + '(OA;;FA;;;SY)', valid.replace('OICI;', 'OICIIO;'), valid + '(D;;FA;;;WD)']) {
    assert.throws(() => validatePrivateSddl(sddl, sid, { protectedAcl: true }))
  }
})
test('ancestor replacement rights are rejected even when a child is private', () => {
  const base = 'O:SYG:SYD:AI(A;;FA;;;SY)(A;;FRFX;;;BU)'
  assert.doesNotThrow(() => validateAncestorSddl(base, sid))
  for (const rights of ['FA', 'SD', 'WD', 'WO', '0x1301bf', '0x40', '0x40000', '0x80000', '0x10000']) {
    assert.throws(() => validateAncestorSddl(base + `(A;;${rights};;;S-1-5-21-4-5-6-1005)`, sid), /replaceable/)
  }
  for (const rights of ['0x2', '0x4', '0x1200af', 'FRFXRC']) {
    assert.doesNotThrow(() => validateAncestorSddl(base + `(A;;${rights};;;BU)`, sid))
  }
  assert.doesNotThrow(() => validateAncestorSddl(base + '(A;IO;FA;;;BU)', sid))
  for (const rights of ['FW', '0x100', '0x10']) {
    assert.throws(() => validateAncestorSddl(base + `(A;;${rights};;;BU)`, sid), /attribute writes/)
  }
  assert.throws(() => validateAncestorSddl(base + '(A;;0x40000000;;;BU)', sid), /Unsupported/)
  assert.throws(() => validateAncestorSddl(base.replace('O:SY', 'O:S-1-5-21-4-5-6-1005'), sid), /owner/)
})
test('standard Windows volume root permits child creation, not foreign replacement', () => {
  const trustedInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
  // Read-only observed native C:\ SDDL; LC is bit 0x4 (create a subdirectory
  // on filesystem directories), while IO grants do not apply to this root.
  const root = `O:${trustedInstaller}G:${trustedInstaller}D:(A;;LC;;;AU)(A;OICIIO;SDGXGWGR;;;AU)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)(A;;0x1200a9;;;AC)`
  assert.doesNotThrow(() => validateAncestorSddl(root, sid))
  assert.throws(() => validateAncestorSddl(root + '(A;;SD;;;AU)', sid), /replaceable/)
  assert.throws(() => validateAncestorSddl(root.replaceAll(trustedInstaller, 'S-1-5-80-1-2-3-4-5'), sid), /owner/)
  assert.throws(() => validatePrivateSddl(`O:${trustedInstaller}G:SYD:P(A;;FA;;;${sid})`, sid, { protectedAcl: true }), /owner/)
})
test('worker identity binds exact executable and worker argv, not substrings', () => {
  const pins = { executable: 'C:\\Program Files\\QwenWorkCN.exe', worker: 'C:\\Program Files\\sdk\\worker.mjs' }
  const commandLine = `"${pins.executable}" "${pins.worker}" --sdk`
  const snapshot = { executable: pins.executable, commandLine }
  assert.deepEqual(windowsCommandArgs(commandLine), [pins.executable, pins.worker, '--sdk'])
  assert.deepEqual(windowsCommandArgs('a\\ b'), ['a\\', 'b'])
  assert.deepEqual(windowsCommandArgs('"a""b"'), ['a"b'])
  assert.equal(matchesWindowsWorker(snapshot, pins), true)
  for (const command of [commandLine + ' --extra', commandLine.replace('--sdk', '--sdk-fake'), commandLine.replace('worker.mjs', 'other.mjs'), '"node.exe" "'+pins.worker+'" --sdk']) {
    assert.equal(matchesWindowsWorker({ ...snapshot, commandLine: command }, pins), false)
  }
  assert.throws(() => windowsCommandArgs('"unfinished'))
  assert.throws(() => matchesWindowsWorker(snapshot, { ...pins, worker: 'relative.mjs' }))
})
test('native inspection rejects invalid PIDs without invoking tools', async () => {
  for (const pid of [0, -1, 1.1, '123', NaN]) await assert.rejects(windowsProcess(pid), /Invalid native PID/)
})

// The helper transports only bounded PID data. Every request gets fresh facts;
// it never acts as a cached identity or a substitute for byte verification.
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createWindowsProcessInspector, withWindowsInspection, windowsSecurityFacts } from '../src/windows-native-platform.mjs'
function inspectorFixture(options = {}) {
  const child = new EventEmitter()
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false,
    kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); return true } })
  const requests = []; let command
  child.stdin.on('data', chunk => requests.push(String(chunk).trim()))
  const inspector = createWindowsProcessInspector({ timeoutMs: 1000, ...options, launch: (...args) => { command = args; return child } })
  const reply = (request, overrides = {}) => {
    const [sequence, pid] = request.split(':')
    child.stdout.write(request + '\r\n')
    child.stdout.write('YUGOO_PROCESS:' + JSON.stringify({ sequence, value: { ProcessId: Number(pid), ParentProcessId: 1,
      StartTicks: '639273592584400770', ExecutablePath: 'C:\\Qwen.exe', CommandLine: '"C:\\Qwen.exe"', ...overrides } }) + '\r\n')
  }
  return { child, requests, inspector, reply, command: () => command }
}
test('owned inspector serializes fresh correlated requests and closes its process', async () => {
  const f = inspectorFixture()
  try {
    const first = f.inspector.snapshot(42), second = f.inspector.snapshot(43)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(f.requests, ['1:42'])
    f.reply('1:42'); assert.equal((await first).pid, 42)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(f.requests, ['1:42', '2:43'])
    f.reply('2:43', { StartTicks: '639273592584400771' }); assert.equal((await second).procStart, '639273592584400771')
    assert.equal(f.command()[1].includes('-NonInteractive'), false)
    const script = Buffer.from(f.command()[1].at(-1), 'base64').toString('utf16le')
    assert.doesNotMatch(script, /Invoke-Expression|\[Console\]/)
    for (const pid of ['42; Write-Output bad', 0, 1.5, 1000000000]) await assert.rejects(f.inspector.snapshot(pid), /Invalid native PID/)
    assert.equal(f.requests.length, 2)
  } finally { f.inspector.close() }
  assert.equal(f.child.killed, true)
  await assert.rejects(f.inspector.snapshot(42), /closed/)
})
test('inspector timeout, exit, malformed identity and out-of-order responses fail closed', async () => {
  for (const failure of ['timeout', 'exit', 'identity', 'sequence', 'oversized']) {
    const f = inspectorFixture({ timeoutMs: 20 })
    const first = f.inspector.snapshot(42), second = f.inspector.snapshot(43)
    const checked = Promise.all([assert.rejects(first), assert.rejects(second)])
    await new Promise(resolve => setImmediate(resolve))
    if (failure === 'exit') f.child.emit('exit', 1)
    if (failure === 'identity') f.reply('1:42', { ProcessId: 100 })
    if (failure === 'sequence') f.child.stdout.write('YUGOO_PROCESS:{"sequence":"2","value":{}}\n')
    if (failure === 'oversized') f.child.stdout.write('x'.repeat(262145))
    await checked
    assert.equal(f.requests.length, 1, failure)
    assert.equal(f.child.killed, true, failure)
    await assert.rejects(f.inspector.snapshot(42))
  }
})
test('complete oversized frames fail before resolution, including split chunks', async () => {
  for (const split of [false, true]) {
    const f = inspectorFixture()
    const first = f.inspector.snapshot(42), second = f.inspector.snapshot(43)
    const checked = Promise.all([assert.rejects(first, /exceeds limit/), assert.rejects(second, /exceeds limit/)])
    await new Promise(resolve => setImmediate(resolve))
    const frame = 'YUGOO_PROCESS:' + JSON.stringify({ sequence: '1', value: {
      ProcessId: 42, ParentProcessId: 1, StartTicks: '639273592584400770',
      ExecutablePath: 'C:\\Qwen.exe', CommandLine: 'Qwen.exe', padding: 'x'.repeat(262144),
    } }) + '\n'
    if (split) { f.child.stdout.write(frame.slice(0, 131072)); f.child.stdout.write(frame.slice(131072)) }
    else f.child.stdout.write(frame)
    await checked
    assert.equal(f.child.killed, true)
    assert.equal(f.requests.length, 1)
  }
})
test('security inspection treats paths as data and rejects mismatched or missing facts', async () => {
  const paths = ["C:\\设计\\Jeff's $(Get-Process).json", 'C:\\']
  for (const invalid of [false, 'path', 'missing']) {
    const f = inspectorFixture()
    try {
      const result = f.inspector.security(paths)
      const checked = invalid ? assert.rejects(result, /Incomplete/) : result
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(JSON.parse(f.requests[0].split(':security:')[1]), paths)
      assert.match(f.requests[0], /\\u8bbe/)
      const value = paths.map(path => ({ path, attributes: '16', sddl: 'O:SYD:(A;;FA;;;SY)' }))
      if (invalid === 'path') value[0].path = 'C:\\other'
      if (invalid === 'missing') value.pop()
      f.child.stdout.write(f.requests[0] + '\r\n')
      f.child.stdout.write('YUGOO_PROCESS:' + JSON.stringify({ sequence: '1', value }) + '\n')
      if (invalid) await checked
      else assert.deepEqual(await checked, value.flatMap(fact => [fact.attributes, fact.sddl]))
    } finally { f.inspector.close() }
  }
  const f = inspectorFixture()
  try {
    for (const paths of [[], ['relative'], ['C:relative'], ['\\relative'], ['C:\\bad\npath'], Array(65).fill('C:\\')]) await assert.rejects(f.inspector.security(paths), /Invalid/)
    assert.equal(f.requests.length, 0)
  } finally { f.inspector.close() }
})
test('inspection scopes are lazy, nested, independent and dispose on rejection', async () => {
  const instances = [], createInspector = () => {
    const instance = { calls: [], closed: false,
      snapshot: async pid => { instance.calls.push(pid); return { pid, sequence: instance.calls.length } },
      security: async paths => { instance.calls.push(paths); return ['16', 'sddl'] },
      close: () => { instance.closed = true },
    }; instances.push(instance); return instance
  }
  await withWindowsInspection(async () => {}, { createInspector })
  assert.equal(instances.length, 0)
  await withWindowsInspection(async () => {
    assert.equal((await windowsProcess(42)).sequence, 1)
    await withWindowsInspection(async () => assert.equal((await windowsProcess(42)).sequence, 2))
    await windowsSecurityFacts(['C:\\target'])
    assert.equal(instances[0].closed, false)
  }, { createInspector })
  assert.deepEqual(instances[0].calls, [42, 42, ['C:\\target']])
  assert.equal(instances[0].closed, true)
  await assert.rejects(withWindowsInspection(async () => { await windowsProcess(43); throw Error('stop') }, { createInspector }), /stop/)
  assert.equal(instances.length, 2)
  assert.equal(instances[1].closed, true)
  let late
  await withWindowsInspection(async () => {
    late = new Promise(resolve => setImmediate(() => resolve(assert.rejects(windowsProcess(44), /scope has ended/))))
  }, { createInspector })
  await late
  assert.equal(instances.length, 2)
})
