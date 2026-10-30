/** Trusted live parent -> existing S2 capability -> H2. No storage or model client. */
import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'
import { normalizeStudioInstanceChanges, type StudioInstanceCandidate } from 'dsh-design-studio'
import { createStudioAuthoring } from 'dsh-design-studio/node'
import { createStudioAuthoringAgent } from './authoring-agent.ts'
import type { StudioAuthoringReference, StudioAuthoringScope } from './authoring-agent.types.ts'
import type { StudioAuthoringSession, StudioAuthoringSessionOptions, StudioSessionPrepared, StudioSessionRun,
  StudioSessionStart, StudioSessionResume } from './authoring-session.types.ts'
export type * from './authoring-session.types.ts'

const clone = <T>(value: T): T => structuredClone(value)
const samePin = (a: { name: string; version: string } | undefined, b: { name: string; version: string } | undefined) => a?.name === b?.name && a?.version === b?.version
const key = (ref: StudioAuthoringReference) => `${ref.sessionId}:${ref.epoch}`

/** Snapshot all caller intent before the first native or source await. */
function snapshot(request: StudioSessionStart) {
  const { invocationId, prompt, signal, onPrepared } = request
  assert.ok(typeof invocationId === 'string' && invocationId.length > 0 && invocationId.length <= 128, 'An exact invocation identity is required')
  assert.ok(typeof prompt === 'string' && prompt.trim() && Buffer.byteLength(prompt) <= 128 * 1024, 'A bounded new authoring prompt is required')
  assert.ok(onPrepared === undefined || typeof onPrepared === 'function')
  assert.ok(Array.isArray(request.paths), 'Select source paths in this working copy')
  const normalized = normalizeStudioInstanceChanges({ id: request.id, expectedRevision: request.expectedRevision,
    changes: request.paths.map(path => ({ path, content: '' })), ...(request.bundle ? { bundle: request.bundle } : {}) })
  return Object.freeze({ invocationId, prompt, signal, onPrepared, id: normalized.id, expectedRevision: normalized.expectedRevision,
    paths: Object.freeze(normalized.changes.map(change => change.path)), ...(normalized.bundle ? { bundle: normalized.bundle } : {}) })
}

