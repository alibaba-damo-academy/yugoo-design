import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { artifactInventory, classifyPicaWorker, inventorySha256, PICA_WORKER_PINS,
  sha256, validatePicaWorkerEvidence, verifyPicaSourceInputs } from './pica-worker-evidence.mjs'

const fixture = fileURLToPath(new URL('./test-fixtures/pica-worker/', import.meta.url))
const runner = fileURLToPath(new URL('./probe-companion-pica-worker.mjs', import.meta.url))
const sourceInputs = { picaDirectory: join(fixture, 'source/pica'), webworkifyDirectory: join(fixture, 'source/webworkify') }
const versions = { browserVersion: '149.0.7827.55', playwrightVersion: '1.61.1', nodeVersion: '22.22.3' }
test('fixed upstream pica input is trackable without admitting other generated dist files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pica-fixture-ignore-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(new URL('../.gitignore', import.meta.url), join(root, '.gitignore'))
  const init = spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf8' })
  assert.equal(init.status, 0, init.stderr)
  const input = 'scripts/test-fixtures/pica-worker/source/pica/dist/pica.js'
  const controls = ['dist/output.js', 'packages/panel/dist/output.js',
    'scripts/test-fixtures/pica-worker/source/pica/dist/pica.min.js',
    'scripts/test-fixtures/pica-worker/source/pica/dist/nested/pica.js',
    'scripts/test-fixtures/another/source/pica/dist/pica.js']
  for (const path of [input, ...controls]) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), 'Synthetic ignore-rule fixture\n')
  }
  // check-ignore can report a matching negation rule with exit 0. Inspect
  // Git's actual addable-file inventory instead of treating that exit as exclusion.
  const addable = path => spawnSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '--', path], { encoding: 'utf8' })
  const retained = addable(input)
  assert.equal(retained.status, 0, retained.stderr)
  assert.equal(retained.stdout.trim(), input, 'the exact pinned upstream input must be addable')
  for (const path of controls) {
    const result = addable(path)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '', `${path} must remain ignored`)
  }
})

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'pica-worker-evidence-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const candidateDirectory = join(root, 'candidate'), evidenceDirectory = join(root, 'evidence')
  const web = join(candidateDirectory, 'payload/shared/web')
  await mkdir(web, { recursive: true }); await mkdir(evidenceDirectory)
  for (const name of ['pica-DGw4b28J.js', 'rolldown-runtime-CEgmsyvS.js']) await cp(join(fixture, name), join(web, name))
  await writeFile(join(candidateDirectory, 'package.json'), '{"name":"fixture-only","private":true}\n')
  await cp(web, join(evidenceDirectory, 'web'), { recursive: true })
  const report = JSON.parse(await readFile(join(fixture, 'report-template.json')))
  // Synthetic fixtures only exercise the validator. No new browser result exists.
  delete report.fixtureOnly
  for (const b of report.blobs) await cp(join(fixture, b.file), join(evidenceDirectory, b.file))
  for (const label of ['js-worker', 'default-worker']) await cp(join(fixture, label + '-offscreen-support.js'), join(evidenceDirectory, label + '-offscreen-support.js'))
  const candidateInputs = await artifactInventory(candidateDirectory)
  const options = { candidateDirectory, evidenceDirectory, candidateInventorySha256: inventorySha256(candidateInputs),
    runnerSha256: sha256(await readFile(runner)), sourceInputs, versions }
  Object.assign(report, { kind: 'candidate-relocated-pica-worker-probe', root: evidenceDirectory, candidateDirectory,
    source: web, picaFile: 'pica-DGw4b28J.js', candidateInputs, candidateInventorySha256: options.candidateInventorySha256,
    inputs: await artifactInventory(web), runnerSha256: options.runnerSha256, candidateUnchanged: true, inputsUnchanged: true, copyUnchanged: true })
  async function save() { const bytes = JSON.stringify(report); await writeFile(join(evidenceDirectory, 'report.json'), bytes); options.reportSha256 = sha256(bytes) }
  await save()
  return { root, report, options, save }
}

test('fixed byte slices classify only the reviewed static unknown', async () => {
  const code = await readFile(join(fixture, 'pica-DGw4b28J.js'), 'utf8'), r = classifyPicaWorker(code)
  assert.equal(r.status, 'runtime-evidence-required'); assert.equal(r.staticUnknown.length, 3)
  assert.equal(r.boundedWorkerTaskVerified, false); assert.equal(r.dynamicClosureVerified, false)
  assert.deepEqual(r.slices.factory, { start: 42849, end: 44818, bytes: 1969, sha256: PICA_WORKER_PINS.factory })
  for (const changed of [code + '\n', code.replace('arguments[3]', 'arguments[6]'), code.replace('"./mathlib": 1', '"./mathlib": 2'), code + "\nconst alias = __require; alias('unknown');"]) {
    assert.notEqual(changed, code); assert.throws(() => classifyPicaWorker(changed), /Unreviewed/)
  }
  await verifyPicaSourceInputs(sourceInputs)
})

