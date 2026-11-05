import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWebAppContent } from '../build.mjs'
import { checkEmitted } from '../../../scripts/emitted-loader-check.mjs'

const here = fileURLToPath(new URL('..', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function paths(root, prefix = '') {
  const result = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    assert.ok(!entry.isSymbolicLink())
    if (entry.isDirectory()) result.push(...await paths(root, path))
    else result.push(path)
  }
  return result.sort()
}

test('actual npm content inventory relocates the whole Flow Bundle without dependencies and retains source/resources/materials', { timeout: 60000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'web-app-portable-pack-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  // This is the same package-owned build used by normal npm and Companion.
  const stage = join(root, 'stage'); await mkdir(stage)
  await buildWebAppContent(join(stage, 'lib'))
  for (const name of ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await cp(join(here, name), join(stage, name))
  const pack = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: stage, encoding: 'utf8', timeout: 15000 })
  assert.equal(pack.status, 0, pack.stderr)
  const packed = JSON.parse(pack.stdout)[0], members = packed.files.map(item => item.path)
  assert.ok(members.includes('lib/kits/web_app/kit.yaml'))
  assert.ok(members.includes('lib/bundles/flow_design/SKILL.md'))
  assert.ok(!members.some(path => /^(?:kits|bundles|test|scripts)\//u.test(path) || path.includes('node_modules') || path === 'build.mjs'))
  const extracted = join(root, 'extracted'); await mkdir(extracted)
  const unpack = spawnSync('tar', ['-xzf', join(root, packed.filename), '-C', extracted], { encoding: 'utf8' })
  assert.equal(unpack.status, 0, unpack.stderr)
  const packageRoot = join(extracted, 'package'), manifest = JSON.parse(await readFile(join(packageRoot, 'package.json')))
  assert.deepEqual(manifest.designSystem.kit, { root: './lib/kits/web_app', mindset: './lib/kits/web_app/mindset.md', manifest: './lib/kits/web_app/kit.yaml', bundles: './lib/bundles' })
  const compiled = new Set(['flow_design/scripts/layout.mjs', 'flow_design/scripts/layout-metrics.mjs', 'flow_design/scripts/layout-search.mjs'])
  for (const prefix of ['kits', 'bundles']) for (const path of await paths(join(here, prefix))) {
    if (prefix === 'bundles' && compiled.has(path)) continue
    assert.deepEqual(await readFile(join(packageRoot, 'lib', prefix, path)), await readFile(join(here, prefix, path)), `source resource changed: ${prefix}/${path}`)
  }
  const bundle = join(root, 'project/design_kit/bundles/flow_design')
  await cp(join(packageRoot, 'lib/bundles/flow_design'), bundle, { recursive: true })
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) assert.deepEqual(await readFile(join(bundle, name)), await readFile(join(here, name)))
  for (let cursor = bundle;; cursor = dirname(cursor)) {
    await assert.rejects(readFile(join(cursor, 'node_modules/package.json')), { code: 'ENOENT' })
    assert.ok(!(await readdir(cursor)).includes('node_modules'), `unexpected dependency ancestor: ${cursor}`)
    if (cursor === dirname(cursor)) break
  }
  const scripts = join(bundle, 'scripts'), env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }
  const run = (name, args = [], input) => spawnSync(process.execPath, [join(scripts, name + '.mjs'), ...args], { cwd: scripts, env, input, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 })
  const roles = [{ id: 'Buyer', name: 'Buyer' }, { id: 'System', name: 'System' }]
  const processRecord = { process_id: 'P-001', title: 'Submit order', description: 'Buyer submits; system stores.', tier: 'core', process_type: 'linear', stakeholders: ['Buyer', 'System'], system_responsibilities: ['Store order'], trigger_hints: [], key_features: [], business_rules: [], exception_handling: [], deleted: false, bpmn_file: 'flow_design/P-001.bpmn' }
  const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://yugoo.test/flow"><bpmn:process id="Process_P-001" isExecutable="false"><bpmn:laneSet id="LaneSet_P-001_1"><bpmn:lane id="Lane_P-001_Buyer" name="Buyer"><bpmn:flowNodeRef>StartEvent_P-001_1</bpmn:flowNodeRef><bpmn:flowNodeRef>UserTask_P-001_1</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="Lane_P-001_System" name="System"><bpmn:flowNodeRef>ServiceTask_P-001_1</bpmn:flowNodeRef><bpmn:flowNodeRef>EndEvent_P-001_1</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:startEvent id="StartEvent_P-001_1"/><bpmn:userTask id="UserTask_P-001_1" name="Submit order"/><bpmn:serviceTask id="ServiceTask_P-001_1" name="Store order"/><bpmn:endEvent id="EndEvent_P-001_1"/><bpmn:sequenceFlow id="SequenceFlow_P-001_1" sourceRef="StartEvent_P-001_1" targetRef="UserTask_P-001_1"/><bpmn:sequenceFlow id="SequenceFlow_P-001_2" sourceRef="UserTask_P-001_1" targetRef="ServiceTask_P-001_1"/><bpmn:sequenceFlow id="SequenceFlow_P-001_3" sourceRef="ServiceTask_P-001_1" targetRef="EndEvent_P-001_1"/></bpmn:process></bpmn:definitions>`
  const context = JSON.stringify({ process_id: 'P-001', process: processRecord, roles }) + '\n'
  const structure = run('bpmn-validator', ['validate-bpmn-file'], context + xml)
  assert.equal(structure.status, 0, structure.stdout + structure.stderr)
  assert.equal(JSON.parse(structure.stdout).valid, true)
  const layout = run('layout', [], xml)
  assert.equal(layout.status, 0, layout.stderr); assert.match(layout.stdout, /BPMNShape/)
  const validation = run('layout', ['--validate'], layout.stdout)
  assert.equal(validation.status, 0, validation.stderr)
  const final = run('bpmn-validator', ['validate-final-bpmn-file'], context + layout.stdout)
  assert.equal(final.status, 0, final.stdout + final.stderr); assert.equal(JSON.parse(final.stdout).valid, true)
  const input = join(root, 'laid-out.bpmn'); await writeFile(input, layout.stdout)
  const metrics = run('layout-metrics', ['--json', input]); assert.equal(metrics.status, 0, metrics.stderr); assert.ok(JSON.parse(metrics.stdout).length)
  const output = join(root, 'searched.bpmn'), search = run('layout-search', [input, output, '--passes', '1'])
  assert.equal(search.status, 0, search.stderr); assert.match(await readFile(output, 'utf8'), /BPMNShape/)
  const invalid = run('layout', ['--validate'], '<invalid')
  assert.equal(invalid.status, 2); assert.equal(invalid.stdout, '')
  const index = JSON.parse(await readFile(join(bundle, 'licenses/flow-build.json')))
  assert.deepEqual(index.components.map(item => item.name), ['bpmn-moddle', 'elkjs', 'min-dash', 'moddle', 'moddle-xml', 'saxen'])
  for (const component of [...index.components, index.generatedRuntime]) for (const material of component.materials) assert.equal(sha(await readFile(join(bundle, material.path))), material.sha256)
  for (const [path, hash] of Object.entries(index.outputs)) assert.equal(sha(await readFile(join(bundle, path))), hash)
  assert.equal(index.completeBundledInventoryVerified, false); assert.equal(index.releaseLicenseAcceptance, false)
  const standalone = join(root, 'standalone'); await mkdir(standalone)
  for (const name of ['layout', 'layout-metrics', 'layout-search']) await cp(join(scripts, name + '.mjs'), join(standalone, name + '.mjs'))
  await checkEmitted(standalone, new Set())
  await rm(join(standalone, 'layout-metrics.mjs'))
  await assert.rejects(checkEmitted(standalone, new Set()), 'search requires the metrics sibling')
})
