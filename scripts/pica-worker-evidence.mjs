import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { analyzeEmittedLoaders } from './emitted-loader-check.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
// Reviewed retained bytes; NEVER derive allowed pins from the candidate itself.
export const PICA_WORKER_PINS = Object.freeze({
  rule: 'pica-7.1.1-webworkify-1.5.0-worker-v1',
  artifact: 'c79c7f30b9c2b043072d5b975caf1dbe27007204fe72480ce4a9dbe5c27bdbce',
  runtime: '43716186c8575b2ba466c74735300a1a0295debbc765bbd16c5ac72c944ed56f',
  dispatcher: '2f048e03f460633fdcf8b4dbc67f84d3c79706245907e572455fc6a7accde4e8',
  factory: 'bd2642fec50f93ec2fa8c2ab04d9597bce5586dc14d1017191d03053c42916af',
  table: 'd9a415d97984ede1d158caad12b9ebe2489a4f641b7fee0513451f8010cd9521',
  internalLoads: '69671d1042239bf1c83a517ffceee57dcb1e1ed62006f436c9334f4eed205464',
  sourcePica: '236fb295eb3089e7a95daf40ec8ea5512411591b7a71bd571bc90bcc4c0dcc5a',
  sourceWebworkify: 'a8ee6b014af66ec1d6f98fce744b2c8bb9aa680fe23f026b940d66a0610688e5',
})
const digestPattern = /^[a-f0-9]{64}$/u
function digest(value) { assert.match(value ?? '', digestPattern, 'Expected explicit SHA-256'); return value }
function children(node) { return Object.values(node).flatMap(v => Array.isArray(v) ? v.filter(x => x?.type) : v?.type ? [v] : []) }
export function classifyPicaWorker(code) {
  assert.equal(sha256(code), PICA_WORKER_PINS.artifact, 'Unreviewed pica artifact bytes')
  const parsed = parseSync('pica.js', code); assert.equal(parsed.errors.length, 0)
  const candidates = []
  function walk(node) {
    if (node.type === 'CallExpression' && node.arguments[0]?.type === 'ObjectExpression' && node.arguments[0].properties.length === 25 && node.callee.type === 'CallExpression') candidates.push(node)
    children(node).forEach(walk)
  }
  walk(parsed.program); assert.equal(candidates.length, 1)
  const call = candidates[0], table = call.arguments[0], dispatcher = call.callee.callee
  const factory = table.properties.find(p => p.key.value === 24)?.value.elements[0]
  assert.ok(factory)
  const slices = {}
  for (const [name, node] of Object.entries({ dispatcher, factory, table })) {
    const bytes = code.slice(node.start, node.end)
    assert.equal(sha256(bytes), PICA_WORKER_PINS[name], `Changed ${name} bytes`)
    slices[name] = { start: node.start, end: node.end, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) }
  }
  const result = analyzeEmittedLoaders(code)
  assert.equal(result.browserify.length, 1)
  assert.deepEqual(result.browserify[0].modules, [...Array.from({ length: 24 }, (_, i) => String(i + 1)), '/index.js'])
  assert.equal(result.browserify[0].entry, '/index.js')
  assert.equal(result.internalLoads.length, 29)
  assert.equal(sha256(JSON.stringify(result.internalLoads)), PICA_WORKER_PINS.internalLoads)
  assert.deepEqual(result.loads, [{ kind: 'esm', source: './rolldown-runtime-CEgmsyvS.js' }])
  assert.deepEqual(result.unverified, [42911, 42943, 42973].map(start => ({ start, reason: 'Browserify factory extra dispatcher arguments may escape' })))
  const support = []
  function findSupport(node) { if (node.type === 'FunctionDeclaration' && node.id?.name === 'workerPayload') support.push(node); children(node).forEach(findSupport) }
  findSupport(parsed.program); assert.equal(support.length, 1)
  const offscreenSupportScriptSha256 = sha256('(' + code.slice(support[0].start, support[0].end) + ')(self);')
  return { rule: PICA_WORKER_PINS.rule, status: 'runtime-evidence-required', slices, offscreenSupportScriptSha256,
    staticUnknown: result.unverified, dynamicClosureVerified: false, boundedWorkerTaskVerified: false }
}

// Canonical sorted full inventory: no symlinks or special files, including ancestors.
export async function regularFile(root, name) {
  assert.equal(await realpath(root), resolve(root), 'Root follows a symlink')
  assert.ok((await lstat(root)).isDirectory())
  const target = resolve(root, name), rel = relative(root, target)
  assert.ok(rel && rel !== '..' && !rel.startsWith('../'), 'File escapes evidence root')
  let current = resolve(root)
  for (const part of rel.split('/')) { current = join(current, part); assert.ok(!(await lstat(current)).isSymbolicLink(), 'Symlink rejected') }
  assert.ok((await lstat(target)).isFile(), 'Expected regular file')
  return readFile(target)
}
export async function artifactInventory(root) {
  assert.equal(await realpath(root), resolve(root), 'Inventory root follows a symlink')
  const result = {}
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), info = await lstat(path)
      assert.ok(!info.isSymbolicLink(), 'Inventory symlink rejected')
      if (info.isDirectory()) await walk(path)
      else { assert.ok(info.isFile(), 'Inventory special file rejected'); result[relative(root, path)] = { bytes: info.size, sha256: sha256(await readFile(path)) } }
    }
  }
  await walk(root); return result
}
export const inventorySha256 = inventory => sha256(JSON.stringify(inventory))

