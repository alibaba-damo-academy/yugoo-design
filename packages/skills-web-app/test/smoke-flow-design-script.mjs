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

const annotation = `<bpmn:textAnnotation id="TextAnnotation_P-001_1"><bpmn:text>Preserve the request wording.</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="Association_P-001_1" sourceRef="UserTask_P-001_1" targetRef="TextAnnotation_P-001_1" />`
const withAnnotation = content => content.replace('</bpmn:process>', `${annotation}</bpmn:process>`)
for (const candidate of [withAnnotation(xml), withAnnotation(xml).replaceAll('"', "'")]) {
  const result = run(validateScript, ['validate-bpmn-file'], `${JSON.stringify({ process_id: 'P-001', process: processRecord })}\n${candidate}`)
  assert.equal(result.status, 0, result.stdout || result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { valid: true, diagnostics: [] }, 'annotation associations are not sequence-flow endpoints, including valid single-quoted XML')
}
const missingEndpoint = content => content.replace('targetRef="UserTask_P-001_1"', 'targetRef="Missing_P-001_node"')
const brokenSequence = run(validateScript, ['validate-bpmn-file'], `${JSON.stringify({ process_id: 'P-001', process: processRecord })}\n${missingEndpoint(xml)}`)
assert.equal(brokenSequence.status, 1)
assert.match(JSON.parse(brokenSequence.stdout).diagnostics.join('\n'), /Undeclared ids referenced by flows: Missing_P-001_node/)

// Exact bindings may be repeated in another process. Unmapped user text is
// retained and reported, while two supplements for one live element are
// rejected rather than allowing the diagram to select an arbitrary record.
const supplements = {
  submit: { process_ref: 'P-001', bpmn_element_ref: 'UserTask_P-001_1', activity: 'Retain the request until it is saved.', remarks: 'Saved user text' },
  other: { process_ref: 'P-002', bpmn_element_ref: 'UserTask_P-001_1', activity: 'Different process' },
}
const supplementInput = nodes => `${JSON.stringify({ process_id: 'P-001', process: processRecord, roles: state.roles, nodes })}\n${xml}`
const beforeSupplements = JSON.stringify(supplements)
const mapped = run(validateScript, ['validate-bpmn-file'], supplementInput(supplements))
assert.equal(mapped.status, 0, mapped.stdout || mapped.stderr)
assert.deepEqual(JSON.parse(mapped.stdout), { valid: true, diagnostics: [], unmapped_nodes: [] })
const retained = { ...supplements, orphan: { process_ref: 'P-001', bpmn_element_ref: 'Removed_P-001_1', activity: 'Do not delete this saved explanation.' } }
const orphan = run(validateScript, ['validate-bpmn-file'], supplementInput(retained))
assert.equal(orphan.status, 0, orphan.stdout || orphan.stderr)
assert.deepEqual(JSON.parse(orphan.stdout).unmapped_nodes, ['orphan'])
assert.equal(retained.orphan.activity, 'Do not delete this saved explanation.')
const duplicate = run(validateScript, ['validate-bpmn-file'], supplementInput({ ...supplements, duplicate: { ...supplements.submit } }))
assert.equal(duplicate.status, 1, duplicate.stdout || duplicate.stderr)
assert.match(JSON.parse(duplicate.stdout).diagnostics.join('\n'), /ambiguous_node_binding.*submit.*duplicate/)
assert.equal(JSON.stringify(supplements), beforeSupplements)
const malformedNodes = run(validateScript, ['validate-bpmn-file'], supplementInput([]))
assert.equal(malformedNodes.status, 2)
assert.match(malformedNodes.stderr, /nodes must be a JSON object/)
console.log('Flow node mapping OK: process-scoped identity, ambiguous bindings rejected, orphan text retained')
if (process.argv.includes('--node-supplements-only')) process.exit(0)

const laidOut = run(layoutScript, [], xml)
assert.equal(laidOut.status, 0, laidOut.stderr)
assert.match(laidOut.stdout, /<bpmndi:BPMNDiagram/)
assert.match(laidOut.stdout, /layoutRevision="14"/)
assert.match(laidOut.stderr, /"preference":"balanced"/)
assert.match(laidOut.stderr, /"channels":/)

