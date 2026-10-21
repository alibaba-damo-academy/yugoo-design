import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const {
  compileDesignOntologyContract,
  compileDesignRelationVocabulary,
  designOntologyCoverage,
} = await import('../src/index.ts')
const { projectDesignGraph } = await import('../src/design-graph.ts')
const { parseSchemaYaml } = await import('../src/schema.ts')

const schema = parseSchemaYaml(`
type: object
required: [functions]
properties:
  schema_version: { type: number, knowledge: { role: metadata } }
  functions:
    type: map
    value:
      type: object
      required: [title]
      properties:
        id: { type: string }
        title: { type: string }
        status: { type: enum, values: [draft, ready] }
  pages:
    type: array
    items:
      type: object
      required: [title]
      properties:
        title: { type: string }
        function_ref: { type: string, knowledge: { role: reference, target: "#/functions" } }
  notes:
    type: array
    items:
      type: object
      properties:
        text: { type: string }
  collections:
    type: object
    properties:
      function_refs:
        type: array
        items: { type: string, knowledge: { role: reference, target: "#/functions" } }
`)

const vocabulary = compileDesignRelationVocabulary(undefined, 'fixture', '1.0')
const executionPolicies = { sample: { mode: 'main', handoff: 'none' } }
const contract = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', relationVocabulary: vocabulary,
  schemas: { 'sample/sample.json': schema }, executionPolicies })

test('zero-authoring schemas compile deterministic namespaced types and shapes', () => {
  const second = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', relationVocabulary: vocabulary,
    schemas: { 'sample/sample.json': schema }, executionPolicies })
  assert.equal(contract.revision, second.revision)
  const fn = contract.types.find(type => type.schemaPointer === '/properties/functions/value')
  const page = contract.types.find(type => type.schemaPointer === '/properties/pages/items')
  assert.equal(fn.id, 'fixture/sample#/properties/functions/value')
  assert.equal(fn.identityPolicy, 'member-key')
  assert.deepEqual(fn.properties.find(property => property.name === 'status').enumValues, ['draft', 'ready'])
  assert.equal(page.identityPolicy, 'content-addressed')
  assert.equal(page.properties.find(property => property.name === 'function_ref').targetType, fn.id)
  assert.equal(contract.types.find(type => type.schemaPointer === '').properties.find(property => property.name === 'pages').memberType, page.id)
  assert.equal(contract.types.find(type => type.schemaPointer === '/properties/functions').memberType, fn.id)
  assert.deepEqual(contract.actions, [{ id: 'fixture/sample#execute', bundle: 'sample', mode: 'main', handoff: 'none' }])
  const collections = contract.types.find(type => type.schemaPointer === '/properties/collections')
  assert.equal(collections.properties.find(property => property.name === 'function_refs').targetType, fn.id)
  assert.equal(page.properties.find(property => property.name === 'title').cardinality.min, 1)
})

test('projected Design File content carries ontology type, record kind and identity quality', () => {
  const graph = projectDesignGraph({ 'sample/sample.json': {
    schema_version: 1,
    functions: { search: { id: 'F-1', title: '文献检索' } },
    pages: [{ title: '工作台', function_ref: 'search' }],
    notes: [{ text: '匿名研究备注' }],
    collections: { function_refs: ['search'] },
  } }, 'checkpoint', { 'sample/sample.json': schema }, { purpose: 'storage', ontology: contract })
  const fn = graph.nodes.find(node => node.pointer === '/functions/search')
  const page = graph.nodes.find(node => node.pointer === '/pages/0')
  const note = graph.nodes.find(node => node.pointer === '/notes/0')
  assert.equal(fn.ontologyType, 'fixture/sample#/properties/functions/value')
  assert.equal(fn.identityQuality, 'stable')
  assert.equal(fn.recordKind, 'design-record')
  assert.equal(page.ontologyType, 'fixture/sample#/properties/pages/items')
  assert.equal(page.identityQuality, 'anonymous')
  assert.equal(note.identityQuality, 'anonymous')
  assert.equal(graph.nodes.some(node => node.pointer === '/schema_version'), false)
  assert.equal(graph.edges.filter(edge => edge.kind === 'identifier-match').length, 2)
  assert.deepEqual(designOntologyCoverage(graph.nodes, contract), {
    contractRevision: contract.revision,
    declaredTypes: contract.types.length,
    instantiatedTypes: 4,
    stable: 1,
    structural: 1,
    anonymous: 2,
    untyped: 0,
  })
})

test('relation endpoint constraints must resolve to declared contract types', () => {
  const constrained = compileDesignRelationVocabulary(`schema_version: 1
relations:
  - type: fixture:validates
    meaning: supports
    direction: forward
    label: { zh: 验证, en: Validates }
    description: { zh: 验证关系, en: Validation relation }
    domain: [fixture/missing#/items]
`, 'fixture', '1.0')
  assert.throws(() => compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', relationVocabulary: constrained,
    schemas: { 'sample/sample.json': schema } }), /references undeclared type/)
})

test('schema and relation changes advance the ontology revision', () => {
  const changedSchema = structuredClone(schema)
  changedSchema.properties.functions.value.properties.summary = { type: 'string' }
  const schemaChanged = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', relationVocabulary: vocabulary,
    schemas: { 'sample/sample.json': changedSchema } })
  const relationChanged = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0',
    relationVocabulary: compileDesignRelationVocabulary(`schema_version: 1\nrelations:\n  - type: fixture:validates\n    meaning: supports\n    direction: forward\n    label: { zh: 验证, en: Validates }\n    description: { zh: 验证关系, en: Validation relation }\n`, 'fixture', '1.0'),
    schemas: { 'sample/sample.json': schema } })
  const executionChanged = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', relationVocabulary: vocabulary,
    schemas: { 'sample/sample.json': schema }, executionPolicies: { sample: { mode: 'subagent', handoff: 'must_edit' } } })
  const changedMemberSchema = structuredClone(schema)
  changedMemberSchema.properties.pages = { type: 'map', value: structuredClone(schema.properties.pages.items) }
  const memberChanged = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', relationVocabulary: vocabulary,
    schemas: { 'sample/sample.json': changedMemberSchema }, executionPolicies })
  assert.notEqual(schemaChanged.revision, contract.revision)
  assert.notEqual(relationChanged.revision, contract.revision)
  assert.notEqual(executionChanged.revision, contract.revision)
  assert.notEqual(memberChanged.revision, contract.revision)
  assert.equal(memberChanged.types.find(type => type.schemaPointer === '').properties.find(property => property.name === 'pages').memberType,
    'fixture/sample#/properties/pages/value')
})
