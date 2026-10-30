/** Strict JSON projections for an explicitly enabled, native-parent-scoped service. */
import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import type { StudioInstanceCandidate, StudioInstanceChangeReceipt, StudioPanelPreview, StudioDiagnostic, StudioContentArchive } from 'dsh-design-studio'
import type { StudioInstanceDescription, StudioInstanceMount, StudioInstanceBundleChoice } from 'dsh-design-studio/node'
import type { StudioAuthoringReference, StudioAuthoringObservation, StudioAuthoringScope } from './authoring-agent.types.ts'

const text = z.string()
const identity = text.min(1).regex(/^[^\u0000-\u001f\u007f]+$/u)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const pin = z.object({ name: identity, version: identity }).strict()
const title = z.object({ zh: text, en: text }).strict()
const source = z.object({ kit: pin.optional(), bundle: pin.optional() }).strict()
const retained = z.object({ snapshot: identity, sourceId: identity }).strict()
const mountedPin = pin.extend({ source: retained.optional(), instanceId: identity.optional(), revision: revision.optional() }).strict()
const mount = z.object({
  bindingKey: identity.optional(), bundle: mountedPin, instanceId: identity.optional(), revision: revision.optional(),
} satisfies Record<keyof StudioInstanceMount, z.ZodType>).strict()
const choice = pin.extend({
  title, runtimeName: identity, instanceId: identity.optional(), revision: revision.optional(),
  description: text.optional(), displayDescription: title.optional(),
} satisfies Record<Exclude<keyof StudioInstanceBundleChoice, 'name' | 'version'>, z.ZodType>).strict()
const readiness = z.object({ ready: z.boolean(), diagnostics: z.array(z.object({
  code: text, message: text, path: text.optional(), severity: z.enum(['error', 'warning']).optional(),
}).strict()) }).strict()

/** Preserve the existing S2 projection, including its retained source and migration context. */
const instance = z.object({
  id: identity, revision, recordVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  kind: z.enum(['kit', 'bundle']), title, source, kit: pin.optional(), bundle: pin.optional(),
  runtimeName: identity.optional(), sourceId: identity.optional(), baseSnapshot: identity,
  mounts: z.array(mount), createdAt: text.optional(), deletedAt: text.optional(), bundlePath: text.optional(),
  forkedFrom: z.object({ id: identity, revision, pin }).strict().optional(),
  migration: z.object({ fromRevision: revision, fromSnapshot: identity }).strict().optional(),
  refs: z.array(z.object({ id: identity, title }).strict()), requiresMigration: z.boolean().optional(),
  description: text.optional(), displayDescription: title.optional(), createdBlank: z.boolean().optional(), current: z.boolean().optional(),
  files: z.array(z.object({ path: text, bytes: revision, editable: z.boolean() }).strict()).optional(),
  availableBundles: z.array(choice).optional(),
  readiness: readiness.optional(),
} satisfies Record<keyof StudioInstanceDescription, z.ZodType>).strict()

const diagnostic = z.object({
  code: text, message: text, subject: text.optional(), severity: z.literal('warning').optional(),
} satisfies Record<keyof StudioDiagnostic, z.ZodType>).strict()
const preview = z.object({
  revision, kit: pin.optional(), bundle: pin, panelYaml: text, sample: z.record(text, z.json()),
  artifacts: z.record(text, text).optional(),
} satisfies Record<keyof StudioPanelPreview, z.ZodType>).strict()
const previewResult = z.object({ preview: preview.optional(), diagnostics: z.array(diagnostic) }).strict()
const candidate = z.object({
  id: identity, baseRevision: revision, revision, digest: text.regex(/^[a-f0-9]{64}$/u),
  diff: z.array(z.object({ path: text, before: text.optional(), after: text.optional() }).strict()),
  valid: z.boolean(), diagnostics: z.array(diagnostic), preview: preview.optional(),
} satisfies Record<keyof StudioInstanceCandidate, z.ZodType>).strict()
const receipt = z.object({
  baseRevision: revision, revision, digest: text.regex(/^[a-f0-9]{64}$/u),
  mode: z.enum(['draft', 'validated']), validation: z.enum(['not_requested', 'definition_passed', 'preview_passed']),
} satisfies Record<keyof StudioInstanceChangeReceipt, z.ZodType>).strict()

const selected = z.object({ id: identity, expectedRevision: revision }).strict()
const changes = selected.extend({
  changes: z.array(z.object({ path: text, content: text.nullable() }).strict()).min(1).max(64),
  bundle: pin.optional(), sampleSource: text.optional(),
}).strict()
const scope = z.object({
  id: identity, expectedRevision: revision, allowedPaths: z.array(identity).min(1).max(64), bundle: pin.optional(),
} satisfies Record<keyof StudioAuthoringScope, z.ZodType>).strict()
const reference = z.object({
  sessionId: identity, parentSessionId: identity, invocationId: identity, epoch: identity,
  messageId: identity, afterSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER), scope,
} satisfies Record<keyof StudioAuthoringReference, z.ZodType>).strict()
const address = z.object({ sessionId: identity, epoch: identity }).strict()
const observation = z.object({
  reference, status: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'unknown']),
  consumed: z.boolean(), turn: revision.nullable(), terminal: z.boolean(), reason: text.optional(),
  throughSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER), source: z.enum(['live', 'prepared']),
  durable: z.boolean(), pendingInput: z.boolean(), diagnostic: text.optional(),
  conversation: z.object({ rows: z.array(z.object({ id: identity, role: z.enum(['assistant', 'tool']),
    label: text, text: text.max(16384), status: text }).strict()).max(200), omitted: revision }).strict().optional(),
} satisfies Record<keyof StudioAuthoringObservation, z.ZodType>).strict()
const start = selected.extend({
  invocationId: identity.max(128), paths: z.array(identity).min(1).max(64), bundle: pin.optional(), prompt: text.min(1),
}).strict()
const preparedTarget = selected.extend({ bundle: pin.optional() }).strict()
const preparedLocator = preparedTarget.extend({ requestId: identity.max(128), digest: text.regex(/^[a-f0-9]{64}$/u) }).strict()
const conversationCandidate = candidate.extend({
  authoring: z.object({ requestId: identity.max(128), studio: preparedTarget, url: text }).strict().optional(),
}).strict()
const archive = z.object({
  format: z.literal('studio-content-archive/v1'), kind: z.enum(['kit', 'bundle']), pin, title: title.optional(),
  provenance: z.object({ source: text.optional(), license: text.optional() }).strict().optional(), dependencies: z.array(pin),
  files: z.array(z.object({ path: text, base64: text, bytes: revision, sha256: text.regex(/^[a-f0-9]{64}$/u) }).strict()).max(4096),
  sha256: text.regex(/^[a-f0-9]{64}$/u),
} satisfies Record<keyof StudioContentArchive, z.ZodType>).strict()

