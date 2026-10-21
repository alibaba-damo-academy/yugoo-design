/**
 * Browser-facing Remote descriptor for the design panel save channel. Mirrors
 * the `@Remote` surface of `DesignPanelRemote` (src/panel-remote.ts); the
 * panel client mounts it through `ctx.remote.$mount` and calls the
 * `remote.designPanel` workspace, save, artifact, catalog, and advisory methods.
 * Strict codecs materialize their existing validators through the protocol's
 * `create()` factory; Host and Client consume this same contribution.
 */
import { z } from 'zod'

/** Session id wire parameter (agent-scope lookup). */
const agentIdSchema = z.intersection(z.string(), z.unknown())
const reviewPolicySchema = z.object({ mode: z.enum(['auto', 'continuous', 'every-publication', 'off']), autoMergeWindowMs: z.number().int().min(0).max(3600000), continuousIntervalMs: z.number().int().min(60000).max(86400000).optional() }).strict()
/** The owning design skill name. */
const skillSchema = z.string()
/** The full post-edit panel state (arbitrary JSON). */
const stateSchema = z.unknown()
/** Optional native panel artifacts prepared by the browser renderer. */
const nativePanelArtifactsSchema = z.array(z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.literal('base64').optional(),
})).max(64)
const panelArtifactsSchema = z.union([
  nativePanelArtifactsSchema,
  z.object({ autoBefore: z.unknown(), definitionRevision: z.string().optional() }).strict(),
]).optional()
/** Stable save-operation identity used for idempotent Git auditing. */
const saveEventIdSchema = z.string().min(1).max(256)
const savedAssessmentRequestSchema = z.object({
  requestId: z.string().min(1).max(256),
  saves: z.array(z.object({ eventId: saveEventIdSchema, commit: z.string().optional() }).strict()).min(1).max(64),
}).strict()
/** The save outcome: the commit, absent when the state was unchanged. */
const resultSchema = z.object({
  commit: z.string().optional(),
})
/** One DesignJournal-folded panel entry. */
const workspaceEntrySchema = z.object({
  state: z.unknown(),
  origin: z.enum(['agent', 'panel']),
  panelYaml: z.string().optional(),
  skillManifest: z.record(z.string(), z.unknown()).optional(),
})
/** Clarity readout assessment pinned to one Kit version. */
const workspaceClarityAssessmentSchema = z.object({
  kit: z.string().min(1),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u),
  u: z.number().int().min(0).max(100),
  s: z.number().int().min(0).max(100),
  t: z.number().int().min(0).max(100),
})
/** Authoritative project write availability for the browser workspace. */
const workspaceAccessSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('unbound'), writable: z.literal(false) }),
  z.object({ mode: z.literal('unconfigured'), writable: z.literal(false) }),
  z.object({
    mode: z.literal('recovery'),
    writable: z.literal(false),
    kit: z.object({ name: z.string().min(1), version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u) }),
    upgradeCommand: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal('writable'),
    writable: z.literal(true),
    kit: z.object({ name: z.string().min(1), version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u) }),
  }),
])
const handoffLabelSchema = z.object({ zh: z.string(), en: z.string() })
/** Read models only: these fields grant no save or resume capability. */
const continuationSchema = z.object({
  skill: z.string().min(1),
  title: handoffLabelSchema.optional(),
  invocationId: z.string().min(1),
  routeId: z.string().min(1),
  label: handoffLabelSchema,
  aliases: z.object({ zh: z.array(z.string()), en: z.array(z.string()) }).optional(),
  journalRevision: z.number().int().positive().optional(),
  summary: z.string().optional(),
})
const mustEditHandoffSchema = z.object({
  skill: z.string().min(1),
  pin: z.object({
    invocationId: z.string().min(1),
    projectId: z.string().min(1),
    kitName: z.string().min(1),
    kitVersion: z.string().min(1),
    skillName: z.string().min(1),
    bundleVersion: z.string().min(1),
    stateRevision: z.string().min(1),
  }),
})
/** Read-only scheduler observation, shared by Host and browser codecs. */
const advisoryRuntimeSchema = z.object({
  available: z.boolean(),
  profiles: z.array(z.string()),
  phase: z.enum(['idle', 'scheduled', 'running', 'failed']),
  lastPublished: z.object({ profile: z.string(), advisoryId: z.string() }).strict().optional(),
  lastError: z.string().optional(),
  profileStatus: z.array(z.object({
    profile: z.string(),
    phase: z.enum(['idle', 'scheduled', 'running', 'failed']),
    lastError: z.string().optional(),
    latestRevision: z.number().int().nonnegative().optional(),
  }).strict()).optional(),
}).strict()
/** Plugin-owned workspace snapshot. */
const workspaceSchema = z.object({
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  projectPath: z.string().nullable(),
  checkpoint: z.string().nullable(),
  worktreeRevision: z.string().nullable(),
  publicationError: z.string().optional(),
  artifactFiles: z.record(z.string(), z.string()).optional(),
  experienceFiles: z.record(z.string(), z.string()).optional(),
  executionRevision: z.number().int().nonnegative(),
  executionAttempts: z.array(z.object({
    projectId: z.string(),
    invocationId: z.string(),
    skill: z.string(),
    artifactId: z.string(),
    artifactKind: z.string().optional(),
    artifactFile: z.string().optional(),
    attemptId: z.string(),
    runId: z.string().optional(),
    parentRunId: z.string().optional(),
    role: z.enum(['producer', 'worker']),
    phase: z.enum(['queued', 'working', 'completed', 'failed', 'cancelled']),
    diagnostics: z.array(z.string()).optional(),
    receipt: z.object({ path: z.string(), sha256: z.string(), bytes: z.number().int().nonnegative() }).optional(),
    sequence: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative(),
  })),
  activeMainBundles: z.array(z.object({ skill: z.string(), invocationId: z.string() })).optional(),
  access: workspaceAccessSchema,
  journalRevision: z.number().int().nonnegative(),
  design: z.record(z.string(), workspaceEntrySchema),
  autoPanelManifests: z.record(z.string(), z.string()).optional(),
  autoPanelDefinitions: z.record(z.string(), z.object({ origin: z.enum(['generated', 'retained']).optional(), definitionRevision: z.string().optional(), sourceChanged: z.boolean().optional(), error: z.string().optional() })).optional(),
  autoPanelStates: z.record(z.string(), z.object({
    phase: z.enum(['awaiting-agent', 'queued', 'running', 'ready', 'failed']),
    target: z.string(),
    detail: z.string().optional(),
    attempts: z.number().int().positive().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    fallbackReason: z.string().optional(),
  })).optional(),
  continuations: z.array(continuationSchema),
  mustEditHandoffs: z.array(mustEditHandoffSchema),
  advisoryRuntime: advisoryRuntimeSchema.optional(),
  clarity: z.object({
    assessment: workspaceClarityAssessmentSchema.nullable(),
    needsReassessment: z.boolean(),
    explanation: z.object({ summary: z.string(), u: z.string(), s: z.string(), t: z.string(),
      nextGap: z.string().optional(), assessedCheckpoint: z.string() }).optional(),
    activity: z.object({ phase: z.enum(['queued', 'running', 'failed', 'stale', 'unavailable']),
      checkpoint: z.string().min(1), summary: z.string().max(1000).optional() }).strict().optional(),
  }),
  latestDesignChange: z.object({
    skill: z.string(),
    journalRevision: z.number().int().positive(),
  }).optional(),
})
/** Artifact path relative to `design_files/`. */
const relPathSchema = z.string()
/** The artifact read outcome. */
const artifactSchema = z.object({
  found: z.boolean(),
  content: z.string(),
})
const executionLogSchema = z.object({
  found: z.boolean(),
  revision: z.string().nullable(),
  reset: z.boolean(),
  entries: z.array(z.object({
    seq: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative(),
    eventType: z.enum(['message', 'search', 'fetch', 'synthesize', 'error']),
    message: z.string(),
    url: z.string().optional(),
  })),
})
const projectCatalogSchema = z.object({
  currentProjectId: z.string().nullable(),
  projects: z.array(z.object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    root: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
    kit: z.object({ name: z.string().min(1), version: z.string().min(1) }).optional(),
  })),
  mindsets: z.array(z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
  })),
})
/** Bounded binary artifact read outcome; base64 is raw wire content. */
const binaryArtifactSchema = z.object({
  found: z.boolean(),
  mediaType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  base64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  byteLength: z.number().int().nonnegative(),
}).superRefine((value, context) => {
  const padding = value.base64.endsWith('==') ? 2 : value.base64.endsWith('=') ? 1 : 0
  const decodedLength = (value.base64.length / 4) * 3 - padding
  const validMissing = !value.found && value.base64 === '' && value.byteLength === 0
  const validFound = value.found && value.byteLength > 0 && decodedLength === value.byteLength
  if (!validMissing && !validFound) {
    context.addIssue({ code: 'custom', message: 'binary artifact fields are inconsistent' })
  }
})
/** One catalog entry: skill id, routing description, skill.yaml manifest. */
const catalogSkillSchema = z.object({
  id: z.string(),
  description: z.string(),
  manifest: z.record(z.string(), z.unknown()),
})
/** The skill catalog outcome. */
const catalogSchema = z.object({
  mindset: z.string().optional(),
  skills: z.array(catalogSkillSchema),
})
/** Human disposition of one reviewable Design advisory. */
const advisoryDecisionSchema = z.object({
  advisoryId: z.string(),
  decision: z.enum(['accepted', 'rejected', 'deferred']),
})
const advisoryProjectionSchema = z.object({
  publishedAt: z.number().int().nonnegative().optional(),
  publishedRevision: z.number().int().positive().optional(),
  advisory: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'accepted', 'rejected', 'deferred', 'queued', 'running', 'failed', 'needs-user-input', 'completed', 'invalidated']),
  stale: z.boolean(),
  acceptanceReceiptId: z.string().optional(),
  actionReceipts: z.array(z.record(z.string(), z.unknown())).optional(),
  selection: z.object({
    advisoryId: z.string(), acceptanceReceiptId: z.string(),
    kind: z.enum(['bundle', 'host-question', 'host-research', 'no-action']),
    reason: z.string().min(1).max(2048),
    actions: z.array(z.record(z.string(), z.unknown())),
    journalRevision: z.number().int().positive(),
  }).optional(),
  executionStatus: z.enum(['not-applicable', 'ready', 'running', 'failed', 'needs-user-input', 'completed']).optional(),
})

