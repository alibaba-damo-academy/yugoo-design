#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const validateScript = new URL('../bundles/flow_design/scripts/bpmn-validator.mjs', import.meta.url)
const layoutScript = new URL('../bundles/flow_design/scripts/layout.mjs', import.meta.url)

function run(script, args, input, options = {}) {
  return spawnSync(process.execPath, [script.pathname, ...args], {
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  })
}

function checkMissingDependencies() {
  const scratch = mkdtempSync(join(tmpdir(), 'flow-dependency-'))
  try {
    // Copy Bundle scripts only, never installed/development node_modules.
    const scripts = join(scratch, 'scripts')
    cpSync(new URL('../bundles/flow_design/scripts/', import.meta.url), scripts, { recursive: true })
    const isolatedScript = pathToFileURL(join(scripts, 'layout.mjs'))
    const assertMissing = (packageName) => {
      const result = run(isolatedScript, [], '')
      assert.equal(result.error, undefined)
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '', 'missing dependencies must not emit fallback BPMN')
      assert.match(result.stderr, /\[flow_design:dependency\]/)
      assert.ok(result.stderr.includes(`Missing package "${packageName}"`), result.stderr)
      assert.match(result.stderr, /Kit package\.json/)
    }
    assertMissing('bpmn-moddle')
    // Synthetic resolution fixtures, not copies of actual dependencies.
    const fixturePackage = (name, file, source) => {
      const root = join(scratch, 'node_modules', name)
      mkdirSync(join(root, 'lib'), { recursive: true })
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name, type: 'module', main: file }))
      writeFileSync(join(root, file), source)
    }
    fixturePackage('bpmn-moddle', 'index.js', 'export default class {}\n')
    assertMissing('elkjs')
    fixturePackage('elkjs', 'lib/elk.bundled.js', 'export default class {}\n')
    fixturePackage('bpmn-moddle', 'index.js', 'import "./missing-transitive.js";\n')
    const internalFailure = run(isolatedScript, [], '')
    assert.equal(internalFailure.error, undefined)
    assert.notEqual(internalFailure.status, 0)
    assert.equal(internalFailure.stdout, '')
    assert.match(internalFailure.stderr, /ERR_MODULE_NOT_FOUND/)
    assert.match(internalFailure.stderr, /missing-transitive\.js/)
    assert.doesNotMatch(internalFailure.stderr, /\[flow_design:dependency\]/)
    fixturePackage('bpmn-moddle', 'index.js', 'throw Error("BPMN_INITIALIZATION_FAILED");\n')
    const initializationFailure = run(isolatedScript, [], '')
    assert.notEqual(initializationFailure.status, 0)
    assert.match(initializationFailure.stderr, /BPMN_INITIALIZATION_FAILED/)
    assert.doesNotMatch(initializationFailure.stderr, /\[flow_design:dependency\]/)
    fixturePackage('bpmn-moddle', 'index.js', 'throw null;\n')
    const nonErrorFailure = run(isolatedScript, [], '')
    assert.notEqual(nonErrorFailure.status, 0)
    assert.match(nonErrorFailure.stderr, /null/)
    assert.doesNotMatch(nonErrorFailure.stderr, /TypeError|\[flow_design:dependency\]/)
    fixturePackage('bpmn-moddle', 'index.js', 'throw Object.assign(Error("Cannot find package \'bpmn-moddle\' imported from /another-entry.mjs"), { code: "ERR_MODULE_NOT_FOUND" });\n')
    const foreignImporterFailure = run(isolatedScript, [], '')
    assert.notEqual(foreignImporterFailure.status, 0)
    assert.match(foreignImporterFailure.stderr, /another-entry\.mjs/)
    assert.doesNotMatch(foreignImporterFailure.stderr, /\[flow_design:dependency\]/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  console.log('Flow direct-dependency diagnostics OK (missing packages and original internal error)')
}

checkMissingDependencies()
if (process.argv.includes('--dependency-diagnostics-only')) process.exit(0)

