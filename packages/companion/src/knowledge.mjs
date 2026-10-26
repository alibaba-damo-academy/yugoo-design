/** One host-neutral KAG composition for Codex, Claude Code and Qoder CLI. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  refreshDesignKnowledge, readCompleteDesignKnowledge, storedKnowledgeGraph,
  readDesignKnowledgePublication, readPublishedDesignKnowledge, advanceDesignKnowledgePublication,
  readAdvisoryDesignKnowledge, publishKnowledgeReview, parseSchemaYaml,
  knowledgeQueryFilters, knowledgeReadResult, DesignKnowledgeRevision,
  readSourceDesignKnowledge, queryKnowledgeSnapshot,
  DesignKnowledgeIndex, designOntologyCoverage, deriveDesignKnowledgeStatus,
  restoreDesignKnowledgeRecords, saveDesignKnowledgeRecords, commitDesignProjectRecords,
} from '../../core/lib/index.js'

export function companionKnowledgeRuntimeUrl() {
  // Published runtime is a separate asset bundle; source mode uses the same library.
  const packaged = new URL('../knowledge/runtime.mjs', import.meta.url)
  return existsSync(packaged) ? packaged : new URL('../../knowledge-ladybug/lib/index.js', import.meta.url)
}

async function runtime() { return import(companionKnowledgeRuntimeUrl().href) }

export { runtime as loadCompanionKnowledgeRuntime }

export function createCompanionKnowledge({ project, stateRoot, loadRuntime = runtime, embedding = { localOnly: true } }) {
  const projectId = project.project.metadata.id
  let opening, provider, index, closed = false, lastOpenError
  let recovery
  const indexer = new DesignKnowledgeIndex()
  let maintenanceState = 'unknown'
  let maintenancePhase = 'unknown'
  let lastMaintenanceError
  let maintenanceRequests = 0, maintenanceTask
  let retryFailed = false
  const abort = new AbortController()
  const sameCheckpoint = async (left, right) => !!left && !!right
    && (left === right || await project.store.sameDesignEvidenceAt(left, right))
  const persistRecords = publication => saveDesignKnowledgeRecords({
    projectRoot: project.project.root, projectId, service: provider, cache: provider, publication,
    persist: paths => commitDesignProjectRecords({ projectRoot: project.project.root, paths,
      message: 'design(knowledge): save project records', signal: abort.signal }),
  })
  const check = async () => {
    abort.signal.throwIfAborted()
    await project.requireWritable()
    if (project.project.metadata.id !== projectId) throw new Error('Knowledge project identity changed')
    abort.signal.throwIfAborted()
  }
  async function open() {
    await check()
    opening ??= (async () => {
      if (project.project.metadata.knowledge.provider !== 'ladybug-wasm') throw new Error('Unsupported pinned Knowledge provider')
      const module = await loadRuntime()
      await check()
      const opened = await module.LadybugDesignKnowledgeProvider.open(projectId, {
        databaseRoot: join(stateRoot, 'project-management', 'registry', 'projects', projectId, 'design-knowledge'),
      }, {
        retryFailed,
        onState: state => { recovery = state },
        rebuild: async service => {
          const result = await refreshDesignKnowledge({ projectId, service, store: project.store, schemas: schemas(), ontology: project.kit.ontologyContract, signal: abort.signal,
            mutate: async operation => { await check(); return operation() } })
          return async () => { await check(); if (!await sameCheckpoint(result.checkpoint, await project.store.head())) throw new Error('Design checkpoint changed during Knowledge recovery; retry from current files') }
        },
      })
      try {
        await restoreDesignKnowledgeRecords({ projectRoot: project.project.root, projectId,
          service: opened, cache: opened, resetCache: () => opened.resetCache(projectId) })
      } catch (error) { await opened.close(); throw error }
      // Status reads must not expose a previous machine cache while the
      // project's archive is still being restored.
      provider = opened
      // A successful explicit retry supersedes a prior open/recovery error.
      // The provider may not emit a new onState event when no rebuild is needed.
      if (recovery?.state === 'error') recovery = undefined
      lastOpenError = undefined
      index = new module.DesignSemanticIndex(embedding)
      return provider
    })().catch(error => { lastOpenError = String(error.message ?? error).slice(0, 1000); throw error })
    const service = await opening
    await check()
    return service
  }
  const schemas = () => Object.fromEntries(project.kit.skills.filter(skill => typeof skill.metadata?.schemaYaml === 'string')
    .map(skill => [`${skill.name}/${skill.name}.json`, parseSchemaYaml(skill.metadata.schemaYaml)]))
  const readCoverage = (source, basis = 'complete-publication') => ({
    basis: source ? 'source-projection' : basis,
    semantic: source ? 'not-published-for-source' : basis === 'complete-publication' ? 'complete' : 'not-asserted',
    ...(source ? { sourceFiles: source.sourceFiles.slice(0, 64), sourceFileCount: source.sourceFiles.length,
      sourceFilesTruncated: source.sourceFiles.length > 64, warnings: source.warnings } : {}),
    note: 'Bounded source evidence; absence is not proof of missing design. Semantic status and latest-complete remain separate.',
  })
  async function refresh(compute = false, background = false) {
    const service = await open()
    return refreshDesignKnowledge({ projectId, service, store: project.store, schemas: schemas(), ontology: project.kit.ontologyContract, signal: abort.signal,
      mutate: operation => project.mutateKnowledge(async () => { await check(); return operation() }),
      indexer, background, identity: index.publicationIdentity, cache: service,
      // Observable operational phase only; shared vocabulary with the DSH panel.
      report: phase => { maintenancePhase = phase },
      persist: publication => persistRecords(publication),
      ...(compute && embedding.provider !== 'disabled' ? { compute: (graph, signal) => index.compute(projectId, graph, service, signal) } : {}),
    })
  }
  const api = {
    recoveryStatus: () => recovery,
    async retryRecovery() {
      await check()
      if (recovery?.state !== 'error' || provider) throw new Error('Knowledge recovery is not awaiting retry')
      opening = undefined; retryFailed = true
      // An explicit retry owns the next maintenance attempt. Reads stay pure:
      // the user does not need to save or restart merely to resume recovery.
      void api.notify().catch(() => {})
      return { accepted: true }
    },
    async notify() {
      if (closed) return
      maintenanceRequests += 1
      if (!maintenanceTask) maintenanceTask = (async () => {
        let completed = 0
        try {
          while (completed !== maintenanceRequests) {
            completed = maintenanceRequests
            maintenanceState = 'indexing'
            lastMaintenanceError = undefined
            try {
              indexer.retry(projectId)
              const result = await refresh(true, true)
              maintenanceState = result.semantic
              if (result.semantic === 'indexing') {
                // Surface the detached embedding job's terminal failure honestly;
                // no automatic retry, the next explicit request re-admits once.
                const settled = indexer.settledState?.(projectId)
                if (settled) void settled.catch(error => {
                  if (!closed && indexer.state(projectId) === 'error') {
                    maintenanceState = 'error'
                    lastMaintenanceError = String(error?.message ?? error).slice(0, 1000)
                  }
                })
              }
            } catch (error) {
              maintenanceState = 'error'
              lastMaintenanceError = String(error?.message ?? error).slice(0, 1000)
              // A newer Design Files event supersedes a checkpoint-fenced
              // attempt. Consume that pending request before surfacing the old
              // failure; otherwise the project could remain stale until the
              // next unrelated save or reopen.
              if (completed === maintenanceRequests) throw error
            }
          }
        } finally { maintenanceTask = undefined }
      })()
      return maintenanceTask
    },
    /**
     * Cheap honest status sampling shared with the DSH contract: the same
     * deriveDesignKnowledgeStatus vocabulary, no scheduling and no indexing.
     * A cold store is unavailable until an ordinary operation opens it. Opening
     * can initialize/recover a database, so a status read must never acquire it.
     * This does not create a second publication cache; established providers
     * read their one durable publication through the shared Core parser.
     */
    async status() {
      const head = await project.store.head().catch(() => undefined)
      const cache = provider
      let readFailure = lastOpenError ? { target: 'knowledge-store', message: lastOpenError } : undefined
      let publicationBytes
      const publication = cache ? await readDesignKnowledgePublication({
        async readSemanticCache(key) {
          try { publicationBytes = await cache.readSemanticCache(key); return publicationBytes }
          catch (error) {
            // Core's tolerant publication reader deliberately catches provider
            // errors. Observe failure at this thin I/O boundary, not afterwards.
            readFailure = { target: 'knowledge-publication', message: String(error.message ?? error).slice(0, 1000) }
            throw error
          }
        },
      }) : undefined
      if (publicationBytes !== undefined && !publication && !readFailure) {
        readFailure = { target: 'knowledge-publication', message: 'The stored knowledge publication is not valid.' }
      }
      const live = indexer.state(projectId)
      const failedNow = maintenanceState === 'error' || live === 'error'
      const snapshot = deriveDesignKnowledgeStatus({
        project: projectId,
        ...(head === undefined || head === null ? {} : { head }),
        ...(publication ? { publication } : {}),
        ...(publication && head ? { publicationMatchesHead: await sameCheckpoint(publication.checkpoint, head) } : {}),
        liveJob: live === 'indexing' || maintenanceTask ? 'running' : 'none',
        ...(['projection', 'semantic', 'publication'].includes(maintenancePhase) ? { phase: maintenancePhase } : {}),
        ...(failedNow ? { indexFailure: { target: 'companion-maintenance', message: lastMaintenanceError ?? '语义索引未完成；已有完整图谱仍可使用。' } }
          : readFailure ? { indexFailure: readFailure } : {}),
        ...(recovery ? { recovery } : {}),
        semanticEnabled: embedding.provider !== 'disabled',
      })
      if (!cache && !maintenanceTask && !failedNow && !readFailure && !recovery) {
        return { ...snapshot, state: 'unavailable', reasonCode: 'knowledge-store-not-open',
          reason: 'Knowledge storage has not been opened in this service. Open the graph or explicitly request maintenance; status alone does not initialize or recover it.' }
      }
      return snapshot
    },
    /**
     * Agent-initiated bounded maintenance with the shared structured result
     * contract: one generation, single-flight through the existing notify
     * loop, never looping on failure. Explicit recovery keeps its retry gate.
     */
    async requestMaintenance() {
      if (closed) return { outcome: 'rejected', reason: 'knowledge-closed' }
      if (recovery?.state === 'rebuilding') return { outcome: 'rejected', reason: 'recovery-in-progress' }
      const status = await api.status()
      // Same contract as the DSH side: `generation` is the exact single-flight
      // target identity or absent — the companion loop coalesces by request
      // count over the live indexer key and does not expose that key, so it
      // omits the field rather than approximate it with the last publication.
      const target = {
        ...(status.head === undefined ? {} : { checkpoint: status.head }),
        ...(status.latestComplete === undefined ? {} : { lastPublishedRevision: status.latestComplete.revision }),
      }
      if (status.state === 'current') return { outcome: 'noop', reason: 'current', target }
      if (status.state === 'queued' || status.state === 'running') return { outcome: 'noop', reason: `already-${status.state}`, target }
      if (!status.head || status.state === 'unknown') return { outcome: 'rejected', reason: 'no-published-checkpoint', target }
      if (status.state === 'unavailable' && status.reasonCode !== 'knowledge-store-not-open') return { outcome: 'rejected', reason: 'recovery-in-progress', target }
      if (status.state === 'failed' && recovery?.state === 'error') {
        await api.retryRecovery()
        return { outcome: 'accepted', reason: 'recovery-retry-accepted', target }
      }
      void api.notify().catch(error => console.error('Knowledge refresh:', String(error.message ?? error)))
      return {
        outcome: 'accepted',
        reason: status.state === 'failed' ? 'failed-generation-retry-accepted'
          : status.state === 'disabled' ? 'projection-only-accepted'
            : 'maintenance-accepted',
        target,
      }
    },
    async readGraph() {
      // Waiting for an already-started initial projection is read-only. It does
      // not authorize indexing and avoids exposing an empty newborn database.
      const opened = await open()
      if (!await readDesignKnowledgePublication(opened) && maintenanceTask) await maintenanceTask.catch(() => {})
      const result = await project.mutateKnowledge(async () => {
        await check()
        const checkpoint = await project.store.head(), service = await open()
        if (!checkpoint) throw new Error('Knowledge graph requires a published checkpoint')
        const { publication, snapshot } = await readPublishedDesignKnowledge({ service, cache: service, projectId, limit: 100, signal: abort.signal })
        if (!await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Knowledge checkpoint changed during graph read')
        const publishedCheckpoint = publication?.checkpoint ?? checkpoint
        const graph = storedKnowledgeGraph(snapshot, publishedCheckpoint)
        graph.warnings.push(...(publication?.warnings ?? []))
        const status = await api.status()
        if (!await sameCheckpoint(checkpoint, status.head) || status.latestComplete?.revision !== publication?.revision) {
          throw new Error('Knowledge publication changed during graph read')
        }
        const activeState = indexer.state(projectId) === 'unknown' ? maintenanceState : indexer.state(projectId)
        // Honest coverage, same rule as the DSH read: currency derives only
        // from the durable publication matching the head; a stale publication
        // without a live job is `due`; a residual in-memory `ready` without a
        // publication pointer never claims currency.
        const embeddingState = activeState === 'indexing' || activeState === 'error'
          ? activeState
          : publication === undefined
            ? (activeState === 'ready' ? 'unknown' : activeState)
            : await sameCheckpoint(publication.checkpoint, checkpoint) ? 'ready' : 'due'
        const ontology = designOntologyCoverage(graph.nodes, project.kit.ontologyContract)
        const { semanticUnits, ...view } = graph
        return { content: JSON.stringify({ ...view, nodes: graph.nodes.map(({ fields, ...node }) => node),
          projectId, knowledgeRevision: snapshot.revision, knowledgeStatus: status.state,
          recovery,
          coverage: { projection: 'canonical-json-and-direct-artifacts', embedding: embeddingState, phase: maintenancePhase, review: 'unknown', ontology },
          freshness: { sourceCheckpoint: checkpoint, ...(publication === undefined ? {} : { indexedCheckpoint: publication.checkpoint }) },
        }) }
      })
      return result
    },
    async query(args) {
      if (!args.project || !args.checkpoint || !args.revision) throw new Error('Knowledge query requires exact project, checkpoint and revision pins')
      if (args.project !== projectId) throw new Error('Knowledge query project does not match connection')
      if (args.basis !== undefined && !['source-projection', 'complete-publication'].includes(args.basis)) throw new Error('Invalid Knowledge read basis')
      const filters = knowledgeQueryFilters(args), service = await open()
      return project.mutateKnowledge(async () => {
        await check()
        const currentCheckpoint = await project.store.head()
        const publication = await readDesignKnowledgePublication(service)
        if (!await sameCheckpoint(currentCheckpoint, args.checkpoint)) {
          if (publication?.checkpoint !== args.checkpoint || publication.revision !== args.revision) {
            throw new Error('Knowledge checkpoint changed; refresh the snapshot')
          }
        }
        const request = { ...filters, offset: args.offset ?? 0, projectId,
          revision: DesignKnowledgeRevision(args.revision), limit: args.limit ?? 30 }
        // New context pins the read basis as well as revision/checkpoint. Old
        // callers retain explicit historical reads when a publication exists;
        // those reads are never represented as a current complete publication.
        const complete = publication?.revision === args.revision
          && await sameCheckpoint(publication.checkpoint, args.checkpoint)
        if (args.basis === 'complete-publication' && !complete) throw new Error('Knowledge complete-publication pins changed; refresh the context')
        const source = args.basis !== 'source-projection' && publication ? undefined : await readSourceDesignKnowledge({
          service, projectId, store: project.store, checkpoint: args.checkpoint,
          revision: request.revision, schemas: schemas(), ontology: project.kit.ontologyContract, signal: abort.signal,
        })
        const graph = source ? queryKnowledgeSnapshot(source.graph, request) : await service.query(request)
        const status = await api.status()
        await check()
        if (!await sameCheckpoint(currentCheckpoint, await project.store.head())) throw new Error('Knowledge checkpoint changed during query')
        return { ...knowledgeReadResult(projectId, args.checkpoint, graph), status,
          ...(source ? { sourceCheckpoint: source.sourceCheckpoint } : complete ? { sourceCheckpoint: publication.checkpoint } : {}),
          coverage: readCoverage(source, complete ? 'complete-publication' : 'historical-snapshot') }
      })
    },
    /** Ordinary Agent context is independent of complete semantic publication.
     * Review capture remains strict below; a source view never grants review
     * writeback or marks the semantic layer current. */
    async captureContext(checkpoint) {
      return project.mutateKnowledge(async () => {
        await check()
        if (!checkpoint || !await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Knowledge context checkpoint changed')
        const service = await open()
        const publication = await readDesignKnowledgePublication(service)
        const complete = !!publication && await sameCheckpoint(publication.checkpoint, checkpoint)
        let source, knowledge
        if (complete) {
          knowledge = await readAdvisoryDesignKnowledge({ project: projectId, checkpoint }, service, 30, {}, publication.revision, publication.checkpoint)
        } else {
          source = await readSourceDesignKnowledge({ service, projectId, store: project.store, checkpoint,
            schemas: schemas(), ontology: project.kit.ontologyContract, signal: abort.signal })
          knowledge = await readAdvisoryDesignKnowledge({ project: projectId, checkpoint }, {
            revision: async () => source.graph.revision,
            query: async request => queryKnowledgeSnapshot(source.graph, request),
          }, 30, {}, source.graph.revision, source.sourceCheckpoint)
        }
        knowledgeReadResult(projectId, checkpoint, knowledge.graph)
        const status = await api.status()
        await check()
        if (!await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Knowledge context checkpoint changed')
        const coverage = readCoverage(source)
        const context = JSON.parse(knowledge.context)
        return { ...knowledge, coverage, status,
          context: JSON.stringify({ ...context, coverage: { ...context.coverage, ...coverage }, status }) }
      })
    },
    async captureReview(checkpoint) {
      return project.mutateKnowledge(async () => {
        const service = await open()
        if (!await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Review Knowledge checkpoint changed')
        const publication = await readDesignKnowledgePublication(service)
        if (!await sameCheckpoint(publication?.checkpoint, checkpoint)) throw new Error('Review Knowledge is still indexing this Design checkpoint')
        const knowledge = await readAdvisoryDesignKnowledge({ project: projectId, checkpoint }, service, 30, {}, publication.revision, publication.checkpoint)
        knowledgeReadResult(projectId, checkpoint, knowledge.graph)
        if (!await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Review Knowledge checkpoint changed')
        return knowledge
      })
    },
    async reviewSnapshot(checkpoint, revision) {
      return project.mutateKnowledge(async () => {
        const service = await open()
        if (!await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Review Knowledge checkpoint changed')
        const graph = await readCompleteDesignKnowledge(service, {projectId, revision:DesignKnowledgeRevision(revision), limit:100}, abort.signal)
        const result = {project:projectId,checkpoint,graph}
        if (Buffer.byteLength(JSON.stringify(result)) > 64*1024*1024) throw new Error('Review graph exceeds snapshot budget; use bounded context and disclose partial coverage')
        await check()
        if (!await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Review Knowledge checkpoint changed')
        return result
      })
    },
    async publishReview({ checkpoint, sourceCheckpoint = checkpoint, reviewed, producer, observations, retractions, relationVocabulary }) {
      const service = await open()
      return project.mutateKnowledge(async () => {
        await check()
        if (!await sameCheckpoint(checkpoint, await project.store.head())) throw new Error('Review Knowledge checkpoint changed')
        if (!await sameCheckpoint(sourceCheckpoint, checkpoint)) throw new Error('Review Knowledge source checkpoint changed')
        if ((project.kit.relationVocabulary?.revision ?? 'legacy-unavailable')
          !== (relationVocabulary?.revision ?? 'legacy-unavailable')) throw new Error('Review relation vocabulary changed')
        const result = await publishKnowledgeReview({ service, projectId, checkpoint, sourceCheckpoint, reviewed, producer, observations, retractions,
          relationVocabulary, signal: abort.signal })
        await advanceDesignKnowledgePublication(service, checkpoint, result.revision, sameCheckpoint)
        await persistRecords(await readDesignKnowledgePublication(service))
        return result
      })
    },
    async close() {
      if (closed) return
      closed = true; abort.abort(new Error('Companion Knowledge closed'))
      await indexer.close()
      await opening?.catch(() => {})
      await index?.close()
      await provider?.close()
    },
  }
  return api
}