/** The `designPanel` namespace contribution for `ctx.remote.$mount`. */
export const TYPERT_REMOTE = {
  package: 'dsh-design-core',
  descriptors: [
    {
      id: 'dsh-design-core#designPanel/admitSavedAssessment', service: 'designPanel', namespace: 'designPanel', method: 'admitSavedAssessment',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } },
        { name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/admitSavedAssessment:request', create: () => savedAssessmentRequestSchema } },
      ],
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/admitSavedAssessment:result',
        create: () => z.object({ status: z.enum(['accepted', 'unchanged', 'unavailable']) }).strict() },
    },
    {
      id: 'dsh-design-core#designPanel/pollWorkspace',
      service: 'designPanel', namespace: 'designPanel', method: 'pollWorkspace',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } },
        { name: 'knownRevision', wire: 'knownRevision', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/pollWorkspace:knownRevision', create: () => z.string().max(64).nullable() } },
      ],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/pollWorkspace:result', create: () => z.discriminatedUnion('unchanged', [
        z.object({ revision: z.string(), unchanged: z.literal(true) }),
        z.object({ revision: z.string(), unchanged: z.literal(false), workspace: workspaceSchema }),
      ]) },
    },
    {
      id: 'dsh-design-core#designPanel/retainAutoPanel', service: 'designPanel', namespace: 'designPanel', method: 'retainAutoPanel',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } },
        { name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/retainAutoPanel:request',
          create: () => z.object({ projectId: z.string(), skill: z.string(), sourceRevision: z.string(), definitionRevision: z.string() }).strict() } },
      ],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/retainAutoPanel:result', create: () => z.object({ retained: z.literal(true) }).strict() },
    },
    {
      id: 'dsh-design-core#designPanel/observePanelDraft', service: 'designPanel', namespace: 'designPanel', method: 'observePanelDraft',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } },
        { name: 'observation', wire: 'observation', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/observePanelDraft:observation',
          create: () => z.object({ projectId: z.string().uuid(), pageId: z.string().uuid(), sequence: z.number().int().positive(), dirty: z.boolean(), saving: z.boolean(), lifecycle: z.enum(['opened', 'observed', 'closed']).optional() }).strict() } },
      ],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/observePanelDraft:result', create: () => z.object({ observed: z.literal(true) }).strict() },
    },
    {
      id: 'dsh-design-core#designPanel/readWorkspace',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'readWorkspace',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/readWorkspace:result',
        create: () => workspaceSchema,
      },
    },
    {
      id: 'dsh-design-core#designPanel/savePanel',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'savePanel',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
        {
          name: 'skill',
          wire: 'skill',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/savePanel:skill',
            create: () => skillSchema,
          },
        },
        {
          name: 'state',
          wire: 'state',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/savePanel:state',
            create: () => stateSchema,
          },
        },
        {
          name: 'artifacts',
          wire: 'artifacts',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/savePanel:artifacts',
            create: () => panelArtifactsSchema,
          },
        },
        {
          name: 'eventId',
          wire: 'eventId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/savePanel:eventId',
            create: () => saveEventIdSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/savePanel:result',
        create: () => resultSchema,
      },
    },
    {
      id: 'dsh-design-core#designPanel/readReviewPolicy',
      service: 'designPanel', namespace: 'designPanel', method: 'readReviewPolicy',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [{ name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } }],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/readReviewPolicy:result', create: () => reviewPolicySchema },
    },
    {
      id: 'dsh-design-core#designPanel/updateReviewPolicy',
      service: 'designPanel', namespace: 'designPanel', method: 'updateReviewPolicy',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } },
        { name: 'policy', wire: 'policy', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/updateReviewPolicy:policy', create: () => reviewPolicySchema } },
      ],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/updateReviewPolicy:result', create: () => reviewPolicySchema },
    },
    {
      id: 'dsh-design-core#designPanel/readGraph',
      service: 'designPanel', namespace: 'designPanel', method: 'readGraph',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [{ name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } }],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/readGraph:result', create: () => z.object({ content: z.string() }) },
    },
    {
      id: 'dsh-design-core#designPanel/readKnowledgeStatus',
      service: 'designPanel', namespace: 'designPanel', method: 'readKnowledgeStatus',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [{ name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } }],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/readKnowledgeStatus:result', create: () => z.object({
        schemaVersion: z.literal(1), project: z.string(), head: z.string().optional(),
        state: z.enum(['current', 'due', 'queued', 'running', 'failed', 'disabled', 'unavailable', 'unknown']),
        phase: z.enum(['projection', 'semantic', 'publication']).optional(),
        freshness: z.enum(['matching', 'different', 'none']),
        latestComplete: z.object({ checkpoint: z.string(), revision: z.string(), warningCount: z.number().int().nonnegative() }).optional(),
        recovery: z.object({ state: z.enum(['rebuilding', 'ready', 'error']), message: z.string(), generation: z.string().optional() }).optional(),
        lastFailure: z.object({ target: z.string(), message: z.string() }).optional(),
        semanticLayer: z.enum(['enabled', 'disabled']),
      }).optional() },
    },
    {
      id: 'dsh-design-core#designPanel/retryKnowledge',
      service: 'designPanel', namespace: 'designPanel', method: 'retryKnowledge',
      invocation: { kind: 'direct' }, scope: { context: 'agent', wire: 'agentId' },
      parameters: [{ name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema } }],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/retryKnowledge:result', create: () => z.object({ accepted: z.boolean() }) },
    },
    {
      id: 'dsh-design-core#designPanel/readArtifact',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'readArtifact',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
        {
          name: 'relPath',
          wire: 'relPath',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/readArtifact:relPath',
            create: () => relPathSchema,
          },
        },
        {
          name: 'stateRevision',
          wire: 'stateRevision',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/readArtifact:stateRevision',
            create: () => z.string(),
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/readArtifact:result',
        create: () => artifactSchema,
      },
    },
    {
      id: 'dsh-design-core#designPanel/readExecutionLog',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'readExecutionLog',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent',
          codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => agentIdSchema },
        },
        {
          name: 'executionRef', wire: 'executionRef', source: 'json',
          codec: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/readExecutionLog:executionRef', create: () => z.string() },
        },
        {
          name: 'afterSeq', wire: 'afterSeq', source: 'json',
          acceptsUndefined: true,
          codec: { mode: 'strict', typeSymbol: 'dsh-design-core#designPanel/readExecutionLog:afterSeq', create: () => z.number().int().nonnegative().optional() },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/readExecutionLog:result',
        create: () => executionLogSchema,
      },
    },
    {
      id: 'dsh-design-core#designPanel/readBinaryArtifact',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'readBinaryArtifact',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
        {
          name: 'relPath',
          wire: 'relPath',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/readBinaryArtifact:relPath',
            create: () => relPathSchema,
          },
        },
        {
          name: 'stateRevision',
          wire: 'stateRevision',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/readBinaryArtifact:stateRevision',
            create: () => z.string(),
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/readBinaryArtifact:result',
        create: () => binaryArtifactSchema,
      },
    },
    {
      id: 'dsh-design-core#designPanel/decideAdvisory',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'decideAdvisory',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
        {
          name: 'decision',
          wire: 'decision',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-design-core#designPanel/decideAdvisory:decision',
            create: () => advisoryDecisionSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/decideAdvisory:result',
        create: () => advisoryProjectionSchema,
      },
    },
    {
      id: 'dsh-design-core#designPanel/listAdvisories',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'listAdvisories',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/listAdvisories:result',
        create: () => z.array(advisoryProjectionSchema),
      },
    },
    {
      id: 'dsh-design-core#designPanel/listProjects',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'listProjects',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/listProjects:result',
        create: () => projectCatalogSchema,
      },
    },
    {
      id: 'dsh-design-core#designPanel/listSkills',
      service: 'designPanel',
      namespace: 'designPanel',
      method: 'listSkills',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: () => agentIdSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-design-core#designPanel/listSkills:result',
        create: () => catalogSchema,
      },
    },
  ],
} as const

export default TYPERT_REMOTE
