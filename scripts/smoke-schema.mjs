/**
 * Phase 1/2 smoke: compile the function_modules schema.yaml into a write-time
 * validator and check it accepts a valid state / rejects invalid ones.
 * Run: node scripts/smoke-schema.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validatorFromSchemaYaml } from '../packages/core/lib/index.js'

const schemaPath = fileURLToPath(
  new URL('../packages/skills-web-app/bundles/function_modules/schema.yaml', import.meta.url),
)
const validate = validatorFromSchemaYaml(await readFile(schemaPath, 'utf8'))

const good = {
  functions: {
    'F-001': {
      function_id: 'F-001', function_name: '记账录入', function_description: '记录收入支出。',
      function_epic: '账本管理', priority: 'High', rejected: false, source: 'ai', reason: '核心动作',
    },
  },
}
const goodResult = validate(good)
if (!goodResult.ok) throw new Error(`valid state rejected: ${goodResult.error}`)
console.log('valid state accepted')

const missingField = { functions: { 'F-001': { function_id: 'F-001', function_name: 'x' } } }
const missingResult = validate(missingField)
if (missingResult.ok) throw new Error('state missing required fields was accepted')
console.log('missing-required rejected:', missingResult.error)

const badEnum = {
  functions: {
    'F-001': {
      function_id: 'F-001', function_name: 'x', function_description: 'd',
      function_epic: 'e', priority: 'URGENT',
    },
  },
}
const badEnumResult = validate(badEnum)
if (badEnumResult.ok) throw new Error('invalid priority enum was accepted')
console.log('bad-enum rejected:', badEnumResult.error)

const extraTop = validate({ ...good, invented: true })
if (extraTop.ok || !extraTop.error.includes('unexpected property "invented"')) {
  throw new Error(`unknown top-level property was not rejected: ${JSON.stringify(extraTop)}`)
}
const extraNested = validate({
  functions: { 'F-001': { ...good.functions['F-001'], invented: true } },
})
if (extraNested.ok || !extraNested.error.includes('$.functions.F-001: unexpected property "invented"')) {
  throw new Error(`unknown nested property was not rejected: ${JSON.stringify(extraNested)}`)
}
console.log('closed-object extra properties rejected')

for (const skill of [
  'business_data',
  'business_rules',
  'role_access',
  'integration_design',
  'notification_design',
  'quality_acceptance',
]) {
  const source = await readFile(new URL(`../packages/skills-web-app/bundles/${skill}/schema.yaml`, import.meta.url), 'utf8')
  const result = validatorFromSchemaYaml(source)({})
  if (result.ok || !result.error.includes('missing required "schema_version"')) {
    throw new Error(`${skill} accepted state without its locked schema_version`)
  }
}
console.log('extended Bundle schema versions required')

const businessDataSource = await readFile(
  new URL('../packages/skills-web-app/bundles/business_data/schema.yaml', import.meta.url),
  'utf8',
)
const validateBusinessData = validatorFromSchemaYaml(businessDataSource)
for (const incomplete of [
  { schema_version: 3, object_order: [] },
  { schema_version: 3, objects: {} },
]) {
  const result = validateBusinessData(incomplete)
  if (result.ok) throw new Error(`business_data accepted incomplete complete-state fields: ${JSON.stringify(incomplete)}`)
}
const emptyBusinessData = validateBusinessData({ schema_version: 3, objects: {}, object_order: [] })
if (!emptyBusinessData.ok) throw new Error(`business_data rejected its canonical empty state: ${emptyBusinessData.error}`)
console.log('business_data complete-state fields required while canonical empty state remains valid')

const prdSource = await readFile(
  new URL('../packages/skills-web-app/bundles/web_app_prd_assembly/schema.yaml', import.meta.url),
  'utf8',
)
const validatePrd = validatorFromSchemaYaml(prdSource)
const prdBase = { schema_version: 8, title: 'PRD', detail_level: 'concise', ai_provenance: [], html_file: null }
if (!validatePrd(prdBase).ok) throw new Error('web_app_prd_assembly rejected its v8 working-copy state')
if (!validatePrd({ ...prdBase, html_file: 'web_app_prd_assembly/prd.html' }).ok) {
  throw new Error('web_app_prd_assembly rejected its accepted project-relative artifact ref')
}
if (validatePrd({ ...prdBase, html_file: 'prd.html' }).ok) {
  throw new Error('web_app_prd_assembly accepted its legacy Bundle-relative artifact ref')
}
if (validatePrd({ ...prdBase, schema_version: 6, status: 'completed', failure_reason: '' }).ok) {
  throw new Error('web_app_prd_assembly accepted legacy persisted execution fields')
}
if (validatePrd({ ...prdBase, source_digests: {} }).ok) {
  throw new Error('web_app_prd_assembly retained obsolete source digests')
}
const pendingPrdCompletion = {
  id: 'AI-001', section_ids: ['product_definition'], operation: 'completion',
  description: 'Temporary structural completion', source_refs: [],
  assumption: { decision: 'Choose a default', reason: 'Missing evidence', impact: 'Affects implementation', decision_owner: 'Product owner' },
}
if (!validatePrd({ ...prdBase, ai_provenance: [pendingPrdCompletion] }).ok) {
  throw new Error('web_app_prd_assembly rejected a pending temporary completion')
}
if (validatePrd({ ...prdBase, ai_provenance: [{ ...pendingPrdCompletion, operation: 'synthesis', assumption: null }] }).ok) {
  throw new Error('web_app_prd_assembly accepted grounded synthesis as purple provenance')
}

const researchSource = await readFile(
  new URL('../packages/skills-web-app/bundles/research/schema.yaml', import.meta.url),
  'utf8',
)
const validateResearch = validatorFromSchemaYaml(researchSource)
const researchBase = { rounds: { R: { round_id: 'R', stage: 'confirmed' } }, round_order: ['R'], current_round_id: 'R' }
if (!validateResearch(researchBase).ok) throw new Error('research rejected its durable confirmed stage')
if (validateResearch({ ...researchBase, rounds: { R: { round_id: 'R', stage: 'researching' } } }).ok) {
  throw new Error('research accepted a persisted execution stage')
}

const designStyleSource = await readFile(
  new URL('../packages/skills-web-app/bundles/design_style/schema.yaml', import.meta.url),
  'utf8',
)
const validateDesignStyle = validatorFromSchemaYaml(designStyleSource)
if (validateDesignStyle({ config: { preview_page: { name: 'home', title: 'Home', rationale: 'Anchor', html_file: null, html: '<html></html>' } } }).ok) {
  throw new Error('design_style accepted legacy inline preview HTML')
}
console.log('artifact-backed Bundles reject legacy persisted execution and inline-content fields')

for (const malformed of [
  'type: object\nadditionalProperties: false\nproperties: {}\n',
  'type: string\nrequired: [value]\n',
  'type: map\nvalue: { type: string }\nnullable: false\ninvented: true\n',
]) {
  try {
    validatorFromSchemaYaml(malformed)
    throw new Error(`malformed schema was accepted: ${malformed}`)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('unsupported schema key')) throw error
  }
}
console.log('misspelled and misplaced schema keys rejected')

console.log('SCHEMA OK')
