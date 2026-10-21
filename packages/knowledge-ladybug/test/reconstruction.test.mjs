import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compileDesignRelationVocabulary,
  knowledgeRelationReading,
  reconstructionKnowledge,
  registerReconstructionKnowledgeTool,
} from 'dsh-design-core'
import { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } from '../lib/index.js'
import { Context } from '../../../deepseek-harness/vendor/cordis/lib/index.js'
import SystemPrompt from '../../../deepseek-harness/packages/core/system-prompt/lib/index.js'
import ToolRuntime from '../../../deepseek-harness/packages/core/tools/lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'reconstruction-evidence-'))
const projectId = 'project:reconstruction'
const config = { databaseRoot: join(root, 'graph') }
const path = join(root, 'product.ts')
const quote = 'export const timeout = 15000'
const ctx = new Context()
let service
try {
  await writeFile(path, quote)
  service = await LadybugDesignKnowledgeProvider.open(projectId, config)
  const evidence = [{ path: 'product.ts', quote }]
  const entities = [
    { id: 'product', kind: 'product', summary: 'The product', evidence },
    { id: 'timeout', kind: 'behavior', summary: 'Timeout of 15 seconds', evidence },
  ]
  const relations = [{ id: 'has-timeout', from: 'product', to: 'timeout', kind: 'has', summary: 'Product timeout', evidence }]
  const vocabulary = compileDesignRelationVocabulary(`schema_version: 1
relations:
  - type: reconstruction:has
    meaning: depends-on
    direction: forward
    label: { zh: 具有, en: Has }
    description: { zh: A 具有 B, en: A has B }
`, 'reconstruction', '1.0')
  const typedRelations = relations.map(relation => ({ ...relation, kind: 'reconstruction:has' }))
  let result = await reconstructionKnowledge(service, projectId, 'cp-1', root, { entities, relations: typedRelations }, vocabulary)
  assert.equal(result.entities.length, 2)
  assert.equal(result.relations.length, 1)
  assert.equal(result.relations[0].properties.relationSemantics.vocabularyRevision, vocabulary.revision)
  assert.equal(knowledgeRelationReading(result.relations[0]).meaning, 'depends-on')
  assert.ok(result.entities.every(x => x.lifecycle === 'proposed' && x.evidenceCurrent))
  assert.ok(result.entities.every(x => x.provenance.producer === 'source-analysis'))
  const stableRevision = await service.revision(projectId)
  result = await reconstructionKnowledge(service, projectId, 'cp-1', root, { entities, relations: typedRelations }, vocabulary)
  assert.equal(await service.revision(projectId), stableRevision, 'identical reconstruction relation semantics are idempotent')
  const evolvedVocabulary = compileDesignRelationVocabulary(`schema_version: 1
relations:
  - type: reconstruction:has
    meaning: supports
    direction: forward
    label: { zh: 具有, en: Has }
    description: { zh: A 具有 B, en: A has B }
`, 'reconstruction', '2.0')
  assert.equal(knowledgeRelationReading(result.relations[0], evolvedVocabulary).meaning, 'depends-on', 'stored historical semantics beat the current registry')
  await assert.rejects(reconstructionKnowledge(service, projectId, 'cp-file', path, {
    entities: [{ ...entities[0], evidence: [{ path: '/etc/hosts', quote: 'localhost' }] }],
  }), /exact source file/)
  await writeFile(join(root, 'neighbor.md'), quote)
  await assert.rejects(reconstructionKnowledge(service, projectId, 'cp-file', path, {
    entities: [{ ...entities[0], evidence: [{ path: 'neighbor.md', quote }] }],
  }), /exact source file/)
  const singleFileResult = await reconstructionKnowledge(service, projectId, 'cp-file', path, { entities })
  assert.equal(singleFileResult.entities.length, 2, 'single-file source supports basename evidence')
  const revision = await service.revision(projectId)
  await assert.rejects(reconstructionKnowledge(service, projectId, 'cp-1', root, {
    entities: [{ ...entities[0], evidence: [{ path, quote: 'timeout = 5000' }] }],
  }), /does not match/)
  assert.equal(await service.revision(projectId), revision, 'invalid evidence does not write')
  await assert.rejects(reconstructionKnowledge(service, projectId, 'cp-1', root, {
    entities: [{ ...entities[0], evidence: [{ path: '/etc/hosts', quote: 'localhost' }] }],
  }), /inside/)
  await service.close()
  service = await LadybugDesignKnowledgeProvider.open(projectId, config)
  result = await reconstructionKnowledge(service, projectId, 'cp-2', root, {})
  assert.equal(result.entities.length, 2, 'source-analysis survives reopen')
  await writeFile(path, 'export const timeout = 20000')
  result = await reconstructionKnowledge(service, projectId, 'cp-2', root, {})
  assert.ok(result.entities.every(x => !x.evidenceCurrent), 'dirty bytes invalidate graph evidence')

  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerReconstructionKnowledgeTool(ctx, {
    async inspectReconstructionSource(sourceRoot) { return { sourceRoot } },
    async withSelectedKnowledge(_agent, operation) { return operation(service, { projectId }, 'cp-2') },
    kitForAgent() { return { relationVocabulary: vocabulary } },
  })
  const tool = ctx.tools.get('design_reconstruction_knowledge')
  assert.equal(tool.parameters.properties.entities.items.properties.evidence.type, 'array')
  assert.ok(tool.parameters.properties.entities.items.required.includes('evidence'))
  let seq = 0
  const call = args => ctx.tools.execute({
    name: 'design_reconstruction_knowledge', arguments: args,
    callId: `reconstruction-${++seq}`, rootCallId: `root-${seq}`,
    agent: {}, signal: new AbortController().signal,
  })
  const called = await call({ source_root: root, entities: [{ ...entities[1], evidence: [{ path, quote: 'timeout = 20000' }] }] })
  assert.equal(called.isError, false, JSON.stringify(called))
  assert.equal(JSON.parse(called.value.content).entities.length, 2)
  const bad = await call({ source_root: root, entities: [{ ...entities[1], evidence }] })
  assert.equal(bad.isError, false)
  assert.equal(JSON.parse(bad.value.content).available, false, 'optional graph error remains nonblocking')
  console.log('RECONSTRUCTION EVIDENCE GRAPH AND NATIVE TOOL OK')
} finally {
  await ctx.fiber.dispose()
  await service?.close()
  await shutdownLadybugKnowledgeRuntime()
  await rm(root, { recursive: true, force: true })
}
