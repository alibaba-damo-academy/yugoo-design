/**
 * Phase 2 / M2 smoke: run the renderability checkpoint (schema + validation.yaml
 * rule engine) over the web_app skills with valid and invalid states.
 * Run: node scripts/smoke-validate.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadDesignKit, validateSkillDesign as validateSkillDesignCore } from '../packages/core/lib/index.js'

const loadFixtureKit = (fs, root) => loadDesignKit(fs, root, { sourceId: 'fixture:smoke-validate' })

const validateSkillDesign = (skill, state, options = {}) => validateSkillDesignCore(skill, state, options)

const kitDir = fileURLToPath(new URL('../packages/skills-web-app/', import.meta.url))
const fs = {
  readText: async (p) => { try { return await readFile(p, 'utf8') } catch { return undefined } },
  listDir: async (p) => { try { return await readdir(p) } catch { return [] } },
  isDirectory: async (p) => (await stat(p)).isDirectory(),
}
const kit = await loadFixtureKit(fs, kitDir)
const skill = (name) => {
  const found = kit.skills.find((s) => s.name === name)
  if (found === undefined) throw new Error(`${name} skill not loaded`)
  return found
}

// Valid design passes the checkpoint.
const goodIssues = await validateSkillDesign(skill('function_modules'), {
  functions: {
    'F-001': {
      function_id: 'F-001', function_name: '记账录入', function_description: '记录收支。',
      function_epic: '账本管理', priority: 'High',
    },
  },
})
if (goodIssues.length !== 0) throw new Error(`valid design flagged: ${JSON.stringify(goodIssues)}`)
console.log('valid design: 0 issues (pass)')

// Invalid design (bad enum + missing required) is flagged with repair hints.
const badIssues = await validateSkillDesign(skill('function_modules'), {
  functions: { 'F-001': { function_id: 'F-001', priority: 'URGENT' } },
})
if (badIssues.length === 0) throw new Error('invalid design passed the checkpoint')
if (!badIssues.some((i) => i.code === 'schema_violation' && i.repair_hint !== undefined)) {
  throw new Error('expected a schema_violation with repair_hint')
}
console.log(`invalid design: ${badIssues.length} issue(s), codes=${badIssues.map((i) => i.code).join(',')}`)

// Empty plan is flagged by the validation.yaml state rule (verbatim code).
const emptyIssues = await validateSkillDesign(skill('function_modules'), { functions: {} })
if (!emptyIssues.some((i) => i.code === 'function_modules.empty')) {
  throw new Error(`expected function_modules.empty, got ${JSON.stringify(emptyIssues)}`)
}
console.log('empty plan: function_modules.empty raised (rule engine)')

// Function card semantics (e.g. duplicate names) are script-driven, asserted by
// Bundle-specific schema/validation rules cover state-only Bundles directly.

// A planned process carries direct, initially empty artifact state.
const flowState = {
  topic: '记账流程',
  processes: { 'P-001': {
    process_id: 'P-001',
    title: '记账',
    description: '录入',
    bpmn_file: null,
  } },
  process_order: ['P-001'],
  roles: [{ id: 'R-1', name: '用户' }],
}
const flowSchemaIssues = (await validateSkillDesign(skill('flow_design'), flowState)).filter((i) => i.code === 'schema_violation')
if (flowSchemaIssues.length !== 0) throw new Error(`direct artifact fields flagged: ${JSON.stringify(flowSchemaIssues)}`)
console.log('flow plan: schema accepts direct artifact fields')

// Completion audit: a committed process owes its BPMN file on disk.
const completionIssues = await validateSkillDesign(skill('flow_design'), flowState, {
  artifactText: async () => undefined,
})
if (!completionIssues.some((i) => i.code === 'flow_design.incomplete' && i.message.includes('no BPMN artifact reference'))) {
  throw new Error(`expected flow_design.incomplete, got ${JSON.stringify(completionIssues)}`)
}
console.log('completion audit: missing direct BPMN ref is incomplete')

// Declarative Host validation proves the direct ref. Bundle-owned publication
// validation inspects the BPMN bytes through bpmn-validator.mjs before publish.
const acceptedFlowState = {
  ...flowState,
  processes: { 'P-001': {
    ...flowState.processes['P-001'],
    bpmn_file: 'flow_design/P-001.bpmn',
  } },
}
const withFile = await validateSkillDesign(skill('flow_design'), {
  ...acceptedFlowState,
}, {
  artifactText: async (rel) => (rel === 'flow_design/P-001.bpmn' ? '<bpmn:definitions/>' : undefined),
})
if (withFile.some((i) => i.code === 'flow_design.incomplete')) {
  throw new Error(`completion audit flagged a landed artifact: ${JSON.stringify(withFile)}`)
}
console.log('completion audit: direct BPMN ref passes generic declarative validation')

// A planned visual system carries a preview identity with an initially empty ref.
const styleState = {
  config: {
    theme: '中性科研工作台',
    preview_page: { name: 'research_workspace', title: '研究问题工作台', rationale: '核心人机协作界面', html_file: null },
  },
}
const styleSchemaIssues = (await validateSkillDesign(skill('design_style'), styleState)).filter((i) => i.code === 'schema_violation')
if (styleSchemaIssues.length !== 0) throw new Error(`design_style preview fields flagged: ${JSON.stringify(styleSchemaIssues)}`)
console.log('design_style plan: schema accepts a null preview html_file')

// Completion audit: a committed visual system owes its preview HTML ref, exactly
// like a committed flow owes its BPMN ref.
const styleCompletionIssues = await validateSkillDesign(skill('design_style'), styleState, {
  artifactText: async () => undefined,
})
if (!styleCompletionIssues.some((i) => i.code === 'design_style.incomplete')) {
  throw new Error(`expected design_style.incomplete, got ${JSON.stringify(styleCompletionIssues)}`)
}
console.log('completion audit: missing preview html_file ref is incomplete')

// The accepted preview ref satisfies the same declarative completion gate.
const acceptedStyleState = {
  config: {
    ...styleState.config,
    preview_page: { ...styleState.config.preview_page, html_file: 'design_style/preview_research_workspace.html' },
  },
}
const withPreview = await validateSkillDesign(skill('design_style'), acceptedStyleState, {
  artifactText: async (rel) => (rel === 'design_style/preview_research_workspace.html' ? '<html></html>' : undefined),
})
if (withPreview.some((i) => i.code === 'design_style.incomplete')) {
  throw new Error(`completion audit flagged an accepted preview ref: ${JSON.stringify(withPreview)}`)
}
console.log('completion audit: accepted preview html_file ref passes the declarative gate')

// Smart Questions answer/fixed-card semantics are script-driven, asserted by
// Bundle-specific schema/validation rules cover state-only Bundles directly.

console.log('VALIDATE OK')
