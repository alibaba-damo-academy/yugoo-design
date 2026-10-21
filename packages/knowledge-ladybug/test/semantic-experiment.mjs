/** Read committed project only; derived DB is temporary, model cache is reusable. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { register } from 'tsx/esm/api'
register()
import { DesignSemanticIndex } from '../lib/semantic-index.js'
import { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } from '../lib/index.js'
const { projectGraphFixture } = await import('../../core/test/project-graph-fixture.mjs')
const root = process.argv[2]
if (!root) throw new Error('Project directory required')
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const graph = await projectGraphFixture(root, process.argv[3]), checkpoint = graph.checkpoint, out = await mkdtemp(join(tmpdir(), 'semantic-graph-'))
console.log(JSON.stringify({ nodes: graph.nodes.map(n => ({ label: n.label, file: n.file, pointer: n.pointer })), warnings: graph.warnings }))
const volatile = process.env.SEMANTIC_VOLATILE === '1'
const provider = volatile ? undefined : await LadybugDesignKnowledgeProvider.open('semantic-experiment', { databaseRoot: out })
const index = new DesignSemanticIndex({ localOnly: process.env.SEMANTIC_LOCAL_ONLY === '1' })
try {
  const before = await provider?.revision('semantic-experiment'), started = performance.now()
  let result = index.read('semantic-experiment', graph, provider), last = ''
  while (result.status.state === 'indexing') {
    if (performance.now() - started > 600000) throw new Error('Experiment deadline')
    const current = JSON.stringify(result.status)
    if (current !== last) { console.log(current); last = current }
    await new Promise(r => setTimeout(r, 1000))
    result = index.read('semantic-experiment', graph, provider)
  }
  const nodes = new Map(graph.nodes.map(n => [n.id, n]))
  const report = { checkpoint, storage: volatile ? 'memory-no-database-opened' : 'isolated-ladybug', units: graph.semanticUnits, result: { ...result, edges: result.edges.map(e => ({ ...e, fromFile: nodes.get(e.from).file, fromPointer: nodes.get(e.from).pointer, toFile: nodes.get(e.to).file, toPointer: nodes.get(e.to).pointer })) }, seconds: (performance.now() - started) / 1000, factRevisionUnchanged: provider ? before === await provider.revision('semantic-experiment') : null }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: join(out, 'report.json'), status: result.status, seconds: report.seconds, factRevisionUnchanged: report.factRevisionUnchanged, pairs: report.result.edges.map(e => [e.fromPointer, e.toPointer, e.label]) }, null, 2))
  if (result.status.state !== 'ready') process.exitCode = 1
} finally { await index.close(); await provider?.close(); await shutdownLadybugKnowledgeRuntime() }