test('synthetic associations cannot certify browser execution or candidate acceptance', async t => {
  const f = await setup(t), result = await validatePicaWorkerEvidence(f.options)
  assert.equal(result.evidenceAssociationsVerified, true)
  assert.equal(result.browserExecutionVerified, false)
  assert.equal(result.candidateAccepted, false)
  assert.equal(result.boundedWorkerTaskVerified, false); assert.equal(result.dynamicClosureVerified, false)
  assert.equal(result.staticUnknown.length, 3); assert.equal(result.publicationReady, false)
})

test('missing, stale, changed candidate and relocated bytes are rejected', async t => {
  for (const target of ['report', 'candidate', 'copy', 'blob', 'runtime']) {
    const f = await setup(t)
    if (target === 'report') await rm(join(f.options.evidenceDirectory, 'report.json'))
    if (target === 'candidate') await writeFile(join(f.options.candidateDirectory, 'extra'), 'drift')
    if (target === 'copy') await writeFile(join(f.options.evidenceDirectory, 'web/pica-DGw4b28J.js'), 'changed')
    if (target === 'blob') await writeFile(join(f.options.evidenceDirectory, f.report.blobs[0].file), 'changed')
    if (target === 'runtime') { await writeFile(join(f.options.candidateDirectory, 'payload/shared/web/rolldown-runtime-CEgmsyvS.js'), 'changed'); f.options.candidateInventorySha256 = inventorySha256(await artifactInventory(f.options.candidateDirectory)) }
    await assert.rejects(validatePicaWorkerEvidence(f.options))
  }
})

test('fallback, unknown support, network, cleanup and evidence association attacks reject', async t => {
  const mutations = [
    f => { f.report.fixtureOnly = true },
    f => { f.report.kind = 'retained-relocated-pica-worker-probe' },
    f => { f.report.runnerSha256 = '0'.repeat(64) },
    f => { f.options.runnerSha256 = '0'.repeat(64) },
    f => { f.report.candidateDirectory = f.root },
    f => { f.report.cases[0].features.ww = false },
    f => { f.report.cases[0].workers.find(w => w.posts.some(p => p.tile)).messages = [] },
    f => { f.report.cases[0].workers.find(w => w.posts.some(p => p.tile)).messages.find(m => m.dataLength > 0 || m.bitmap).error = 'tile failure with data' },
    f => { f.report.cases[0].workers.find(w => w.posts.some(p => p.tile)).messages.push({ error: 'extra failure message' }) },
    f => { f.report.offscreenSupportScriptSha256 = '0'.repeat(64) },
    f => { f.report.cases[0].workers[0].url = 'data:text/javascript;base64,ZXh0ZXJuYWw=' },
    f => { f.report.requests.push({ phase: 'js-worker', url: 'https://example.invalid/task' }) },
    f => { f.report.networkAuditControl.importBlocked = false },
    f => { f.report.blocked.pop() },
    f => { f.report.requests = f.report.requests.filter(r => r.phase !== 'js-worker') },
    f => { f.report.serverRequests.push({ status: 200, method: 'GET', path: '/unexpected' }) },
    f => { f.report.cleanup.browserPidAlive = true },
    f => { f.report.browserVersion = 'changed' },
    f => { f.report.blobs[0].sourceRewritten = true },
    f => { f.report.blobs[0].file = '../outside.js' },
    f => { f.report.cases[0].samples[0][0] = 0 },
    f => { f.report.copyUnchanged = false },
  ]
  for (const mutate of mutations) { const f = await setup(t); mutate(f); await f.save(); await assert.rejects(validatePicaWorkerEvidence(f.options)) }
})

test('evidence symlinks and altered source inputs fail closed', async t => {
  const f = await setup(t), blob = join(f.options.evidenceDirectory, f.report.blobs[0].file)
  await rm(blob); await symlink(join(fixture, f.report.blobs[0].file), blob)
  await assert.rejects(validatePicaWorkerEvidence(f.options), /Symlink/)
  const source = join(f.root, 'source'); await cp(join(fixture, 'source'), source, { recursive: true })
  await writeFile(join(source, 'webworkify/index.js'), 'changed')
  await assert.rejects(verifyPicaSourceInputs({ picaDirectory: join(source, 'pica'), webworkifyDirectory: join(source, 'webworkify') }))
})

test('runner rejects missing or wrong explicit candidate binding before browser launch', async t => {
  const f = await setup(t)
  for (const args of [[], ['--candidate-dir', f.options.candidateDirectory], ['--candidate-dir', f.options.candidateDirectory, '--candidate-inventory-sha256', '0'.repeat(64), '--pica-file', 'pica-DGw4b28J.js']]) {
    const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8' })
    assert.notEqual(result.status, 0); assert.ok(!result.stdout.includes('PICA PROBE ROOT'))
    assert.match(result.stderr, /Explicit candidate|inventory mismatch/)
  }
})