const fileFinal = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord,
})}\n${laidOut.stdout}`)
assert.equal(fileFinal.status, 0, fileFinal.stdout || fileFinal.stderr)
assert.deepEqual(JSON.parse(fileFinal.stdout), { valid: true, diagnostics: [] })

const annotatedFinal = withAnnotation(laidOut.stdout).replace('</bpmndi:BPMNPlane>', `<bpmndi:BPMNShape id="AnnotationShape_P-001_1" bpmnElement="TextAnnotation_P-001_1"><dc:Bounds x="100" y="100" width="100" height="50" /></bpmndi:BPMNShape>
  <bpmndi:BPMNEdge id="AnnotationLink_P-001_1" bpmnElement="Association_P-001_1"><di:waypoint x="100" y="100" /><di:waypoint x="160" y="160" /></bpmndi:BPMNEdge></bpmndi:BPMNPlane>`)
const acceptedAnnotation = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({ process_id: 'P-001', process: processRecord })}\n${annotatedFinal}`)
assert.equal(acceptedAnnotation.status, 0, acceptedAnnotation.stdout || acceptedAnnotation.stderr)
assert.deepEqual(JSON.parse(acceptedAnnotation.stdout), { valid: true, diagnostics: [] }, 'a valid annotation may have its own edge id and a diagonal association')
const brokenFinalSequence = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({ process_id: 'P-001', process: processRecord })}\n${missingEndpoint(annotatedFinal)}`)
assert.equal(brokenFinalSequence.status, 1)
assert.match(JSON.parse(brokenFinalSequence.stdout).diagnostics.join('\n'), /Undeclared ids referenced by flows: Missing_P-001_node/)
console.log('Flow endpoint ownership OK: annotation associations accepted, real sequence-flow dangling endpoints rejected')

// A local wording edit keeps the valid diagram and semantic identities. It must
// use the final-file route, not discard DI or rebuild the process to satisfy the
// new-candidate validator.
const revisedFinal = laidOut.stdout.replace('name="提交订单"', 'name="提交申请"')
assert.notEqual(revisedFinal, laidOut.stdout)
const ids = content => [...content.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
assert.deepEqual(ids(revisedFinal), ids(laidOut.stdout))
const revisedResult = run(validateScript, ['validate-final-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord, roles: state.roles,
})}\n${revisedFinal}`)
assert.equal(revisedResult.status, 0, revisedResult.stdout || revisedResult.stderr)
assert.deepEqual(JSON.parse(revisedResult.stdout), { valid: true, diagnostics: [] })
const wrongRoute = run(validateScript, ['validate-bpmn-file'], `${JSON.stringify({
  process_id: 'P-001', process: processRecord, roles: state.roles,
})}\n${revisedFinal}`)
assert.notEqual(wrongRoute.status, 0, 'structure-only input still rejects existing DI')

// Use the actual normal package builder; source-only success misses relocated
// bare-package resolution guards left behind after imports are bundled.
const packagedScratch = mkdtempSync(join(tmpdir(), 'flow-normal-emitted-'))
try {
  const { buildWebAppContent } = await import('../build.mjs')
  const target = join(packagedScratch, 'yugoo-design')
  await buildWebAppContent(target)
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
  // Layout is now one independent artifact. Search intentionally retains one
  // real sibling; losing it must still expose the original module error.
  const dependencyFile = join(target, 'bundles/flow_design/scripts/layout-metrics.mjs')
  renameSync(dependencyFile, dependencyFile + '.hidden')
  const input = join(packagedScratch, 'input.bpmn'); writeFileSync(input, emitted.stdout)
  const searchEntry = pathToFileURL(join(target, 'bundles/flow_design/scripts/layout-search.mjs'))
  const missingChunk = run(searchEntry, [input, join(packagedScratch, 'output.bpmn'), '--passes', '1'], '', isolated)
  assert.notEqual(missingChunk.status, 0)
  assert.equal(missingChunk.stdout, '', 'missing emitted sibling must not produce fallback geometry')
  assert.match(missingChunk.stderr, /ERR_MODULE_NOT_FOUND/)
  assert.doesNotMatch(missingChunk.stderr, /\[flow_design:dependency\]/)
  console.log('Flow normal emitted closure OK outside repo; missing metrics sibling retains original error')
} finally {
  rmSync(packagedScratch, { recursive: true, force: true })
}
if (process.argv.includes('--dependency-layout-only')) {
  console.log('Flow existing four-node layout and final validation OK')
  process.exit(0)
}
// Already-saved supported diagrams remain valid without rewriting coordinates.
for (const revision of ['9','10','11','12','13']) {
  const previous=laidOut.stdout.replace('layoutRevision="14"',`layoutRevision="${revision}"`)
  const result=run(validateScript,['validate-final-bpmn-file'],`${JSON.stringify({process_id:'P-001',process:processRecord})}\n${previous}`)
  assert.equal(result.status,0,result.stdout||result.stderr)
}
const unknownRevision=laidOut.stdout.replace('layoutRevision="14"','layoutRevision="999"')
const rejectedRevision=run(validateScript,['validate-final-bpmn-file'],`${JSON.stringify({process_id:'P-001',process:processRecord})}\n${unknownRevision}`)
assert.equal(rejectedRevision.status,1)
assert.match(JSON.parse(rejectedRevision.stdout).diagnostics.join('\n'),/supported autoagent:layoutRevision/)

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
