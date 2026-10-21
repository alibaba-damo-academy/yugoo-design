/**
 * The structured clarity report model shared by the `report_design_clarity`
 * tool, the DesignJournal audit fact, the project-scoped clarity.json
 * authority, and the ordinary logged tool result shown to the model and
 * host UI.
 *
 * One report carries the model-authored evidence (summary, U/S/T scores with
 * evidence, optional next gap), exact Kit pin, and any actual optional Host
 * metadata. Native turn/call identity is not required. The project clarity.json carries the latest assessment; the
 * journal fact audits every promotion. The digest lets hosts verify that
 * presentation metadata and the ordinary tool result describe that same
 * record.
 */
import { createHash } from 'node:crypto'
import { DesignKitVersion, DesignClarityDigest, type DesignClarityDimensionInput, type DesignClarityReportedPayload } from './types.ts'

/** Meta discriminator: only this kind is a clarity report payload. */
export const DESIGN_CLARITY_META_KIND = 'design/clarity' as const

/** Meta envelope version understood by the current fold. */
export const DESIGN_CLARITY_META_VERSION = 1 as const

/** Known assessed input, separate from the digest of the score/reasons. */
export type DesignClarityInputIdentity = Pick<DesignClarityReportedPayload,
  'kit' | 'version' | 'scopeDigest' | 'kitContentHash'>

/**
 * Shared reuse/currentness predicate. Project identity and immutable Design
 * evidence are checked by their owning store. Missing pins are unknown, never
 * equal by absence; reading history does not invent the inputs it was based on.
 */
export function designClarityInputMatches(left: DesignClarityInputIdentity, right: DesignClarityInputIdentity): boolean {
  return typeof left.kitContentHash === 'string' && /^[a-f0-9]{64}$/.test(left.kitContentHash)
    && left.kit === right.kit && left.version === right.version
    && left.kitContentHash === right.kitContentHash
}

/** Safety ceilings, not brevity requirements. Preserve ordinary long evidence verbatim. */
export const DESIGN_CLARITY_TEXT_LIMITS = Object.freeze({
  summaryMaxBytes: 65_536,
  evidenceMaxBytes: 65_536,
  nextGapMaxBytes: 65_536,
})

/**
 * Canonical JSON with sorted keys; the exact encoding the digest hashes and
 * the journal idempotency checks compare. Unsupported leaves fail loud:
 * JSON.stringify would silently emit `undefined` for them.
 */
function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`design clarity report: canonical encoding does not support ${value === undefined ? 'undefined' : typeof value}`)
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** The assessed content the digest commits to (identity fields excluded). */
function digestContent(input: {
  readonly summary: string
  readonly u: DesignClarityDimensionInput
  readonly s: DesignClarityDimensionInput
  readonly t: DesignClarityDimensionInput
  readonly nextGap?: string
}, kit: string, version: DesignKitVersion): Record<string, unknown> {
  return {
    kit,
    version: String(version),
    summary: input.summary,
    u: { score: input.u.score, evidence: input.u.evidence },
    s: { score: input.s.score, evidence: input.s.evidence },
    t: { score: input.t.score, evidence: input.t.evidence },
    ...(input.nextGap === undefined ? {} : { nextGap: input.nextGap }),
  }
}

/**
 * Compute the stable identity of one exact clarity report.
 * @param input - validated report content.
 * @param kit - active Kit family at assessment time.
 * @param version - exact active Kit version at assessment time.
 * @returns the lowercase SHA-256 hex digest.
 */
