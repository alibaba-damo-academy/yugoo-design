import { webAppBundleUrl } from './web-app-content-fixture.mjs'
/** Read frozen research fixtures; write only to a fresh derived temp directory.
 * No embedding inference, Ladybug mutation, GRA invocation or baseline overwrite. */
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { parseSchemaYaml, compileSchema } = await import('../src/schema.ts')
const { projectDesignGraph } = await import('../src/design-graph.ts')
const { schemaAtPointer } = await import('../src/design-graph-content.ts')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const baseline = process.argv[2]
if (!baseline) throw new Error('Usage: node knowledge-projection-comparison.mjs /absolute/frozen-graph-directory')
const output = await mkdtemp(join(tmpdir(), 'kag-schema-projection-'))
const report = { purpose: 'Schema-role structural projection comparison, NOT semantic/GRA detection or UI acceptance', output,
  baseline: resolve(baseline), sourceHashes: {}, variants: [] }
for (const name of ['schema.ts', 'design-graph-content.ts', 'design-graph.ts']) report.sourceHashes[name] = sha(await readFile(new URL('../src/' + name, import.meta.url)))
for (const variant of ['good', 'bad']) {
  const base = new URL(`../../../examples/research-platform-comparison/${variant}/design_files/`, import.meta.url)
  const oldPath = join(baseline, `${variant}-graph.json`), oldBytes = await readFile(oldPath)
  const before = JSON.parse(oldBytes), files = {}, schemas = {}, hashes = {}, schemaHashes = {}
  for (const name of await readdir(base)) {
    const path = `${name}/${name}.json`, bytes = await readFile(new URL(path, base))
    hashes[path] = sha(bytes); files[path] = JSON.parse(bytes)
    const spec = await readFile(webAppBundleUrl(`${name}/schema.yaml`), 'utf8')
    schemaHashes[path] = sha(spec); schemas[path] = parseSchemaYaml(spec)
    assert.deepEqual(compileSchema(schemas[path])(files[path]), [])
  }
  const graph = projectDesignGraph(files, before.checkpoint, schemas, { purpose: 'storage' })
  const ids = new Set(graph.nodes.map(n => n.id)), prior = new Map(before.nodes.map(n => [n.id, n]))
  const oldPointers = new Map(before.nodes.filter(n => n.record).map(n => [n.file + '#' + n.pointer, n.id]))
  for (const node of graph.nodes.filter(n => n.record)) if (oldPointers.has(node.file + '#' + node.pointer)) assert.equal(node.id, oldPointers.get(node.file + '#' + node.pointer))
  for (const node of graph.nodes) for (const field of node.fields ?? []) {
    const parts = field.pointer.split('/')
    for (let i = 1; i <= parts.length; i++) assert.notEqual(schemaAtPointer(schemas[node.file], parts.slice(0, i).join('/'))?.knowledge?.role, 'metadata')
  }
  const newEdges = graph.edges.filter(e => e.kind === 'identifier-match')
  for (const edge of newEdges) for (const source of JSON.parse(edge.evidence)) {
    const [file, pointer] = source.split('#')
    assert.equal(schemaAtPointer(schemas[file], pointer)?.knowledge?.role, 'reference')
  }
  const count = g => ({ records: g.nodes.filter(n => n.record).length, nodes: g.nodes.length, contains: g.edges.filter(e => e.kind === 'contains').length, identifierMatches: g.edges.filter(e => e.kind === 'identifier-match').length })
  report.variants.push({ variant, checkpoint: before.checkpoint, baselineSha256: sha(oldBytes), fileHashes: hashes, schemaHashes,
    before: count(before), after: count(graph),
    removedNodes: before.nodes.filter(n => !ids.has(n.id)).map(n => ({ id: n.id, file: n.file, pointer: n.pointer, label: n.label })),
    addedNodes: graph.nodes.filter(n => !prior.has(n.id)).map(n => ({ id: n.id, file: n.file, pointer: n.pointer, label: n.label })),
    warnings: graph.warnings })
  graph.warnings.push('Structural projection only: semantic candidates must be recomputed for this new snapshot; old embedding edges were NOT copied.')
  await writeFile(join(output, `${variant}-graph.json`), JSON.stringify(graph))
  for (const [path, hash] of Object.entries(hashes)) assert.equal(sha(await readFile(new URL(path, base))), hash)
  assert.equal(sha(await readFile(oldPath)), sha(oldBytes))
}
await writeFile(join(output, 'comparison-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ output, variants: report.variants.map(({ variant, before, after, removedNodes, addedNodes, warnings }) => ({ variant, before, after, removedNodes: removedNodes.length, addedNodes: addedNodes.length, warnings })) }, null, 2))
