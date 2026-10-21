/** Opt-in, real local embedding + isolated database. Source Git is read-only. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } from '../lib/index.js'
import { DesignSemanticIndex } from '../lib/semantic-index.js'
const { register } = await import('tsx/esm/api'); register()
const { refreshDesignKnowledge } = await import('../../core/src/design-knowledge-refresh.ts')
const { readCompleteDesignKnowledge } = await import('../../core/src/design-knowledge-snapshot.ts')
const { storedKnowledgeGraph } = await import('../../core/src/design-knowledge-semantic.ts')
const { parseSchemaYaml } = await import('../../core/src/schema.ts')
if (!process.argv[2]) throw new Error('Usage: node knowledge-live-smoke.mjs SOURCE_PROJECT [KIT_ROOT]')
const root = resolve(process.argv[2]), kit = process.argv[3] && resolve(process.argv[3])
const git = async args => (await promisify(execFile)('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout
const checkpoint = (await git(['rev-parse', 'HEAD'])).toString().trim()
const paths = (await git(['ls-tree', '-r', '--name-only', checkpoint, '--', 'design_files'])).toString().trim().split('\n').filter(Boolean)
const schemas = {}
if (kit) for (const path of paths) {
  const relative = path.replace(/^design_files\//, ''), parts = relative.split('/')
  if (parts.length !== 2 || parts[1] !== parts[0] + '.json' || parts[0].startsWith('_')) continue
  try { schemas[relative] = parseSchemaYaml(await readFile(join(kit, 'skills', parts[0], 'schema.yaml'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
const store = { head: async () => checkpoint, listPathsAt: async () => paths,
  readBytesAt: async (revision, path) => git(['show', `${revision}:design_files/${path}`]),
  readTextAt: async (revision, path) => (await git(['show', `${revision}:design_files/${path}`])).toString('utf8') }
const directory = await mkdtemp(join(tmpdir(), 'kag-live-'))
// Optional old现场 probe: copy durable bytes only; never open the user's DB.
const recoverySource = process.argv[4] && resolve(process.argv[4])
const projectId = recoverySource ? JSON.parse(await readFile(join(root, 'project.json'), 'utf8')).id : 'isolated-live'
const dbName = createHash('sha256').update(projectId).digest('hex') + '.lbdb'
const oldHashes = new Map()
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
if (recoverySource) for (const suffix of ['', '.wal', '.shadow']) {
  const path = join(recoverySource, dbName + suffix)
  try { oldHashes.set(path, digest(await readFile(path))); await copyFile(path, join(directory, dbName + suffix)) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
const index = new DesignSemanticIndex({ localOnly: true })
let provider, other, inputUnits = 0
try {
  other = await LadybugDesignKnowledgeProvider.open('other-live', { databaseRoot: directory })
  provider = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory }, recoverySource ? {
    onState: state => console.log('recovery', JSON.stringify(state)),
    rebuild: async service => {
      await refreshDesignKnowledge({ projectId, service, store, schemas, mutate: operation => operation() })
      assert.equal(await other.revision('other-live'), 'rev:0', 'Recovery cannot shut down another project runtime')
      return async () => { assert.equal((await git(['rev-parse', 'HEAD'])).toString().trim(), checkpoint) }
    },
  } : undefined)
  const started = Date.now()
  const result = await refreshDesignKnowledge({ projectId, service: provider, store, schemas,
    mutate: operation => operation(), compute: async graph => { inputUnits = graph.semanticUnits.length; return index.compute(projectId, graph, provider) } })
  const graph = await readCompleteDesignKnowledge(provider, { projectId, limit: 100 })
  const view = storedKnowledgeGraph(graph, checkpoint)
  const edges = graph.relations.filter(edge => edge.properties.projection === 'embedding-v1')
  assert.deepEqual(view.edges.filter(edge => edge.kind === 'semantic').map(edge => edge.id).sort(), edges.map(edge => edge.id).sort())
  await index.close(); await provider.close()
  provider = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory })
  assert.equal(await provider.revision(projectId), result.revision)
  const reopened = await readCompleteDesignKnowledge(provider, { projectId, limit: 100 })
  const byId = records => [...records].sort((left, right) => left.id.localeCompare(right.id))
  assert.deepEqual(byId(reopened.entities), byId(graph.entities), 'Reopened entity contents must match the persisted snapshot')
  assert.deepEqual(byId(reopened.relations), byId(graph.relations), 'Reopened relation contents must match the persisted snapshot')
  const report = { source: root, checkpoint, database: directory, sourceReadOnly: true, localOnly: true,
    ...(recoverySource ? { recoveredOldDatabaseCopy: !!provider.recovery, generation: reopened.generation } : {}),
    nodes: graph.entities.length, relations: graph.relations.length, semanticRelations: edges.length, inputUnits,
    revision: result.revision, elapsedMs: Date.now() - started, reopened: true, reopenedContentsCompared: true, crashRecoveryTested: false }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await index.close(); await provider?.close(); await other?.close(); await shutdownLadybugKnowledgeRuntime()
  for (const [path, hash] of oldHashes) assert.equal(digest(await readFile(path)), hash, 'Original database bytes unchanged')
}