export async function verifyPicaSourceInputs({ picaDirectory, webworkifyDirectory }) {
  const pica = JSON.parse(await regularFile(picaDirectory, 'package.json'))
  const webworkify = JSON.parse(await regularFile(webworkifyDirectory, 'package.json'))
  assert.equal(pica.name, 'pica'); assert.equal(pica.version, '7.1.1'); assert.equal(pica.dependencies.webworkify, '^1.5.0')
  assert.equal(webworkify.name, 'webworkify'); assert.equal(webworkify.version, '1.5.0')
  assert.equal(sha256(await regularFile(picaDirectory, 'dist/pica.js')), PICA_WORKER_PINS.sourcePica)
  assert.equal(sha256(await regularFile(webworkifyDirectory, 'index.js')), PICA_WORKER_PINS.sourceWebworkify)
  return { pica: '7.1.1', webworkify: '1.5.0', picaSha256: PICA_WORKER_PINS.sourcePica, webworkifySha256: PICA_WORKER_PINS.sourceWebworkify }
}

// Local evidence association, not an independent attestation. No browser launched.
export async function validatePicaWorkerEvidence({ candidateDirectory, candidateInventorySha256,
  evidenceDirectory, reportSha256, runnerSha256, sourceInputs, versions }) {
  digest(candidateInventorySha256); digest(reportSha256); digest(runnerSha256)
  const candidate = resolve(candidateDirectory), evidence = resolve(evidenceDirectory)
  const within = relative(candidate, evidence)
  assert.ok(within === '..' || within.startsWith('../'), 'Evidence must be outside candidate')
  const inventory = await artifactInventory(candidate)
  assert.equal(inventorySha256(inventory), candidateInventorySha256, 'Candidate inventory drift')
  const runnerPath = new URL('./probe-companion-pica-worker.mjs', import.meta.url)
  assert.equal(sha256(await readFile(runnerPath)), runnerSha256, 'Runner drift')
  const bytes = await regularFile(evidence, 'report.json')
  assert.equal(sha256(bytes), reportSha256, 'Report drift')
  const report = JSON.parse(bytes)
  assert.ok(!report.fixtureOnly, 'Synthetic fixture is not candidate evidence')
  assert.equal(report.kind, 'candidate-relocated-pica-worker-probe', 'Retained diagnostic cannot certify candidate')
  assert.equal(report.candidateDirectory, candidate)
  assert.equal(report.candidateInventorySha256, candidateInventorySha256)
  assert.deepEqual(report.candidateInputs, inventory)
  assert.equal(report.runnerSha256, runnerSha256)
  assert.equal(report.status, 'PASS'); assert.equal(report.browserExecuted, true)
  assert.equal(report.dynamicClosureVerified, false)
  assert.equal(report.root, evidence)
  assert.equal(report.source, join(candidate, 'payload/shared/web'))
  assert.equal(report.inputsUnchanged, true); assert.equal(report.copyUnchanged, true); assert.equal(report.candidateUnchanged, true)
  assert.deepEqual(report.cleanup, { httpListening: false, browserConnected: false, browserPidAlive: false })
  assert.deepEqual(report.networkAuditControl, { status: 'PASS', fetchBlocked: true, importBlocked: true })
  assert.deepEqual(report.errors, [])
  for (const key of ['browserVersion', 'playwrightVersion', 'nodeVersion']) {
    assert.ok(typeof versions?.[key] === 'string' && versions[key].length, 'Explicit approved runtime versions required')
    assert.equal(report[key], versions[key], 'Runtime version drift')
  }
  await verifyPicaSourceInputs(sourceInputs)
  const webRoot = join(candidate, 'payload/shared/web'), copyRoot = join(evidence, 'web')
  const webInputs = await artifactInventory(webRoot)
  assert.deepEqual(report.inputs, webInputs); assert.deepEqual(await artifactInventory(copyRoot), webInputs)
  const picaFile = report.picaFile
  assert.ok(typeof picaFile === 'string' && !picaFile.includes('/') && picaFile.endsWith('.js'))
  const classification = classifyPicaWorker((await regularFile(webRoot, picaFile)).toString('utf8'))
  assert.equal(report.offscreenSupportScriptSha256, classification.offscreenSupportScriptSha256)
  assert.equal(sha256(await regularFile(webRoot, 'rolldown-runtime-CEgmsyvS.js')), PICA_WORKER_PINS.runtime)
  const origin = new URL(report.origin)
  assert.equal(origin.hostname, '127.0.0.1'); assert.equal(origin.protocol, 'http:'); assert.ok(origin.port && !['18421', '9222'].includes(origin.port))
  const labels = ['js-worker', 'default-worker']
  assert.deepEqual(report.cases.map(c => c.label), labels)
  const expectedSamples = [[220,30,40,255],[20,180,60,255],[30,50,210,255],[230,200,20,255]]
  for (const c of report.cases) {
    assert.equal(c.status, 'PASS'); assert.equal(c.features.ww, true); assert.equal(c.features.js, true)
    assert.equal(c.features.wasm, c.label === 'default-worker')
    assert.equal(c.width, 64); assert.equal(c.height, 32)
    assert.deepEqual(c.samples, expectedSamples)
    assert.equal(c.pixelSha256, 'b55f7c8394931baf77db23b5ab2cd0b220ebf967c94fac44de3a689a46411184')
    const tasks = c.workers.filter(w => w.posts.some(p => p.tile))
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].posts.filter(p => p.tile).length, 28)
    assert.equal(tasks[0].messages.filter(m => m.dataLength > 0 || m.bitmap).length, 28)
    for (const w of c.workers) {
      assert.equal(w.terminated, true); assert.deepEqual(w.errors, [])
      assert.ok(w.messages.every(m => m.error == null || m.error === ''), 'Worker message reports an error')
      if (w.urlKind === 'owned-blob') {
        assert.ok(w.url.startsWith('blob:' + report.origin + '/'))
        assert.equal(report.blobs.filter(b => b.url === w.url && b.phase === c.label).length, 1)
      } else {
        assert.equal(w.urlKind, 'verified-offscreen-support'); assert.equal(w.posts.length, 0)
        assert.ok(w.messages.some(m => typeof m.support === 'boolean'))
        const prefix = 'data:text/javascript;base64,'; assert.ok(w.url.startsWith(prefix))
        const support = Buffer.from(w.url.slice(prefix.length), 'base64')
        assert.equal(sha256(support), report.offscreenSupportScriptSha256)
        assert.equal(w.scriptSha256, report.offscreenSupportScriptSha256)
        assert.deepEqual(await regularFile(evidence, c.label + '-offscreen-support.js'), support)
      }
    }
  }
  assert.equal(report.blobs.length, 4)
  assert.equal(new Set(report.blobs.map(b => b.file)).size, 4)
  for (const b of report.blobs) {
    assert.ok(labels.includes(b.phase)); assert.equal(b.revoked, true); assert.equal(b.sourceRewritten, false)
    assert.ok([b.phase + '-worker-0.js', b.phase + '-worker-1.js'].includes(b.file), 'Unknown Blob evidence filename')
    assert.equal(b.importScriptsMentions, false); assert.equal(b.urlLoadingMentions, false)
    const code = await regularFile(evidence, b.file)
    assert.equal(code.length, b.bytes); assert.equal(sha256(code), b.sha256)
    assert.ok(!/\b(?:importScripts\s*\(|fetch|XMLHttpRequest)\b/u.test(code.toString('utf8')))
  }
  assert.equal(report.blocked.length, 2)
  for (const suffix of ['fetch', 'import']) {
    const url = `https://example.invalid/pica-worker-${suffix}-control`
    assert.ok(report.blocked.some(r => r.phase === 'network-control' && r.url === url))
    assert.ok(report.requests.some(r => r.phase === 'network-control' && r.url === url))
  }
  for (const r of report.requests) {
    if (r.phase === 'network-control' && report.blocked.some(b => b.url === r.url)) continue
    const url = new URL(r.url); assert.equal(url.origin, report.origin)
    assert.ok(['/probe.html', '/web/' + picaFile, '/web/rolldown-runtime-CEgmsyvS.js'].includes(url.pathname))
  }
  assert.ok(report.requests.length > 0 && report.serverRequests.length > 0)
  for (const phase of labels) for (const file of [picaFile, 'rolldown-runtime-CEgmsyvS.js']) {
    assert.ok(report.requests.some(r => r.phase === phase && r.url === report.origin + '/web/' + file), 'Missing task module request')
  }
  assert.ok(report.serverRequests.every(r => r.status === 200 && ['GET', 'HEAD'].includes(r.method) && ['/probe.html', '/web/' + picaFile, '/web/rolldown-runtime-CEgmsyvS.js'].includes(r.path)))
  assert.equal(inventorySha256(await artifactInventory(candidate)), candidateInventorySha256)
  // A matching retained report is not an independently observed execution.
  // Synthetic reports can exercise every association above; keep acceptance
  // with the separate observed-terminal and scoped review gate.
  return { ...classification, status: 'runtime-evidence-associations-verified',
    evidenceAssociationsVerified: true, browserExecutionVerified: false,
    boundedWorkerTaskVerified: false, candidateAccepted: false,
    candidateInventorySha256, reportSha256, runnerSha256, publicationReady: false }
}