export function designClarityDigest(
  input: { readonly summary: string; readonly u: DesignClarityDimensionInput; readonly s: DesignClarityDimensionInput; readonly t: DesignClarityDimensionInput; readonly nextGap?: string },
  kit: string,
  version: DesignKitVersion,
): DesignClarityDigest {
  return DesignClarityDigest(createHash('sha256').update(canonicalJson(digestContent(input, kit, version)), 'utf8').digest('hex'))
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected a plain object`)
  }
  return value as Record<string, unknown>
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path}: expected non-empty text`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${path}: exceeds ${maxBytes} UTF-8 bytes`)
  return value
}

function dimensionInput(value: unknown, path: string): DesignClarityDimensionInput {
  const data = plainObject(value, path)
  const keys = Object.keys(data)
  if (keys.length !== 2 || !keys.includes('score') || !keys.includes('evidence')) {
    throw new Error(`${path}: expected exactly score and evidence`)
  }
  const score = data.score
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(`${path}.score: expected an integer from 0 to 100`)
  }
  return Object.freeze({ score, evidence: boundedText(data.evidence, `${path}.evidence`, DESIGN_CLARITY_TEXT_LIMITS.evidenceMaxBytes) })
}

/**
 * Strictly parse one complete clarity report payload at the journal or
 * projection boundary. The digest is recomputed from the parsed content and
 * compared against the claimed value — a mismatch fails loud.
 * @param value - untrusted report payload (journal fact data or meta slice).
 * @returns the frozen validated payload.
 */
export function parseDesignClarityReported(value: unknown): DesignClarityReportedPayload {
  const data = plainObject(value, '$')
  const keys = Object.keys(data).sort()
  const required = ['digest', 'kit', 'version', 's', 'summary', 't', 'u']
  const missing = required.filter((field) => !Object.hasOwn(data, field))
  const extra = keys.filter((field) => !required.includes(field) && !['callId', 'turn', 'nextGap', 'origin', 'scopeDigest', 'kitContentHash'].includes(field))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`design clarity report: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
  const digest = boundedText(data.digest, '$.digest', 64)
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('$.digest: expected lowercase SHA-256 hex')
  const turn = data.turn
  if (turn !== undefined && (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0)) {
    throw new Error('$.turn: expected a non-negative safe integer')
  }
  const callId = data.callId === undefined ? undefined : boundedText(data.callId, '$.callId', 512)
  const origin = data.origin === undefined ? undefined : data.origin
  if (origin !== undefined && origin !== 'main-agent' && origin !== 'evaluator') {
    throw new Error('$.origin: expected main-agent or evaluator')
  }
  const scopeDigest = data.scopeDigest
  if (scopeDigest !== undefined && (typeof scopeDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(scopeDigest))) {
    throw new Error('$.scopeDigest: expected lowercase SHA-256 hex')
  }
  const kitContentHash = data.kitContentHash
  if (kitContentHash !== undefined && (typeof kitContentHash !== 'string' || !/^[0-9a-f]{64}$/u.test(kitContentHash))) {
    throw new Error('$.kitContentHash: expected lowercase SHA-256 hex')
  }
  const kit = boundedText(data.kit, '$.kit', 256)
  const version = DesignKitVersion(boundedText(data.version, '$.version', 64))
  const summary = boundedText(data.summary, '$.summary', DESIGN_CLARITY_TEXT_LIMITS.summaryMaxBytes)
  const u = dimensionInput(data.u, '$.u')
  const s = dimensionInput(data.s, '$.s')
  const t = dimensionInput(data.t, '$.t')
  const nextGap = data.nextGap === undefined
    ? undefined
    : boundedText(data.nextGap, '$.nextGap', DESIGN_CLARITY_TEXT_LIMITS.nextGapMaxBytes)
  const expected = designClarityDigest({ summary, u, s, t, ...(nextGap === undefined ? {} : { nextGap }) }, kit, version)
  if (expected !== digest) {
    throw new Error('design clarity report: digest does not match the assessed content')
  }
  return Object.freeze({
    digest: DesignClarityDigest(digest),
    ...(origin === undefined ? {} : { origin }),
    ...(scopeDigest === undefined ? {} : { scopeDigest }),
    ...(kitContentHash === undefined ? {} : { kitContentHash }),
    ...(turn === undefined ? {} : { turn: turn as number }),
    ...(callId === undefined ? {} : { callId }),
    kit,
    version,
    summary,
    u,
    s,
    t,
    ...(nextGap === undefined ? {} : { nextGap }),
  })
}

/**
 * Strictly validate one `tool/result` meta payload. Foreign meta kinds are
 * skipped (undefined); a report with the right kind that fails validation or
 * whose digest does not match its content fails loud.
 * @param meta - the opaque tool-private payload of one `tool/result` event.
 * @returns the frozen report payload, or undefined for non-clarity meta.
 */
export function parseDesignClarityMeta(meta: unknown): DesignClarityReportedPayload | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const candidate = meta as Record<string, unknown>
  if (candidate.kind !== DESIGN_CLARITY_META_KIND) return undefined
  const required = ['digest', 'kit', 'version', 's', 'summary', 't', 'u', 'v', 'kind']
  const allowed = [...required, 'callId', 'turn', 'nextGap', 'origin', 'scopeDigest', 'kitContentHash']
  const keys = Object.keys(candidate)
  const missing = required.filter((field) => !Object.hasOwn(candidate, field))
  const extra = keys.filter((field) => !allowed.includes(field))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`design clarity meta: invalid envelope keys (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
  if (candidate.v !== DESIGN_CLARITY_META_VERSION) {
    throw new Error(`design clarity meta: unsupported envelope version ${JSON.stringify(candidate.v)}`)
  }
  const report = parseDesignClarityReported({
    digest: candidate.digest,
    turn: candidate.turn,
    callId: candidate.callId,
    kit: candidate.kit,
    version: candidate.version,
    summary: candidate.summary,
    u: candidate.u,
    s: candidate.s,
    t: candidate.t,
    ...(candidate.origin === undefined ? {} : { origin: candidate.origin }),
    ...(candidate.scopeDigest === undefined ? {} : { scopeDigest: candidate.scopeDigest }),
    ...(candidate.kitContentHash === undefined ? {} : { kitContentHash: candidate.kitContentHash }),
    ...(candidate.nextGap === undefined ? {} : { nextGap: candidate.nextGap }),
  })
  return report
}

/** Strictly parse model-authored clarity content before host identity is attached. */
export function parseDesignClarityInput(value: unknown): import('./types.ts').DesignClarityInput {
  const data = plainObject(value, '$')
  const required = ['s', 'summary', 't', 'u']
  const keys = Object.keys(data)
  const missing = required.filter(field => !Object.hasOwn(data, field))
  const extra = keys.filter(field => !required.includes(field) && field !== 'nextGap')
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`design clarity input: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
  const summary = boundedText(data.summary, '$.summary', DESIGN_CLARITY_TEXT_LIMITS.summaryMaxBytes)
  const u = dimensionInput(data.u, '$.u')
  const s = dimensionInput(data.s, '$.s')
  const t = dimensionInput(data.t, '$.t')
  const nextGap = data.nextGap === undefined
    ? undefined
    : boundedText(data.nextGap, '$.nextGap', DESIGN_CLARITY_TEXT_LIMITS.nextGapMaxBytes)
  return Object.freeze({ summary, u, s, t, ...(nextGap === undefined ? {} : { nextGap }) })
}