test('diagnostic inputs are explicit, cannot mix with candidate authority, and reject before browser launch', async t => {
  const f = await setup(t)
  const web = join(f.options.candidateDirectory, 'payload/shared/web')
  const cases = [
    { args: ['--retained-diagnostic'], error: /Unknown probe option/ },
    { args: ['--retained-diagnostic-dir'], error: /Missing probe option value/ },
    { args: ['--retained-diagnostic-dir', web], error: /Explicit diagnostic directory/ },
    { args: ['--retained-diagnostic-dir', web, '--pica-file', 'pica-DGw4b28J.js', '--candidate-dir', f.options.candidateDirectory], error: /cannot mix/ },
    { args: ['--retained-diagnostic-dir', join(f.root, 'missing'), '--pica-file', 'pica-DGw4b28J.js'], error: /ENOENT/ },
    { args: ['--retained-diagnostic-dir', web, '--pica-file', 'absent.js'], error: /Diagnostic pica input is missing/ },
    ...['../pica.js', '..\\pica.js', 'pica.js\n', 'pica\n.js'].map(file => ({ args: ['--retained-diagnostic-dir', web, '--pica-file', file], error: /Expected pica basename/ })),
  ]
  for (const { args, error } of cases) {
    const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.ok(!result.stdout.includes('PICA PROBE ROOT'))
    assert.match(result.stderr, error)
  }
  const source = await readFile(runner, 'utf8')
  assert.doesNotMatch(source, /\/tmp\/dsh-companion-same-source-build-/)
  assert.match(source, /resolve\(options\['--retained-diagnostic-dir'\]\)/)
})


test('refused probe inputs do not initialize evidence/compiler dependencies, while valid preflight reaches the original evidence boundary', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pica-cli-no-heavy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const probe = join(root, 'probe-companion-pica-worker.mjs'), marker = join(root, 'heavy-imported')
  await cp(runner, probe)
  // A sentinel replaces only the dependency in this isolated negative-control
  // tree. Its initialization proves exactly when the real import boundary runs.
  await writeFile(join(root, 'pica-worker-evidence.mjs'), `import {writeFile} from 'node:fs/promises'; export const artifactInventory=()=>{},inventorySha256=()=>{},classifyPicaWorker=()=>{}; await writeFile(${JSON.stringify(marker)},'initialized'); throw Error('HEAVY_EVIDENCE_BOUNDARY_REACHED');`)
  const source = join(root, 'source')
  await mkdir(source); await writeFile(join(source, 'pica.js'), 'fixture-only; not classified or browser executed')
  await symlink(source, join(root, 'source-link'))
  await symlink(join(source, 'pica.js'), join(source, 'file-link.js'))
  await mkdir(join(source, 'directory.js'))
  const diagnostic = ['--retained-diagnostic-dir', source, '--pica-file']
  const cases = [
    { args: ['--retained-diagnostic'], error: /Unknown probe option/ },
    { args: ['--retained-diagnostic-dir'], error: /Missing probe option value/ },
    { args: ['--retained-diagnostic-dir', source], error: /Explicit diagnostic directory/ },
    { args: [...diagnostic, 'pica.js', '--candidate-dir', source], error: /cannot mix/ },
    { args: ['--candidate-dir', source], error: /Explicit candidate directory/ },
    { args: [...diagnostic, '../pica.js'], error: /Expected pica basename/ },
    { args: [...diagnostic, 'pica.js', '--pica-file', 'pica.js'], error: /Duplicate probe option/ },
    { args: ['--retained-diagnostic-dir', join(root, 'missing'), '--pica-file', 'pica.js'], error: /ENOENT/ },
    { args: [...diagnostic, 'absent.js'], error: /Diagnostic pica input is missing/ },
    { args: ['--retained-diagnostic-dir', join(root, 'source-link'), '--pica-file', 'pica.js'], error: /Diagnostic root follows a symlink/ },
    { args: [...diagnostic, 'file-link.js'], error: /Expected regular diagnostic pica input/ },
    { args: [...diagnostic, 'directory.js'], error: /Expected regular diagnostic pica input/ },
  ]
  for (const { args, error } of cases) {
    const result = spawnSync(process.execPath, [probe, ...args], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, error)
    assert.doesNotMatch(result.stderr, /HEAVY_EVIDENCE_BOUNDARY_REACHED/)
    assert.ok(!result.stdout.includes('PICA PROBE ROOT'))
    await assert.rejects(readFile(marker), { code: 'ENOENT' })
  }
  const admitted = spawnSync(process.execPath, [probe, ...diagnostic, 'pica.js'], { encoding: 'utf8', timeout: 10000 })
  assert.equal(admitted.error, undefined)
  assert.notEqual(admitted.status, 0)
  assert.match(admitted.stderr, /HEAVY_EVIDENCE_BOUNDARY_REACHED/)
  assert.equal(await readFile(marker, 'utf8'), 'initialized')
  assert.ok(!admitted.stdout.includes('PICA PROBE ROOT'))
})
