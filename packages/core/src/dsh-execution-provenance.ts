/** Bounded result projection of existing Host observations, not another execution ledger. */
import { createHash } from 'node:crypto'
import { requireDesignFileRelativePath } from './design-file-path.ts'
import type { DesignExecutionPin } from './design-execution-runtime.ts'
import type { DesignFilesStore } from './design-files.ts'
import type { DesignExecutionAttemptPayload } from './types.ts'

export interface DesignExecutionProvenance {
  readonly source: 'host-observations'
  readonly invocationId: string
  readonly projectId: string
  readonly skill: string
  readonly bundleVersion: string
  readonly stateRevision: string
  readonly rootCallId: string
  readonly parentSessionId: string
  readonly mode: 'main' | 'subagent'
  /** Observation retention is bounded; an empty list never proves no call was attempted. */
  readonly coverage: 'bounded'
  readonly producerRunIds: readonly string[]
  readonly workerAttempts: readonly Readonly<{
    attemptId: string
    phase: DesignExecutionAttemptPayload['phase']
    runId?: string
    artifactFile?: string
  }>[]
  /** Only Host-computed receipts verified against this invocation's accepted publication. */
  readonly integratedWorkerReceipts: readonly Readonly<{
    attemptId: string
    runId: string
    parentRunId: string
    artifactId: string
    path: string
    sha256: string
    bytes: number
  }>[]
  readonly diagnostics: readonly string[]
}

const RECEIPT_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  attemptId: { type: 'string', required: true }, runId: { type: 'string', required: true },
  parentRunId: { type: 'string', required: true }, artifactId: { type: 'string', required: true },
  path: { type: 'string', required: true }, sha256: { type: 'string', required: true },
  bytes: { type: 'integer', required: true },
} } as const

export const DESIGN_EXECUTION_PROVENANCE_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    source: { type: 'string', const: 'host-observations', required: true },
    invocationId: { type: 'string', required: true }, rootCallId: { type: 'string', required: true },
    projectId: { type: 'string', required: true }, skill: { type: 'string', required: true },
    bundleVersion: { type: 'string', required: true }, stateRevision: { type: 'string', required: true },
    parentSessionId: { type: 'string', required: true },
    mode: { type: 'string', enum: ['main', 'subagent'], required: true },
    coverage: { type: 'string', const: 'bounded', required: true },
    producerRunIds: { type: 'array', items: { type: 'string' }, required: true },
    workerAttempts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      attemptId: { type: 'string', required: true },
      phase: { type: 'string', enum: ['queued', 'working', 'completed', 'failed', 'cancelled'], required: true },
      runId: { type: 'string' }, artifactFile: { type: 'string' },
    } } },
    integratedWorkerReceipts: { type: 'array', items: RECEIPT_SCHEMA, required: true },
    diagnostics: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

function stringValues(value: unknown, target: Set<string>): void {
  if (typeof value === 'string') target.add(value)
  else if (Array.isArray(value)) for (const item of value) stringValues(item, target)
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) stringValues(item, target)
}

