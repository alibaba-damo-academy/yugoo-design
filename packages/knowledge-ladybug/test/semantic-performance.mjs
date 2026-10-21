/** Real local inference, disposable database; never writes the source project. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { semanticDigest, SEMANTIC_TEXT_VERSION } from 'dsh-design-core'
import { DesignSemanticIndex } from '../lib/semantic-index.js'
import { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } from '../lib/index.js'

const source = JSON.parse(await readFile(process.argv[2], 'utf8'))
const out = await mkdtemp(join(tmpdir(), 'semantic-performance-'))
const project = 'performance'
const graph = { checkpoint: source.checkpoint, semanticUnits: source.units }
let provider = await LadybugDesignKnowledgeProvider.open(project, { databaseRoot: out })
let index = new DesignSemanticIndex({ localOnly: true })
const results = []
async function measure(name, input) {
  let hits = 0, misses = 0, writes = 0, maxReadMs = 0, maxWriteMs = 0
  let phase = 'before-read', lastTick = performance.now()
  const stalls = []
  const cache = {
    async readSemanticCache(key) { phase = 'cache-read'; const t = performance.now(); const v = await provider.readSemanticCache(key); maxReadMs = Math.max(maxReadMs,performance.now()-t); phase = 'between-cache-operations-or-inference'; if (v) hits++; else misses++; return v },
    async writeSemanticCache(key, value) { phase = 'cache-write'; const t = performance.now(); writes++; await provider.writeSemanticCache(key, value); maxWriteMs = Math.max(maxWriteMs,performance.now()-t); phase = 'between-cache-operations-or-inference' },
  }
  const beforeRevision = await provider.revision(project)
  const cpu = process.cpuUsage(), startRss = process.memoryUsage().rss
  let peakRss = startRss, peakChildRss = 0
  const sample = setInterval(() => {
    const now = performance.now()
    if(now-lastTick>200) stalls.push({ gapMs:now-lastTick, phase })
    lastTick = now
    let childRss = 0
    // Linux RSS includes native ONNX allocations, unlike the JS heap limit.
    try {
      for (const pid of readFileSync(`/proc/self/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) {
        try { childRss += Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024 } catch {}
      }
    } catch {}
    peakChildRss = Math.max(peakChildRss, childRss)
    peakRss = Math.max(peakRss, process.memoryUsage().rss + childRss)
  }, 20)
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable()
  const started = performance.now()
  let result = index.read(project, input, cache)
  const immediateMs = performance.now() - started
  try {
    while (result.status.state === 'indexing') {
      if (performance.now() - started > 180000) throw new Error('Benchmark deadline')
      await new Promise(resolve => setTimeout(resolve, 10))
      result = index.read(project, input, cache)
    }
    const elapsedMs = performance.now() - started, used = process.cpuUsage(cpu)
    assert.equal(result.status.state, 'ready', result.status.message)
    assert.equal(await provider.revision(project), beforeRevision)
    const row = { name, units: input.semanticUnits.length, immediateMs, elapsedMs, hits, misses, writes, maxReadMs, maxWriteMs, stalls, edges: result.edges.length,
      parentCpuMs: (used.user + used.system) / 1000, startRssMiB: startRss / 1048576, peakTotalRssMiB: peakRss / 1048576, peakChildRssMiB: peakChildRss / 1048576,
      eventLoopP99Ms: lag.percentile(99) / 1e6, eventLoopMaxMs: lag.max / 1e6 }
    results.push(row); console.log(JSON.stringify(row)); return row
  } finally { clearInterval(sample); lag.disable() }
}
try {
  const cold = await measure('empty-vector-cache-local-model-already-downloaded', graph)
  assert.equal(cold.writes, graph.semanticUnits.length)
  const hot = await measure('same-index-reopen', graph)
  assert.equal(hot.hits + hot.misses + hot.writes, 0)
  await index.close(); await provider.close()
  provider = await LadybugDesignKnowledgeProvider.open(project, { databaseRoot: out })
  index = new DesignSemanticIndex({ localOnly: true })
  const persisted = await measure('new-index-reopened-ladybug', graph)
  assert.equal(persisted.hits, graph.semanticUnits.length); assert.equal(persisted.writes, 0)
  const changed = structuredClone(graph); changed.checkpoint += '-synthetic-edit'
  changed.semanticUnits[0].text += '\n补充说明：用户可以稍后继续处理。'
  changed.semanticUnits[0].digest = semanticDigest(SEMANTIC_TEXT_VERSION + '\n' + changed.semanticUnits[0].text)
  const incremental = await measure('one-unit-edited-in-memory', changed)
  assert.equal(incremental.misses, 1); assert.equal(incremental.writes, 1)
  assert.equal(incremental.hits, graph.semanticUnits.length - 1)
  await writeFile(join(out, 'report.json'), JSON.stringify({ source: process.argv[2], checkpoint: source.checkpoint,
    node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    note: 'Local-only, no downloads. RSS is parent + direct child sampled through Linux /proc every20ms; CPU is parent only. Single-run measurements, not UI timing. Database reopened in same process, not host restart.', results }, null, 2))
  console.log('Report:', join(out, 'report.json'))
} finally { await index.close(); await provider.close(); await shutdownLadybugKnowledgeRuntime() }
