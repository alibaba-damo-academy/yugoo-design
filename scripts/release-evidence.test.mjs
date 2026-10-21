import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseEvidenceDirectory, withReleaseEvidence } from './release-evidence.mjs'

const head = 'abcde12345'.repeat(4)
const success = { status: 0, signal: null, stdout: '', stderr: '' }
function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'release-evidence-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const workspace = join(directory, 'source')
  mkdirSync(workspace)
  const scriptPath = join(workspace, 'gate.mjs')
  writeFileSync(scriptPath, '// fixture, never executed\n')
  const output = join(directory, 'evidence')
  const reports = []
  const runner = (command, args) => {
    if (command === 'git') return { ...success, stdout: args[0] === 'rev-parse' ? `${head}\n` : '' }
    if (command === 'fixture-pnpm' && args[0] === '--version') return { ...success, stdout: '11.7.0\n' }
    throw new Error('Unexpected subprocess request; tests never launch a subprocess.')
  }
  const options = { args: ['--evidence-dir', output], workspace, scriptPath, pnpm: 'fixture-pnpm', runner, report: path => reports.push(path), ...overrides }
  return { directory, workspace, output, reports, options, runner, read: () => JSON.parse(readFileSync(join(output, 'evidence.json'), 'utf8')) }
}
function archive(root) {
  mkdirSync(join(root, 'tarballs'))
  const bytes = Buffer.from('fixture archive bytes')
  writeFileSync(join(root, 'tarballs/package-0.0.0.tgz'), bytes)
  return { path: 'tarballs/package-0.0.0.tgz', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

test('every gate phase/run label is accepted by the evidence lifecycle', async t => {
  const source = readFileSync(new URL('./release-physical-distribution-gate.mjs', import.meta.url), 'utf8')
  const labels = [...source.matchAll(/\b(?:phase|run)\('([^']+)'/gu)].map(match => match[1])
  assert.ok(labels.includes('verify') && labels.includes('install'))
  const f = fixture(t, { args: [] })
  await withReleaseEvidence(f.options, async gate => {
    for (const label of labels) gate.phase(label)
  })
  await assert.rejects(withReleaseEvidence(f.options, async gate => gate.phase('unknown-regression-phase')), /invalid_phase/u)
})

test('default mode cleans its own staging on success and failure without metadata subprocesses', async t => {
  for (const fail of [false, true]) {
    const f = fixture(t, { args: [], runner: () => { throw new Error('must not run') } })
    let root
    const work = withReleaseEvidence(f.options, async ({ temporaryRoot }) => {
      root = temporaryRoot
      assert.ok(existsSync(root))
      assert.equal(existsSync(join(root, 'evidence.json')), false)
      archive(root)
      if (fail) throw new Error('fixture failure')
    })
    if (fail) await assert.rejects(work, /fixture failure/u)
    else await work
    assert.equal(existsSync(root), false)
    assert.equal(existsSync(f.output), false)
    assert.deepEqual(f.reports, [])
  }
})

test('opt-in retains owned staging, complete hashes and full candidate identity', async t => {
  const f = fixture(t)
  let expected
  await withReleaseEvidence({ ...f.options, runner: (command, args) => command === 'fixture-step' ? success : f.runner(command, args) }, async gate => {
    expected = archive(gate.temporaryRoot)
    gate.run('pack', 'fixture-step', [])
    gate.run('install', 'fixture-step', [])
    gate.run('verify', 'fixture-step', [])
  })
  const record = f.read()
  assert.equal(record.status, 'passed')
  assert.equal(record.gate, 'physical-overrides')
  assert.equal(record.publicationStatus, 'local-unreviewed')
  assert.deepEqual(record.candidate, { head, dirty: false })
  assert.equal(record.scriptSha256, createHash('sha256').update(readFileSync(f.options.scriptPath)).digest('hex'))
  assert.equal(record.runtime.pnpm, '11.7.0')
  assert.deepEqual(record.artifacts, [expected])
  assert.equal(record.artifactsStatus, 'complete')
  assert.deepEqual(record.steps.map(step => step.status), ['passed', 'passed', 'passed'])
  assert.match(readFileSync(join(f.output, 'LOCAL-EVIDENCE.txt'), 'utf8'), /Not reviewed for publication/u)
  assert.deepEqual(f.reports, [f.output])
  assert.equal(readdirSync(f.output).some(name => name.endsWith('.tmp')), false)
})

test('nonzero pack/install/verify failures retain diagnostics but no arbitrary process output or arguments', async t => {
  for (const phase of ['pack', 'install', 'verify']) {
    const f = fixture(t)
    const secret = 'fixture-sensitive-value-never-persist'
    let expected
    const runner = (command, args) => command === 'fixture-step' ? { status: 7, stdout: secret, stderr: secret, env: { TOKEN: secret } } : f.runner(command, args)
    await assert.rejects(withReleaseEvidence({ ...f.options, runner }, async gate => {
      expected = archive(gate.temporaryRoot)
      gate.run(phase, 'fixture-step', [secret], { cwd: f.workspace, env: { TOKEN: secret } })
    }), /nonzero_exit/u)
    const record = f.read()
    assert.equal(record.status, 'failed')
    assert.equal(record.phase, phase)
    assert.deepEqual(record.failure, { category: 'nonzero_exit' })
    assert.equal(record.steps[0].exitCode, 7)
    assert.deepEqual(record.artifacts, [expected])
    assert.equal(readFileSync(join(f.output, 'evidence.json'), 'utf8').includes(secret), false)
    assert.equal(readdirSync(f.output).some(name => /stdout|stderr|\.log$/u.test(name)), false)
    assert.deepEqual(f.reports, [f.output])
  }
})

test('spawn exceptions, spawn errors, signals and output limits are categorized safely', async t => {
  const cases = [
    { category: 'spawn_error', thrown: new Error('do not persist this exception') },
    { category: 'spawn_error', result: { status: null, error: { code: 'ENOENT', message: 'do not persist this exception' } } },
    { category: 'signal', result: { status: null, signal: 'SIGTERM' } },
    { category: 'output_buffer_limit', result: { status: null, error: { code: 'ENOBUFS' }, stdout: 'do not persist this exception' } },
  ]
  for (const item of cases) {
    const f = fixture(t)
    const runner = (command, args) => {
      if (command !== 'fixture-step') return f.runner(command, args)
      if (item.thrown) throw item.thrown
      return item.result
    }
    await assert.rejects(withReleaseEvidence({ ...f.options, runner }, async gate => gate.run('pack', 'fixture-step', [])))
    const record = f.read()
    assert.equal(record.status, 'failed')
    assert.equal(record.steps[0].status, 'failed')
    assert.equal(record.failure.category, item.category)
    assert.equal(JSON.stringify(record).includes('do not persist'), false)
  }
})

test('interruption during a command has a persisted running step rather than a pass', async t => {
  const f = fixture(t)
  const runner = (command, args) => {
    if (command !== 'fixture-step') return f.runner(command, args)
    const inFlight = f.read()
    assert.equal(inFlight.status, 'running')
    assert.equal(inFlight.phase, 'install')
    assert.equal(inFlight.steps[0].status, 'running')
    assert.equal(inFlight.endedAt, undefined)
    return { status: null, signal: 'SIGKILL' }
  }
  await assert.rejects(withReleaseEvidence({ ...f.options, runner }, async gate => gate.run('install', 'fixture-step', [])), /signal/u)
  assert.equal(f.read().status, 'failed')
})

test('failed or malformed metadata stays unknown; dirty state and full SHA are explicit', async t => {
  const f = fixture(t, { runner: () => { throw new Error('private exception') } })
  await withReleaseEvidence({ ...f.options, scriptPath: join(f.workspace, 'missing') }, async () => {})
  assert.deepEqual(f.read().candidate, { head: 'unknown', dirty: 'unknown' })
  assert.equal(f.read().runtime.pnpm, 'unknown')
  assert.equal(f.read().scriptSha256, 'unknown')
  const g = fixture(t)
  await withReleaseEvidence({ ...g.options, runner: (command, args) => {
    if (command !== 'git') return { ...success, stdout: 'unexpected version output' }
    return { ...success, stdout: args[0] === 'rev-parse' ? 'f'.repeat(64) : ' M private-filename\0' }
  } }, async () => {})
  assert.deepEqual(g.read().candidate, { head: 'f'.repeat(64), dirty: true })
  assert.equal(g.read().runtime.pnpm, 'unknown')
  assert.equal(JSON.stringify(g.read()).includes('private-filename'), false)
})

test('invalid CLI arguments fail before any staging or process execution', async t => {
  const f = fixture(t)
  for (const args of [['--unknown'], ['--evidence-dir'], ['--evidence-dir', 'relative'], ['--evidence-dir', f.output, '--evidence-dir', f.output], ['--evidence-dir', `${f.output}\n`]]) {
    await assert.rejects(withReleaseEvidence({ ...f.options, args }, async () => assert.fail('must not execute')), /invalid_arguments/u)
    assert.equal(existsSync(f.output), false)
  }
  assert.equal(parseEvidenceDirectory([]), undefined)
})

test('existing directories, files and symlinks are never overwritten or removed', async t => {
  for (const kind of ['directory', 'file', 'symlink', 'dangling-symlink']) {
    const f = fixture(t)
    const sentinel = join(f.directory, 'sentinel')
    writeFileSync(sentinel, 'keep me')
    if (kind === 'directory') { mkdirSync(f.output); writeFileSync(join(f.output, 'keep'), 'keep me') }
    if (kind === 'file') writeFileSync(f.output, 'keep me')
    if (kind === 'symlink') symlinkSync(sentinel, f.output)
    if (kind === 'dangling-symlink') symlinkSync(join(f.directory, 'missing'), f.output)
    await assert.rejects(withReleaseEvidence(f.options, async () => assert.fail('must not execute')), /EEXIST/u)
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep me')
    if (kind === 'directory') assert.equal(readFileSync(join(f.output, 'keep'), 'utf8'), 'keep me')
    if (kind === 'file') assert.equal(readFileSync(f.output, 'utf8'), 'keep me')
    assert.deepEqual(f.reports, [])
  }
})

test('realpath boundary rejects direct and aliased workspace descendants', async t => {
  const f = fixture(t)
  const alias = join(f.directory, 'source-alias')
  symlinkSync(f.workspace, alias, 'dir')
  for (const output of [join(f.workspace, 'evidence'), join(alias, 'evidence'), f.workspace]) {
    await assert.rejects(withReleaseEvidence({ ...f.options, args: ['--evidence-dir', output] }, async () => assert.fail('must not execute')), /workspace_overlap/u)
  }
  assert.equal(existsSync(join(f.workspace, 'evidence')), false)
})

test('artifact symlinks fail closed without collecting external file bytes', async t => {
  const f = fixture(t)
  await assert.rejects(withReleaseEvidence(f.options, async ({ temporaryRoot }) => {
    mkdirSync(join(temporaryRoot, 'tarballs'))
    symlinkSync(f.options.scriptPath, join(temporaryRoot, 'tarballs/escape.tgz'))
  }), /unsafe_artifact/u)
  assert.equal(f.read().status, 'failed')
  assert.equal(f.read().artifactsStatus, 'incomplete')
  assert.deepEqual(f.read().artifacts, [])
})

test('unknown action failure records only a category and evidence write failure cannot pass', async t => {
  const f = fixture(t)
  await assert.rejects(withReleaseEvidence(f.options, async gate => {
    gate.phase('prepare-consumer')
    throw new Error('private error detail')
  }), /private error detail/u)
  assert.deepEqual(f.read().failure, { category: 'unknown_error' })
  assert.equal(JSON.stringify(f.read()).includes('private error detail'), false)
  const g = fixture(t)
  await assert.rejects(withReleaseEvidence(g.options, async ({ temporaryRoot }) => {
    // A directory at the record destination makes atomic replacement fail.
    rmSync(join(temporaryRoot, 'evidence.json'))
    mkdirSync(join(temporaryRoot, 'evidence.json'))
    throw new Error('original action failure')
  }), error => {
    assert.ok(error instanceof AggregateError)
    assert.match(error.errors[0].message, /original action failure/u)
    assert.match(error.errors[1].message, /evidence_write_error/u)
    return true
  })
  assert.equal(existsSync(g.output), true)
  assert.deepEqual(g.reports, [g.output])
})

for (const mode of ['nonzero_exit', 'spawn_error']) {
  test(`${mode} survives a simultaneous evidence write failure without raw diagnostics`, async t => {
    const f = fixture(t)
    const secret = 'fixture-private-process-detail'
    const runner = (command, args) => {
      if (command !== 'fixture-step') return f.runner(command, args)
      rmSync(join(f.output, 'evidence.json'))
      mkdirSync(join(f.output, 'evidence.json'))
      if (mode === 'spawn_error') throw new Error(secret)
      return { status: 7, stdout: secret, stderr: secret }
    }
    const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error]
    await assert.rejects(withReleaseEvidence({ ...f.options, runner }, async gate => gate.run('install', 'fixture-step', [])), error => {
      assert.ok(error instanceof AggregateError)
      const failures = flatten(error)
      assert.equal(failures[0].category, mode)
      assert.ok(failures.some(item => item.category === 'evidence_write_error'))
      assert.ok(failures.every(item => !item.message.includes(secret)))
      return true
    })
    const snapshots = readdirSync(f.output).filter(name => name.endsWith('.tmp')).map(name => JSON.parse(readFileSync(join(f.output, name), 'utf8')))
    assert.ok(snapshots.length >= 2)
    assert.equal(snapshots.at(-1).status, 'failed')
    assert.equal(snapshots.at(-1).failure.category, mode)
    assert.equal(snapshots.at(-1).steps[0].errorCategory, mode)
    assert.equal(JSON.stringify(snapshots).includes(secret), false)
    assert.deepEqual(f.reports, [f.output])
  })
}