/** Read only the exact accepted commit; never infer execution from a model assessment or current HEAD. */
export async function projectDesignExecutionProvenance(request: {
  readonly pin: DesignExecutionPin
  readonly rootCallId: string
  readonly parentSessionId: string
  readonly mode: 'main' | 'subagent'
  readonly observations: readonly DesignExecutionAttemptPayload[]
  readonly publicationAccepted: boolean
  readonly files: Pick<DesignFilesStore, 'readPublishedExecutionAt' | 'readBytesAt'>
  readonly limits: Readonly<{ maxFileCount: number; maxFileBytes: number; maxTotalBytes: number }>
  readonly signal: AbortSignal
}): Promise<DesignExecutionProvenance> {
  const { pin } = request
  const observations = request.observations.filter(row => row.projectId === String(pin.projectId)
    && row.invocationId === String(pin.invocationId) && row.rootCallId === request.rootCallId && row.skill === pin.skillName)
  const producerRunIds = [...new Set(observations.filter(row => row.role === 'producer'
    && row.parentRunId === request.parentSessionId && row.runId !== undefined).map(row => row.runId!))]
  const histories = new Map<string, DesignExecutionAttemptPayload[]>()
  const latestPath = new Map<string, string>()
  for (const row of observations) {
    if (row.role !== 'worker') continue
    const history = histories.get(row.attemptId) ?? []
    history.push(row)
    histories.set(row.attemptId, history)
    if (row.artifactFile !== undefined) latestPath.set(row.artifactFile, row.attemptId)
  }
  const diagnostics: string[] = []
  const receipts: DesignExecutionProvenance['integratedWorkerReceipts'][number][] = []
  const workerAttempts = [...histories.values()].map(history => {
    const last = history.at(-1)!
    return Object.freeze({ attemptId: last.attemptId, phase: last.phase,
      ...(last.runId === undefined ? {} : { runId: last.runId }),
      ...(last.artifactFile === undefined ? {} : { artifactFile: last.artifactFile }) })
  })
  const result = (): DesignExecutionProvenance => Object.freeze({
    source: 'host-observations', invocationId: String(pin.invocationId), rootCallId: request.rootCallId,
    projectId: String(pin.projectId), skill: pin.skillName, bundleVersion: String(pin.bundleVersion), stateRevision: pin.stateRevision,
    parentSessionId: request.parentSessionId, mode: request.mode, coverage: 'bounded',
    producerRunIds: Object.freeze(producerRunIds), workerAttempts: Object.freeze(workerAttempts),
    integratedWorkerReceipts: Object.freeze(receipts), diagnostics: Object.freeze(diagnostics),
  })
  if (workerAttempts.length === 0) {
    diagnostics.push('No admitted Worker attempt is present in the retained Host observations. Pre-admission rejections and missing/truncated observations are not proof that no delegation call was attempted.')
    return result()
  }
  if (!request.publicationAccepted) {
    diagnostics.push('No accepted publication belongs to this terminal result; no Worker receipt is certified as integrated.')
    return result()
  }
  try {
    request.signal.throwIfAborted()
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(pin.stateRevision)) throw new Error('Receipt verification requires a full immutable commit id')
    const publication = await request.files.readPublishedExecutionAt(pin.stateRevision, request.signal)
    if (publication?.invocationId !== String(pin.invocationId) || publication.skill !== pin.skillName
      || publication.bundleVersion !== String(pin.bundleVersion)
      || (publication.outcome !== undefined && !['complete', 'pause'].includes(publication.outcome))) {
      throw new Error('Accepted commit has no matching invocation/Bundle publication authority')
    }
    const canonical = await request.files.readBytesAt(pin.stateRevision, `${pin.skillName}/${pin.skillName}.json`, request.signal, request.limits.maxFileBytes)
    if (canonical === undefined) throw new Error('Accepted canonical state is unavailable')
    if (canonical.byteLength > request.limits.maxTotalBytes) throw new Error('Canonical verification exceeds the configured read budget')
    const references = new Set<string>()
    stringValues(JSON.parse(Buffer.from(canonical).toString('utf8')), references)
    let totalBytes = canonical.byteLength, fileCount = 1
    for (const history of histories.values()) {
      const last = history.at(-1)!
      const receipt = last.receipt
      if (last.phase !== 'completed' || receipt === undefined) continue
      try {
        requireDesignFileRelativePath(receipt.path)
        if (last.runId === undefined || last.runId.trim() === '' || last.parentRunId === undefined || last.parentRunId.trim() === ''
          || last.attemptId.trim() === '' || last.artifactFile !== receipt.path
          || !receipt.path.startsWith(`${pin.skillName}/`) || receipt.path === `${pin.skillName}/${pin.skillName}.json`
          || !/^[a-f0-9]{64}$/u.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0
          || latestPath.get(receipt.path) !== last.attemptId
          || !history.some(row => row.phase === 'working' && row.runId === last.runId && row.parentRunId === last.parentRunId)
          || history.some(row => row.role !== 'worker' || row.artifactFile !== last.artifactFile
            || row.artifactId !== last.artifactId || row.artifactKind !== last.artifactKind
            || row.parentRunId !== last.parentRunId || (row.runId !== undefined && row.runId !== last.runId))
          || !(request.mode === 'main' ? last.parentRunId === request.parentSessionId : producerRunIds.includes(last.parentRunId))) {
          throw new Error('Worker identity, lifecycle, current attempt or Host receipt is not established')
        }
        if (!references.has(receipt.path)) throw new Error('Receipt path is not referenced by the accepted canonical state')
        if (++fileCount > request.limits.maxFileCount || receipt.bytes > request.limits.maxFileBytes
          || totalBytes + receipt.bytes > request.limits.maxTotalBytes) throw new Error('Receipt verification exceeds the configured read budget')
        const bytes = await request.files.readBytesAt(pin.stateRevision, receipt.path, request.signal, receipt.bytes)
        totalBytes += receipt.bytes
        if (bytes === undefined || bytes.byteLength !== receipt.bytes
          || createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) {
          throw new Error('Published artifact bytes do not match the Host-computed Worker receipt')
        }
        receipts.push(Object.freeze({ attemptId: last.attemptId, runId: last.runId, parentRunId: last.parentRunId,
          artifactId: last.artifactId, path: receipt.path, sha256: receipt.sha256, bytes: receipt.bytes }))
      } catch (error) {
        diagnostics.push(`Worker attempt ${JSON.stringify(last.attemptId)} is not certified: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    diagnostics.push(`Execution provenance unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  return result()
}

/** No free-form design assessment can establish a successful Worker execution. */
export function renderDesignExecutionProvenance(provenance?: DesignExecutionProvenance): string {
  const receipts = provenance?.integratedWorkerReceipts ?? []
  return [
    'Execution provenance (Host observations and accepted publication, not a model assessment):',
    ...(provenance === undefined ? ['Unavailable for this result.'] : [JSON.stringify(provenance)]),
    receipts.length === 0
      ? 'No verified integrated Worker completion receipt is available. Do not report Worker execution as successful; absence of a receipt does not establish whether a delegation call was attempted or rejected.'
      : `Verified integrated Worker completion receipts: ${receipts.length}. Report only these exact attempts and paths as Worker-produced.`,
    'A published Bundle or a model-generated clarity summary does not prove that a Worker ran. Do not repeat execution or delegation claims from the design assessment; Host execution provenance takes precedence.',
  ].join('\n')
}