const processRecord = {
  process_id: 'P-001',
  title: 'Submit order',
  description: 'Buyer submits an order and the system records it.',
  tier: 'core',
  process_type: 'linear',
  stakeholders: ['买家', '系统'],
  system_responsibilities: ['保存订单'],
  trigger_hints: [],
  key_features: [],
  business_rules: [],
  exception_handling: [],
  deleted: false,
  bpmn_file: 'flow_design/P-001.bpmn',
}
const state = {
  skill_name: 'flow_design',
  topic: 'Order',
  epoch: 1,
  roles: [{ id: 'Buyer', name: '买家' }, { id: 'System', name: '系统' }],
  processes: { 'P-001': processRecord },
  process_order: ['P-001'],
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://dsh.local/flow">
  <bpmn:process id="Process_P-001" isExecutable="false">
    <bpmn:laneSet id="LaneSet_P-001_1">
      <bpmn:lane id="Lane_P-001_Buyer" name="买家">
        <bpmn:flowNodeRef>StartEvent_P-001_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>UserTask_P-001_1</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_P-001_System" name="系统">
        <bpmn:flowNodeRef>ServiceTask_P-001_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>EndEvent_P-001_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="StartEvent_P-001_1" />
    <bpmn:userTask id="UserTask_P-001_1" name="提交订单" />
    <bpmn:serviceTask id="ServiceTask_P-001_1" name="保存订单" />
    <bpmn:endEvent id="EndEvent_P-001_1" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_1" sourceRef="StartEvent_P-001_1" targetRef="UserTask_P-001_1" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_2" sourceRef="UserTask_P-001_1" targetRef="ServiceTask_P-001_1" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_3" sourceRef="ServiceTask_P-001_1" targetRef="EndEvent_P-001_1" />
  </bpmn:process>
</bpmn:definitions>`

const fileCandidate = run(validateScript, ['validate-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n${xml}`)
assert.equal(fileCandidate.status, 0, fileCandidate.stdout || fileCandidate.stderr)
assert.deepEqual(JSON.parse(fileCandidate.stdout), { valid: true, diagnostics: [] })

const laidOut = run(layoutScript, [], xml)
assert.equal(laidOut.status, 0, laidOut.stderr)
assert.match(laidOut.stdout, /<bpmndi:BPMNDiagram/)
assert.match(laidOut.stdout, /layoutRevision="13"/)
assert.match(laidOut.stderr, /"preference":"balanced"/)
assert.match(laidOut.stderr, /"channels":/)

