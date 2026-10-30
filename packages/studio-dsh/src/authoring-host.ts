/** Host-only composition. S2 owns source/save, S5a addresses, S4 native execution. */
import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createStudioInstances, type StudioInstances } from 'dsh-design-studio/node'
import { createDshStudioInstanceAdapters, registerDshStudioCurrentKitSource } from './authoring-sources.ts'
import { createStudioAuthoringReferenceStore } from './authoring-reference-store.ts'
import { createStudioAuthoringSession } from './authoring-session.ts'
import { createDshStudioContent, type DshStudioContent } from './authoring-content.ts'
import type { StudioAuthoringSession, StudioSessionRun, StudioSessionStart } from './authoring-session.types.ts'
import type { DshStudioAuthoringHost, DshStudioAuthoringHostOptions, DshStudioAuthoringParent, StudioAuthoringAddress, StudioPreparedLocator, StudioPreparedProjection } from './authoring-host.types.ts'
export type * from './authoring-host.types.ts'

const INSTANCE_METHODS = ['read', 'list', 'listBundles', 'copy', 'editCurrent', 'captureKit', 'loadKit', 'create', 'importSources', 'rename', 'remove', 'readFile', 'readMountedBundle', 'saveFile', 'prepareChanges',
  'saveChanges', 'updateMounts', 'preview', 'migrate', 'exportArchive'] as const satisfies readonly (keyof StudioInstances)[]
// Explicitly forwarding every public port must stay exhaustive as S2 evolves.
const _allInstanceMethods: Exclude<keyof StudioInstances, typeof INSTANCE_METHODS[number]> extends never ? true : never = true
void _allInstanceMethods
const addressOf = (value: StudioAuthoringAddress): StudioAuthoringAddress => ({ sessionId: value.sessionId, epoch: value.epoch })
const MAX_PREPARED_PROJECTIONS = 16
const MAX_PREPARED_BYTES = 32 * 1024 * 1024
const snapshot = (request: StudioSessionStart): StudioSessionStart => ({ ...request,
  paths: structuredClone(request.paths), ...(request.bundle === undefined ? {} : { bundle: structuredClone(request.bundle) }) })