/** Business validation and byte budgets still belong to S1/S2/S4; these are JSON codecs. */
export const STUDIO_AUTHORING_RPC_SCHEMAS = {
  list: { request: z.object({ kind: z.enum(['kit', 'bundle']).optional() }).strict().optional(), result: z.array(instance), optional: true },
  read: { request: z.object({ id: identity }).strict(), result: instance },
  create: { request: z.object({ kind: z.enum(['kit', 'bundle']), title }).strict(), result: instance },
  importSources: { request: z.object({ kind: z.enum(['kit', 'bundle']),
    files: z.array(z.object({ path: text, base64: text }).strict()).min(1).max(4096), title: title.optional(),
  }).strict(), result: instance },
  copy: { request: z.object({ kind: z.enum(['kit', 'bundle']), kit: pin.optional(), bundle: pin.optional(),
    sourceId: identity.optional(), expectedRevision: revision.optional(), title: title.optional() }).strict(), result: instance },
  editCurrent: { request: z.object({ kind: z.enum(['kit', 'bundle']), kit: pin.optional(), bundle: pin.optional() }).strict(), result: instance },
  rename: { request: selected.extend({ title }).strict(), result: instance },
  remove: { request: selected, result: z.object({ id: identity, revision, trashed: z.literal(true) }).strict() },
  readFile: { request: z.object({ id: identity, path: text }).strict(), result: z.object({ id: identity, revision, path: text, content: text }).strict() },
  saveFile: { request: selected.extend({ path: text, content: text }).strict(), result: instance },
  prepareChanges: { request: changes, result: conversationCandidate },
  saveChanges: { request: z.union([
    changes.extend({ mode: z.literal('draft').optional(), digest: text.optional() }).strict(),
    changes.extend({ mode: z.literal('validated'), digest: text.regex(/^[a-f0-9]{64}$/u) }).strict(),
  ]), result: instance.extend({ changeReceipt: receipt }).strict() },
  updateMounts: { request: selected.extend({ bundles: z.array(pin.extend({
    bindingKey: identity.optional(), instanceId: identity.optional(), revision: revision.optional(),
  }).strict()) }).strict(), result: instance },
  preview: { request: selected.extend({ bundle: pin.optional(), sampleSource: text.optional() }).strict(), result: previewResult },
  start: { request: start, result: reference },
  resume: { request: start.extend({ previous: address, explicit: z.literal(true) }).strict(), result: reference },
  observe: { request: address, result: observation },
  cancel: { request: address.extend({ expectedTurn: revision.nullable() }).strict(), result: observation },
  readPrepared: { request: z.union([address, preparedLocator]), result: z.object({ prepared: z.object({ request: changes, candidate }).strict().optional() }).strict() },
  listReferences: { request: undefined, result: z.array(reference) },
  readArchive: { request: z.object({ source: text.max(32 * 1024 * 1024) }).strict(), result: archive },
  exportContentArchive: { request: z.union([z.object({ kind: z.enum(['kit', 'bundle']), pin,
    provenance: z.object({ source: text.optional(), license: text.optional() }).strict().optional() }).strict(), selected.extend({
      provenance: z.object({ source: text.optional(), license: text.optional() }).strict().optional(), dependencies: z.array(pin).optional(),
    }).strict()]), result: text },

} as const
export type StudioAuthoringRpcMethod = keyof typeof STUDIO_AUTHORING_RPC_SCHEMAS

/** The real Host lookup turns this SessionId locator into the actual live Agent. */
const agentParameter = {
  name: 'agent', wire: 'agentId', source: 'lookup' as const, lookup: 'agent',
  codec: { mode: 'strict' as const, typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => identity },
}
export const STUDIO_AUTHORING_REMOTE = {
  package: 'dsh-design-studio-dsh',
  descriptors: Object.entries(STUDIO_AUTHORING_RPC_SCHEMAS).map(([method, spec]) => ({
    id: `dsh-design-studio-dsh#studioAuthoring/${method}`, service: 'studioAuthoring', namespace: 'studioAuthoring', method,
    invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
    parameters: [agentParameter, ...(spec.request === undefined ? [] : [{
      name: 'request', wire: 'request', source: 'json' as const,
      ...('optional' in spec && spec.optional ? { acceptsUndefined: true as const } : {}),
      codec: { mode: 'strict' as const, typeSymbol: `dsh-design-studio-dsh#${method}Request`, create: () => spec.request! },
    }])],
    result: { mode: 'strict', typeSymbol: `dsh-design-studio-dsh#${method}Result`, create: () => spec.result },
  } satisfies InvocationDescriptor)),
}