const fileFinal = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n${laidOut.stdout}`)
assert.equal(fileFinal.status, 0, fileFinal.stdout || fileFinal.stderr)
assert.deepEqual(JSON.parse(fileFinal.stdout), { valid: true, diagnostics: [] })

// Use the actual normal package builder; source-only success misses relocated
// bare-package resolution guards left behind after imports are bundled.
const packagedScratch = mkdtempSync(join(tmpdir(), 'flow-normal-emitted-'))
try {
  const { packageFlowLayout } = await import('../../companion/build-plugin.mjs')
  const target = join(packagedScratch, 'yugoo-design')
  await packageFlowLayout(target)
  const entry = pathToFileURL(join(target, 'bundles/flow_design/scripts/layout.mjs'))
  const isolated = { cwd: packagedScratch, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } }
  const dependencyProbe = spawnSync(process.execPath, ['--input-type=module', '-e',
    'for (const name of ["bpmn-moddle", "elkjs"]) { try { import.meta.resolve(name); process.exitCode=1; } catch(error) { if(error.code!=="ERR_MODULE_NOT_FOUND") throw error; } }'],
    { ...isolated, encoding: 'utf8' })
  assert.equal(dependencyProbe.status, 0, 'emitted test must have no externally resolvable Flow packages')
  const emitted = run(entry, [], xml, isolated)
  assert.equal(emitted.error, undefined)
  assert.equal(emitted.status, 0, emitted.stderr)
  assert.match(emitted.stdout, /<bpmndi:BPMNDiagram/)
  assert.match(emitted.stdout, /<bpmndi:BPMNShape/)
  assert.match(emitted.stdout, /<bpmndi:BPMNEdge/)
  const accepted = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({ process_id: 'P-001', process: processRecord })}\n${emitted.stdout}`, isolated)
  assert.equal(accepted.status, 0, accepted.stdout || accepted.stderr)
  assert.deepEqual(JSON.parse(accepted.stdout), { valid: true, diagnostics: [] })
  const dependency = [...readFileSync(entry, 'utf8').matchAll(/import\(["'](\.\/[^"']+\.mjs)["']\)/gu)][0]?.[1]
  assert.ok(dependency, 'normal emitted entry must retain its actual bundled dependency')
  const dependencyFile = new URL(dependency, entry)
  renameSync(dependencyFile, new URL(dependency + '.hidden', entry))
  const missingChunk = run(entry, [], xml, isolated)
  assert.notEqual(missingChunk.status, 0)
  assert.equal(missingChunk.stdout, '', 'missing emitted chunk must not produce fallback geometry')
  assert.match(missingChunk.stderr, /ERR_MODULE_NOT_FOUND/)
  assert.doesNotMatch(missingChunk.stderr, /\[flow_design:dependency\]/)
  console.log('Flow normal emitted closure OK outside repo; missing emitted chunk retains original error')
} finally {
  rmSync(packagedScratch, { recursive: true, force: true })
}
if (process.argv.includes('--dependency-layout-only')) {
  console.log('Flow existing four-node layout and final validation OK')
  process.exit(0)
}
// Already-saved supported diagrams remain valid without rewriting coordinates.
for (const revision of ['9','10','11','12']) {
  const previous=laidOut.stdout.replace('layoutRevision="13"',`layoutRevision="${revision}"`)
  const result=run(validateScript,['validate-final-bpmn-file'],`${JSON.stringify({process_id:'P-001',process:processRecord})}\n${previous}`)
  assert.equal(result.status,0,result.stdout||result.stderr)
}

const manualEdge = laidOut.stdout.replace('id="SequenceFlow_P-001_1_di"', 'id="manual_edge"')
const rejectedManualEdge = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n${manualEdge}`)
assert.equal(rejectedManualEdge.status, 1)
assert.match(JSON.parse(rejectedManualEdge.stdout).diagnostics.join('\n'), /must use the layout-script id/)

const firstEdge = /<bpmndi:BPMNEdge\b[\s\S]*?<\/bpmndi:BPMNEdge>/u.exec(laidOut.stdout)?.[0]
assert.ok(firstEdge)
const edgeWaypoints = [...firstEdge.matchAll(/<di:waypoint x="([^"]+)" y="([^"]+)" \/>/gu)]
assert.ok(edgeWaypoints.length >= 2)
const secondWaypoint = edgeWaypoints[1][0]
const diagonalEdge = firstEdge.replace(
  secondWaypoint,
  `<di:waypoint x="${Number(edgeWaypoints[0][1]) + 1}" y="${Number(edgeWaypoints[0][2]) + 1}" />`,
)
const diagonal = laidOut.stdout.replace(firstEdge, diagonalEdge)
const rejectedDiagonal = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n${diagonal}`)
assert.equal(rejectedDiagonal.status, 1)
assert.match(JSON.parse(rejectedDiagonal.stdout).diagnostics.join('\n'), /must use orthogonal waypoint segments/)

const fencedReceipt = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n\`\`\`xml\n${laidOut.stdout}\n\`\`\``)
assert.equal(fencedReceipt.status, 1)
assert.match(JSON.parse(fencedReceipt.stdout).diagnostics.join('\n'), /without a Markdown fence or preamble/)

const missingLayout = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n${xml}`)
assert.equal(missingLayout.status, 1)
assert.equal(JSON.parse(missingLayout.stdout).valid, false)

const invalid = run(validateScript, ['validate-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n${xml.replace('<bpmn:endEvent id="EndEvent_P-001_1" />', '')}`)
assert.equal(invalid.status, 1)
assert.equal(JSON.parse(invalid.stdout).valid, false)

console.log('FLOW DESIGN AGENT SCRIPTS OK')