export async function createDshStudioAuthoringHost(options: DshStudioAuthoringHostOptions): Promise<DshStudioAuthoringHost> {
  const { ctx, design, fs, stateRoot, workspaceRoot, readComponents } = options
  assert.ok(typeof workspaceRoot === 'string' && isAbsolute(workspaceRoot), 'An explicit Host-owned workspaceRoot is required')
  assert.equal(typeof readComponents, 'function', 'The actual component catalog is required')
  // Validate the explicit private root before S2 can create its own namespaces.
  const references = await createStudioAuthoringReferenceStore({ stateRoot })
  const shared = await createStudioInstances({ stateRoot, ...createDshStudioInstanceAdapters({ design, fs }) })
  const content = await createDshStudioContent({ instances: shared })
  const stopCurrentSource = registerDshStudioCurrentKitSource(design, shared)
  const parents = new Map<Agent, DshStudioAuthoringParent>()
  const closing = new Set<Promise<void>>(), cleanupFailures = new Set<unknown>()
  let closed = false, disposing: Promise<void> | undefined
  const active = () => assert.ok(!closed, 'Studio authoring Host is disposed')
  const exact = (parent: Agent) => assert.ok(parent && ctx.agents.get(parent.id) === parent, 'The exact native authoring parent is disconnected')
  const remember = (promise: Promise<void>) => {
    closing.add(promise)
    void promise.then(() => closing.delete(promise), error => { closing.delete(promise); cleanupFailures.add(error) })
    return promise
  }
  const forParent = (parent: Agent): DshStudioAuthoringParent => {
    active(); exact(parent)
    const existing = parents.get(parent)
    if (existing) return existing
    let parentClosed = false, parentDisposing: Promise<void> | undefined
    const admitted = new Set<Promise<void>>()
    const guard = () => { active(); assert.ok(!parentClosed, 'Studio authoring parent facade is disposed'); exact(parent) }
    const admit = async <T>(operation: () => T | Promise<T>): Promise<T> => {
      guard()
      let settle!: () => void
      const pending = new Promise<void>(resolve => { settle = resolve }); admitted.add(pending)
      try { const value = await operation(); guard(); return value }
      finally { admitted.delete(pending); settle() }
    }
    const instances = Object.freeze(Object.fromEntries(INSTANCE_METHODS.map(name => [name, (...args: unknown[]) => {
      const captured = structuredClone(args)
      return admit(() => Reflect.apply(shared[name], shared, captured))
    }]))) as unknown as StudioInstances
    // These are bounded receipts from S2, not persisted candidates or source state.
    // A same-ID replacement parent never inherits this live object's projections.
    const prepared = new Map<string, { value: StudioPreparedProjection; bytes: number; key: string }>()
    let preparedBytes = 0
    const pin = (value: { name: string; version: string } | undefined) => value === undefined ? undefined : { name: value.name, version: value.version }
    const targetFor = (record: Awaited<ReturnType<StudioInstances['read']>>, request: Parameters<StudioInstances['prepareChanges']>[0]) => {
      assert.equal(record.id, request.id)
      assert.equal(record.revision, request.expectedRevision, 'Working copy changed; reopen before reviewing')
      const bundle = record.kind === 'bundle' ? record.bundle : request.bundle
      if (record.kind === 'bundle' && request.bundle) assert.deepEqual(pin(request.bundle), pin(record.bundle), 'Candidate Bundle pin changed')
      if (record.kind === 'kit' && bundle) assert.ok(record.mounts.some(mount => JSON.stringify(pin(mount.bundle)) === JSON.stringify(pin(bundle))), 'Candidate Bundle is not mounted in this Kit')
      return { id: record.id, expectedRevision: record.revision, ...(bundle ? { bundle: pin(bundle) } : {}) }
    }
    const prepareChanges: DshStudioAuthoringParent['prepareChanges'] = request => {
      const captured = structuredClone(request)
      return admit(async () => {
        const candidate = await instances.prepareChanges(captured)
        const target = targetFor(await instances.read({ id: captured.id }), captured)
        guard()
        const key = JSON.stringify({ request: captured, digest: candidate.digest, target })
        const previous = [...prepared.values()].find(row => row.key === key)
        if (previous) return structuredClone(previous.value)
        const value: StudioPreparedProjection = { locator: { requestId: randomUUID(), ...target, digest: candidate.digest },
          prepared: { request: captured, candidate } }
        const bytes = Buffer.byteLength(JSON.stringify(value)) + Buffer.byteLength(key)
        assert.ok(bytes <= MAX_PREPARED_BYTES, 'Prepared candidate exceeds the temporary review budget')
        while (prepared.size >= MAX_PREPARED_PROJECTIONS || preparedBytes + bytes > MAX_PREPARED_BYTES) {
          const oldest = prepared.keys().next().value!
          preparedBytes -= prepared.get(oldest)!.bytes; prepared.delete(oldest)
        }
        prepared.set(value.locator.requestId, { value: structuredClone(value), bytes, key }); preparedBytes += bytes
        return structuredClone(value)
      })
    }
    const readConversationPrepared = (locator: StudioPreparedLocator) => admit(async () => {
      const row = prepared.get(locator.requestId)
      assert.ok(row, 'No prepared candidate for this exact live parent and request')
      assert.deepEqual(locator, row.value.locator, 'Prepared candidate locator or Bundle pin changed')
      const { request, candidate } = row.value.prepared
      const { requestId: _requestId, digest: _digest, ...target } = locator
      assert.deepEqual(targetFor(await instances.read({ id: request.id }), request), target, 'Prepared candidate source pin changed')
      // S1/S2 revalidate the current source and exact digest. No cached result saves.
      const current = await instances.prepareChanges(request)
      assert.equal(current.digest, candidate.digest, 'Prepared candidate digest changed')
      return structuredClone(row.value.prepared)
    })
    let session!: StudioAuthoringSession
    // Group S4's own effects under this disposable scope; no private Agent hook
    // or secondary registry. Releasing it cannot call this facade recursively.
    const release = ctx.effect(() => {
      session = createStudioAuthoringSession({ ctx, parent, instances, workspaceRoot,
        readComponents: () => admit(() => readComponents()),
        retainReference: reference => admit(async () => {
          assert.equal(reference.parentSessionId, String(parent.id))
          await references.retain(reference)
        }),
      })
      return () => { parentClosed = true; prepared.clear(); preparedBytes = 0; return session.dispose() }
    }, 'studio-authoring-parent')
    const readReference = (address: StudioAuthoringAddress) => {
      const key = addressOf(address)
      return admit(() => references.read({ ...key, parentSessionId: String(parent.id) }))
    }
    const retained = async (address: StudioAuthoringAddress) => {
      const reference = await readReference(address)
      guard(); assert.ok(reference, 'No retained Studio native address for this exact parent')
      return reference
    }
    let facade!: DshStudioAuthoringParent
    const wrap = (run: StudioSessionRun): StudioSessionRun => {
      const address = addressOf(run.reference)
      // Preserve the original native result, including unknown/rejected cleanup.
      // H2 already consumes its rejection; callers may still await that outcome.
      return Object.freeze<StudioSessionRun>({ reference: structuredClone(run.reference), result: run.result,
        observe: () => facade.observe(address), cancel: input => facade.cancel(address, input),
        readPrepared: () => { guard(); return run.readPrepared() },
      })
    }
    const disposeParent = (): Promise<void> => {
      if (parentDisposing) return parentDisposing
      parentClosed = true
      prepared.clear(); preparedBytes = 0
      // Revoke first and start S4 cancellation BEFORE joining pending calls.
      const stop = Promise.resolve().then(() => session.dispose())
      const unregister = Promise.resolve().then(() => release())
      parentDisposing = remember(Promise.allSettled([stop, unregister, ...admitted]).then(results => {
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
        if (failures.length) throw new AggregateError([...new Set(failures)], 'Studio parent cleanup failed')
      }))
      return parentDisposing
    }
    const guardedContent: DshStudioContent = Object.freeze({
      readArchive: input => { const captured = structuredClone(input); return admit(() => content.readArchive(captured)) },
      exportContentArchive: input => { const captured = structuredClone(input); return admit(() => content.exportContentArchive(captured)) },
    })
    facade = Object.freeze<DshStudioAuthoringParent>({ instances, content: guardedContent, prepareChanges, readReference,
      listReferences: () => admit(() => references.list({ parentSessionId: String(parent.id) })),
      start: request => { const captured = snapshot(request); return admit(async () => wrap(await session.start(captured))) },
      resume: request => {
        const captured = snapshot(request), previous = addressOf(request.previous), explicit = request.explicit
        return admit(async () => { const reference = await retained(previous); guard(); return wrap(await session.resume({ ...captured, previous: reference, explicit })) })
      },
      observe: address => { const key = addressOf(address); return admit(async () => { const reference = await retained(key); guard(); return session.observe(reference) }) },
      cancel: (address, input) => {
        const key = addressOf(address), expectedTurn = input.expectedTurn
        return admit(async () => { const reference = await retained(key); guard(); return session.cancel(reference, { expectedTurn }) })
      },
      readPrepared: address => {
        if ('requestId' in address) return readConversationPrepared(structuredClone(address))
        const key = addressOf(address); return admit(async () => { const reference = await retained(key); guard(); return session.readPrepared(reference) })
      },
      dispose: disposeParent,
    })
    parents.set(parent, facade)
    return facade
  }
  // SDK's public disposal event supplies the actual object, not a guessed ID.
  const stopListening = ctx.on('agent/disposed', ({ agent }) => {
    const facade = parents.get(agent)
    if (!facade) return
    parents.delete(agent)
    return facade.dispose()
  })
  const dispose = (): Promise<void> => {
    if (disposing) return disposing
    closed = true
    const stops = [...parents.values()].map(facade => facade.dispose())
    parents.clear()
    disposing = Promise.allSettled([Promise.resolve().then(() => stopListening()), Promise.resolve().then(() => stopCurrentSource()), ...stops, ...closing]).then(results => {
      const failures = new Set([...cleanupFailures, ...results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)])
      if (failures.size) throw new AggregateError([...failures], 'Studio authoring Host cleanup failed')
    })
    void disposing.catch(() => {})
    return disposing
  }
  ctx.effect(() => dispose, 'studio-authoring-host')
  return Object.freeze({ forParent, dispose })
}