export function createStudioAuthoringSession(options: StudioAuthoringSessionOptions): StudioAuthoringSession {
  const { ctx, parent, instances, readComponents, workspaceRoot, retainReference } = options
  assert.ok(isAbsolute(workspaceRoot), 'A trusted isolated workspace is required')
  assert.equal(typeof retainReference, 'function', 'The caller must retain native references before dispatch')
  assert.ok(ctx.agents.get(parent.id) === parent, 'The exact native authoring parent is disconnected')
  const source = { read: instances.read.bind(instances), readFile: instances.readFile.bind(instances), prepareChanges: instances.prepareChanges.bind(instances) }
  const native = createStudioAuthoringAgent(ctx), lifetime = new AbortController()
  // Ephemeral native handles only. Parent identity always comes from ctx.agents;
  // retained/cold references and all source/candidate authority remain external.
  const owned = new Map<string, StudioSessionRun>()
  const parentIsLive = () => assert.ok(ctx.agents.get(parent.id) === parent, 'The exact native authoring parent is disconnected')
  const active = () => { lifetime.signal.throwIfAborted(); parentIsLive() }
  parentIsLive()
  const referenceForParent = (value: StudioAuthoringReference) => {
    const ref = clone(value)
    assert.equal(ref.parentSessionId, String(parent.id), 'Authoring reference belongs to another native parent')
    return ref
  }
  const ownedRun = (value: StudioAuthoringReference) => {
    active()
    const ref = referenceForParent(value), run = owned.get(key(ref))
    assert.ok(run, 'No exact owned authoring run; cold references permit observation only')
    assert.deepEqual(ref, run.reference, 'Authoring reference differs from the exact owned run')
    return run
  }
  const observe = async (value: StudioAuthoringReference) => {
    parentIsLive()
    const ref = referenceForParent(value), result = await native.observe(ref)
    parentIsLive()
    return result
  }
  // Metadata reads acquire no native resource. Closing revokes their admission
  // promptly, consumes late settlements and lets H2 drain its own native handles.
  const readCurrent = (id: string, signal: AbortSignal) => new Promise<Awaited<ReturnType<typeof source.read>>>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return source.read({ id }) }).then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
  const project = (value: unknown, scope: StudioAuthoringScope): StudioSessionPrepared => {
    // The value can only originate from our S2 prepare port, after H2's exact
    // tools/result guard. Check correlation, without reimplementing S1 validation.
    assert.ok(value && typeof value === 'object')
    const raw = value as { scope: unknown; request: Parameters<typeof normalizeStudioInstanceChanges>[0]; candidate: StudioInstanceCandidate }
    assert.deepEqual(raw.scope, scope, 'Prepared scope differs from the native binding')
    const request = normalizeStudioInstanceChanges(raw.request), candidate = raw.candidate
    assert.deepEqual(request, raw.request)
    assert.equal(request.id, scope.id); assert.equal(request.expectedRevision, scope.expectedRevision)
    assert.ok(samePin(request.bundle, scope.bundle))
    assert.equal(candidate.id, scope.id); assert.equal(candidate.baseRevision, scope.expectedRevision)
    assert.equal(candidate.revision, scope.expectedRevision + 1)
    assert.ok(/^[a-f0-9]{64}$/.test(candidate.digest))
    return clone({ request, candidate })
  }
  const begin = async (input: StudioSessionStart, previous?: StudioAuthoringReference): Promise<StudioSessionRun> => {
    active()
    const request = snapshot(input), prior = previous === undefined ? undefined : referenceForParent(previous)
    const signal = request.signal ? AbortSignal.any([request.signal, lifetime.signal]) : lifetime.signal
    signal.throwIfAborted()
    if (prior) assert.equal(prior.scope.id, request.id, 'Resume cannot select another working copy')
    const record = await readCurrent(request.id, signal)
    active(); signal.throwIfAborted()
    assert.equal(record.id, request.id); assert.equal(record.revision, request.expectedRevision, 'Working copy changed; reopen before authoring')
    assert.ok(record.recordVersion === 2 && !record.deletedAt && Array.isArray(record.files), 'Select a current complete-source working copy')
    for (const path of request.paths) assert.ok(!record.files.some(file => file.path === path && !file.editable), 'Select an editable source path in this exact working copy')
    const bundle = record.kind === 'bundle' ? record.bundle : request.bundle
    assert.ok(record.kind === 'bundle' ? bundle && (request.bundle === undefined || samePin(request.bundle, bundle))
      : bundle === undefined || record.mounts.some(mount => samePin(mount.bundle, bundle)), 'Select the exact Bundle or an explicit mounted Bundle for this Kit')
    // Kit-owned files exist independently of a mounted Bundle. The inventory
    // and S2 read/prepare ports above keep those paths in this exact source copy;
    // a real Panel preview still requires an explicit mounted Bundle pin.
    const scope = Object.freeze({ id: record.id, expectedRevision: record.revision, allowedPaths: request.paths,
      ...(bundle ? { bundle: Object.freeze({ ...bundle }) } : {}) })
    const capability = createStudioAuthoring({ scope, instances: source, readComponents })
    const nativeRequest = { parent, invocationId: request.invocationId, workspaceRoot, scope, prompt: request.prompt, signal,
      ports: { read: (input?: { paths?: string[] }) => capability.read(input), prepare: (input: { changes: { path: string; content: string }[] }) => capability.prepare(input) },
      onReference: async (value: StudioAuthoringReference) => {
        active(); assert.deepEqual(value.scope, scope); referenceForParent(value)
        await retainReference(clone(value))
        active()
      },
      onPrepared: (value: unknown) => { active(); return request.onPrepared?.(project(value, scope)) },
    }
    const run = prior ? await native.resume({ ...nativeRequest, previous: prior, explicit: true }) : await native.start(nativeRequest)
    try { active(); signal.throwIfAborted() }
    catch (error) { await run.dispose(); throw error }
    const wrapped: StudioSessionRun = Object.freeze({ reference: run.reference, result: run.result,
      observe: () => observe(run.reference), cancel: (input: { readonly expectedTurn: number | null }) => {
        active(); return run.cancel({ expectedTurn: input.expectedTurn })
      }, readPrepared: () => { active(); const value = run.readPrepared(); return value === undefined ? undefined : project(value, scope) },
    })
    owned.set(key(run.reference), wrapped)
    return wrapped
  }
  const dispose = () => { lifetime.abort(new Error('Studio authoring session is disposed')); return native.dispose() }
  ctx.effect(() => dispose)
  return Object.freeze({ start: (request: StudioSessionStart) => begin(request), resume: (request: StudioSessionResume) => {
    assert.equal(request.explicit, true, 'Resume requires explicit authorization and a new prompt')
    return begin(request, request.previous)
  }, observe, cancel: (ref: StudioAuthoringReference, input: { readonly expectedTurn: number | null }) => ownedRun(ref).cancel(input),
  readPrepared: (ref: StudioAuthoringReference) => ownedRun(ref).readPrepared(), dispose })
}
