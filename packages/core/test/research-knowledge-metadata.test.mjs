import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseSchemaYaml, compileSchema } from '../src/schema.ts'
import { projectDesignGraph } from '../src/design-graph.ts'
import { appendReferencedKnowledgeArtifacts } from '../src/design-knowledge-artifacts.ts'

test('research fingerprints and store timestamps remain writable provenance, not knowledge content', async () => {
  const schema = parseSchemaYaml(await readFile(new URL('../../skills-web-app/bundles/research/schema.yaml', import.meta.url), 'utf8'))
  const plain = structuredClone(schema)
  const paths = [['rounds', 'value', 'directions', 'value', 'findings_sha256'], ['rounds', 'value', 'conclusion_sha256'], ['rounds', 'value', 'created_at'], ['rounds', 'value', 'updated_at']]
  for (const path of paths) {
    let spec = plain
    for (const key of path) spec = key === 'value' ? spec.value : spec.properties[key]
    delete spec.knowledge
  }
  const file = 'research/research.json', findings = 'research/r/findings.md', conclusion = 'research/r/conclusion.html'
  const state = { rounds: { r: { round_id: 'r', topic: '研究实际证据', stage: 'confirmed',
    directions: { d: { direction_id: 'd', title: '退货规则', research_points: ['核查规则适用条件'], findings_file: findings, findings_sha256: 'a0b1c2d3'.repeat(8), source_urls: ['https://example.com/evidence'] } },
    direction_order: ['d'], conclusion_file: conclusion, conclusion_sha256: 'e4f5a6b7'.repeat(8), created_at: 1792400000000, updated_at: 1792400000100,
  } }, round_order: ['r'], current_round_id: 'r' }
  const bytes = JSON.stringify(state), reopened = JSON.parse(bytes)
  for (const input of [state, reopened, { rounds: { r: { ...state.rounds.r, updated_at: 'bad' } } }]) assert.deepEqual(compileSchema(schema)(input), compileSchema(plain)(input))
  const graph = projectDesignGraph({ [file]: reopened }, 'checkpoint', { [file]: schema }, { purpose: 'storage' })
  assert.ok(!graph.nodes.flatMap(n => n.fields ?? []).some(f => /sha256|created_at|updated_at/.test(f.pointer)))
  assert.ok(graph.nodes.some(n => n.pointer === '/rounds/r'))
  const artifacts = { [findings]: '# 已核实的规则\n[证据](https://example.com/evidence)', [conclusion]: '<html>有证据的结论</html>' }
  await appendReferencedKnowledgeArtifacts({ listPathsAt: async () => [file, findings, conclusion], readBytesAt: async (_rev, path) => Buffer.from(artifacts[path]) }, graph, undefined, undefined, { [file]: schema })
  for (const path of [findings, conclusion]) assert.ok(graph.nodes.some(n => n.file === path && n.source))
  assert.equal(JSON.stringify(reopened), bytes)
  assert.equal(state.rounds.r.created_at, reopened.rounds.r.created_at)
})
