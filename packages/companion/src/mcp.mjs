/** Standard MCP transport over the existing authenticated companion API. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { isAbsolute, join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { z } from 'zod/v4'
import { callCompanion } from './connection-file.mjs'
import { modelRequest, modelResponse } from './model-response.mjs'
import { runCompanionCommand } from './project-commands.mjs'
import { PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS } from '../../core/src/panel-component-catalog.ts'
import { queryPanelAuthoringReference } from '../../core/src/panel-authoring-reference.ts'
import { DESIGN_GIT_READ_ACTIONS, DESIGN_GIT_READ_DESCRIPTION, designGitReadArguments,
  DESIGN_CLARITY_OUTPUT_SCHEMA, OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE,
  OFFICIAL_ALIGNMENT_PROFILE, officialAdvisoryProfile } from '../../core/lib/index.js'

async function readPackagedAuthoringReference() {
  const bytes = await readFile(new URL('../authoring/panel-components.json', import.meta.url))
  if (bytes.length > 6_000_000) throw Error('Packaged authoring reference exceeds its bounded size')
  return JSON.parse(bytes.toString('utf8'))
}

export function createDesignMcp({ commandOptions = {}, loadAuthoringReference = readPackagedAuthoringReference } = {}) {
  const server = new McpServer({ name: 'design-system', version: '0.1.0' }, {
    instructions: 'Use the exact connection file printed by this task’s companion. Never find a latest/global connection. Native host tools own agents and files. These tools neither spawn agents nor authenticate the caller as a child. After an uncertain write result inspect current state before retrying.',
  })
  const path = z.string().refine(isAbsolute, 'An absolute path is required.')
  const connection = path.describe('Exact private connection file printed by serve for this project/main conversation. Pass the path, never its token or contents.')
  // Exact host-specific identity is verified by the bound server, not inferred here.
  const nativeId = z.string().regex(/^[a-zA-Z0-9][\w-]{0,127}$/)
  server.registerTool('design_list_panel_components', {
    description: 'Discover the installed runtime panel vocabulary before authoring a Bundle. No project, connection or model is required. Omit reference for purposes and composition flags from the shared Core catalog. With an exact name, reference=contract/docs/examples reads matching packaged source-derived authoring material; type selects a local declaration or nested property only for contract. Coverage labels distinguish dedicated docs from shared references. Not a complete per-component parameter schema or standard A2UI specification. generated indicates restricted generation availability, not edit permission.',
    inputSchema: z.object({ name: z.string().min(1).max(128).optional(),
      reference: z.enum(['contract', 'docs', 'examples']).optional(), type: z.string().min(1).max(256).optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ name, reference, type }) => {
    if (name !== undefined && !Object.hasOwn(PANEL_COMPONENT_CATALOG, name)) {
      return { isError: true, content: [{ type: 'text', text: 'Unknown panel component. Omit name to list the supported vocabulary.' }] }
    }
    if (reference !== undefined || type !== undefined) {
      if (!name || !reference || (type !== undefined && reference !== 'contract')) {
        return { isError: true, content: [{ type: 'text', text: 'Authoring references require an exact component name; type is valid only with reference=contract.' }] }
      }
      try {
        const result = queryPanelAuthoringReference(await loadAuthoringReference(), name, reference, type)
        const text = JSON.stringify(result)
        if (Buffer.byteLength(text) > 262144) throw Error('Authoring response exceeds its bounded size')
        return { content: [{ type: 'text', text }] }
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Authoring reference unavailable, incompatible, or unknown. Install matching reference material and use a declared type/property. No source checkout fallback is performed.' }] }
      }
    }
    const components = (name === undefined ? Object.keys(PANEL_COMPONENT_CATALOG) : [name]).map(kind => {
      const entry = PANEL_COMPONENT_CATALOG[kind]
      return { name: kind, description: entry.description, sourceBound: entry.sourceBound === true,
        ownsWorkspace: entry.ownsWorkspace === true, generated: GENERATED_COMPONENT_KINDS.includes(kind) }
    })
    return { content: [{ type: 'text', text: JSON.stringify({ components,
      contract: 'Runtime vocabulary and composition guidance only; not a complete parameter schema or standard A2UI specification.' }) }] }
  })
  // Project management must work before a Panel/connection exists. Same
  // explicit host/session binding and repository as the native CLI entry.
  server.registerTool('design_command', {
    description: 'Run any project command from explicit or natural-language intent: help/list/status/new/open/kit/close/migrate/reconstruct/delete/compose_spec. Available before serve: no connection required. compose_spec prepares composition guidance for saved design and artifacts in the authorized coding workspace existing specs; follow conversationPrompt to write/check specs, not merely return its receipt, and do not infer coding authorization. Main conversation only: pass the exact host and main native session ID supplied by the host, never guess or use a child ID. new/open precedes Kit selection. migrate stages recognized Design Files in a new project under the selected Kit for validation/adaptation; it does not restore complete project history. reconstruct extracts design from non-design source materials. Selection changes follow user intent; delete requires explicit authorization and preserves files. A successful selection change returns panelRestartRequired: restart only your own Panel using selected.root and the same main session. conversationPrompt is guidance, not new user authorization.',
    inputSchema: z.object({
      host: z.enum(['codex', 'claude-code', 'qoder', 'qwenwork', 'workbuddy']),
      threadId: nativeId,
      action: z.enum(['help', 'list', 'status', 'new', 'open', 'kit', 'mindset', 'close', 'migrate', 'reconstruct', 'delete', 'compose_spec']),
      argument: z.string().min(1).max(8192).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ host, threadId, action, argument }) => {
    try {
      const result = await runCompanionCommand({
        stateRoot: join(homedir(), '.local/state/design-system/companion'),
        kitRoot: join(dirname(fileURLToPath(import.meta.url)), '../kits/web_app'),
        ...commandOptions, host, threadId,
        input: `${action}${argument === undefined ? '' : ` ${argument}`}`,
      })
      return { ...(result.kind === 'error' ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: String(error.message ?? error).replace(/[a-f0-9]{64}/gi, '[redacted]') }] }
    }
  })
  const nativeRunId = nativeId.describe('Actual native child ID returned by this host\'s launch tool (WorkBuddy: agent-...). Never a custom task name, Bundle invocationId, parent session ID or transcript filename.')
  const nativeParentRunId = nativeId.describe('Actual native parent ID. Where optional, omit to use the bound main conversation; a nested Worker must supply its real Producer parent ID. WorkBuddy supports only a Producer of the bound main conversation.')
  const nativeTranscriptPath = path.describe('Exact child transcript path, never the parent/main transcript. Where optional, omit and let the adapter resolve it from the bound session and actual runId. WorkBuddy derives its canonical child path and rejects foreign paths.')
  const nativeTaskPath = path.describe('Exact native task metadata path for Qoder or QwenWork only; normally resolved from their bound session. Not a transcript path. Omit for WorkBuddy, Codex and Claude Code.')
  const nativeRun = z.object({ runId: nativeRunId, parentRunId: nativeParentRunId, transcriptPath: nativeTranscriptPath, taskPath: nativeTaskPath.optional() }).strict()
  const nativeLaunch = z.object({runId:nativeRunId.optional(),parentRunId:nativeParentRunId.optional(),transcriptPath:nativeTranscriptPath.optional(),taskPath:nativeTaskPath.optional(),
    launchCallId:z.string().min(1).describe('Codex only: exact native spawn call ID recorded in the parent transcript, as an alternative to runId. Other hosts must omit this and supply their actual native child runId.').optional(),
    agentPath:z.string().min(1).describe('Codex only: uniquely recorded native agent path used to resolve the actual child runId. Other hosts must omit this and supply their actual native child runId.').optional()}).strict()
  const register = (name, method, description, schema, readOnly = false, project = value => value, mapParams = value => value) => {
    server.registerTool(name, { description, inputSchema: z.object({ connection, ...schema }).strict(),
      annotations: { readOnlyHint: readOnly, openWorldHint: false } }, async ({ connection: file, ...params }) => {
      try {
        const { details, ...operationParams } = params
        const result = modelResponse(method, project(await callCompanion(file, modelRequest({ method, params: mapParams(operationParams) }))), { details })
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (error) {
        // Never expose malformed connection-file bytes or an access token.
        const message = error instanceof SyntaxError ? 'Invalid JSON in local connection or server response.' : String(error.message ?? error).replace(/[a-f0-9]{64}/gi, '[redacted]')
        return { isError: true, content: [{ type: 'text', text: message }] }
      }
    })
  }
  register('design_status', 'readWorkspace', 'Read compact project/checkpoint, execution, handoff and independent UST/KAG/GRA status. UST reasons are returned once in services.ust.assessment. details=true includes the complete host-specific background protocol and full workspace for explicit diagnosis; ordinary status does not need it. Read-only: never evaluates, indexes, probes or launches. Accepted/available is not completed.', {
    details: z.boolean().optional(),
  }, true)
  register('design_main_context', 'mainContext', 'Read the current main-Agent Design evidence context, exact U/S/T input and current assessment plus KAG status. Reuse useful current reasoning or report an updated assessment for the agreed scope. Assessment never gates authorized Design work. Never starts indexing, GRA or a model.', {}, true)
  const dimension = z.object({ score: z.number().int().min(0).max(100), evidence: z.string().min(1).max(65536) }).strict()
  register('report_design_clarity', 'reportMainClarity', 'Record evidence-based U/S/T for the project, Kit and saved Design evidence from design_main_context. Persists project records and their Git history without changing Design Files. Different Design evidence or Kit is rejected; identical current reports are reused, corrected reasoning may be reported again. No native log, turn or background capability is required.', {
    input: z.object({ projectId: z.string().uuid(), assessedCheckpoint: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
      kitContentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    summary: z.string().min(1).max(65536), u: dimension, s: dimension, t: dimension, nextGap: z.string().min(1).max(65536).optional(),
  })
  register('design_git_read', 'readGit', `${DESIGN_GIT_READ_DESCRIPTION} Main and child agents use this same exact private Companion connection; it grants no root/argv, write or publication capability.`, {
    action: z.enum(DESIGN_GIT_READ_ACTIONS),
    project: z.string().min(1).optional(),
    checkpoint: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/).optional(),
    from: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/).optional(),
    path: z.string().min(1).max(4096).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  }, true, value => value, designGitReadArguments)
  register('design_list_bundles', 'listSkills', 'Discover exact Bundle IDs, descriptions, declared execution modes and the Mindset method path from the selected project’s pinned Kit. Read the Mindset method before selecting a Bundle. Kit IDs and panel component names are not Bundle IDs. Catalog declarations do not prove host execution capability. Does not spawn, generate or modify Design Files.', {}, true)
  register('design_prepare_bundle', 'prepareBundle', 'Get the selected Bundle’s existing method and resource paths. Use an exact Bundle ID from design_list_bundles. Does not spawn or generate.', { skill: z.string().min(1) }, true)
  const migrationId = z.string().uuid()
  const semanticEvidence = z.object({ status: z.enum(['equivalent', 'needs-user-input']), summary: z.string().min(1).max(32768),
    sources: z.array(z.object({ file: z.string().min(1).max(1024), explanation: z.string().min(1).max(8192) }).strict()).max(4096),
    unresolvedFacts: z.array(z.string().max(8192)).max(256) }).strict()
  register('design_prepare_content_upgrade', 'prepareContentUpgrade', 'After one explicit user upgrade instruction, prepare an isolated semantic migration for the same project identity. Exact installed Kit and Bundle pins only. Read full source/target methods; launch an actual native Producer confined to the returned candidate. Does not repin or modify the original project. Unsaved Panel drafts and running tasks block adoption. Never invent new domain facts merely to pass a schema.', {
    target: z.object({ name: z.string().min(1).max(128), version: z.string().regex(/^\d+\.\d+$/),
      bundles: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().regex(/^\d+\.\d+$/)).optional() }).strict(),
  })
  register('design_read_content_upgrade_definition', 'readContentUpgradeDefinition', 'Read required complete affected domain methods/contracts/shared constraints, or an exact resource from availableResources. Follow every required nextOffset for both sides. Complete original definitions remain available on demand; arbitrary filesystem paths are inaccessible.', {
    id: migrationId, side: z.enum(['source', 'target']), offset: z.number().int().min(0), resource: z.string().min(1).max(4096).optional(),
  }, true)
  register('design_list_content_upgrade_files', 'listContentUpgradeFiles', 'List the isolated candidate Design Files for this exact prepared operation. No live project authority.', { id: migrationId }, true)
  register('design_read_content_upgrade_file', 'readContentUpgradeFile', 'Read a UTF-8 candidate Design File by relative path. Use nextOffset for long files. Metadata, live project and arbitrary Host files are outside this capability.', {
    id: migrationId, path: z.string().min(1).max(4096), offset: z.number().int().min(0),
  }, true)
  register('design_write_content_upgrade_file', 'writeContentUpgradeFile', 'Replace one UTF-8 candidate Design File. This does not change the live project, its pin or assets. Use only within the actual confined native migration Producer.', {
    id: migrationId, path: z.string().min(1).max(4096), content: z.string().max(8 * 1024 * 1024),
  })
  register('design_validate_content_upgrade', 'validateContentUpgrade', 'After reading every required source/target page and any needed original resources, validate candidate semantics and existing target contracts without publication. Repair rejected candidates in this same native Producer; unresolved new facts require user input.', {
    id: migrationId, evidence: semanticEvidence,
  }, true)
  register('design_finish_content_upgrade', 'finishContentUpgrade', 'Adopt only this exact prepared candidate after its real native Producer has completed and supplied semantic equivalence evidence. Reuses full validation, same-project Git CAS and journal; source/target missing, stale or unresolved facts fail without guessing. Do not write or repin the original project.', {
    id: migrationId, native: nativeLaunch, evidence: semanticEvidence,
  })
  register('design_recover_content_upgrade', 'recoverContentUpgrade', 'Reconcile only an already authorized interrupted content adoption on this exact project. Does not create another project or upgrade. External edits are preserved and conflicts require explicit resolution.', {})
  register('design_submit_trial_input', 'submitTrialInput', 'Record the actual generated Studio test input once, before Bundle execution, on the exact owned isolated trial connection. Include the tested Bundle name. Not available on an ordinary project or for manual input; cannot overwrite a receipt.', { trialId: z.string().uuid(), task: z.string().min(1).max(32768) })
  register('design_knowledge_context', 'knowledgeContext', 'Read the selected project KAG pins and bounded context. Unavailable/partial is not evidence of missing design. Does not start reviews.', {}, true,
    value => value.available ? { available:true, project:value.project, checkpoint:value.checkpoint, revision:value.knowledgeRevision, graph:value.graph, method:value.method } : value)
  register('design_knowledge_status', 'knowledgeStatus', 'Read the compact honest KAG status: state current/due/queued/running/failed/disabled/unavailable/unknown, target head, latest-complete published head, freshness, recovery and last failure. Pure read; never starts indexing or reviews. Reading stale KAG or Design Files never requires freshness; use this to judge whether design_refresh_knowledge is worth calling.', {}, true)
  register('design_refresh_knowledge', 'refreshKnowledge', 'Request at most one bounded KAG maintenance pass for the current generation (file projection plus semantic embedding when configured). Returns accepted/noop/rejected with reason and the exact target checkpoint/generation. Runs in the background, never blocks, never retries itself after failure; a failed generation stays failed until you explicitly request again. Only call when changed design facts will materially benefit upcoming queries, reviews, or cross-Bundle decisions.', {})
  register('design_query_knowledge', 'queryKnowledge', 'Read a pinned ontology-aware KAG page or one-hop neighborhood. Generated ontology types, record kinds and identity qualities are filters, not authored roles. Preserve pins/filters for pagination. Similarity is a candidate, not proof; verify source files. No writes or review spawning.', {
    project:z.string().min(1),checkpoint:z.string().min(1),revision:z.string().min(1),
    text:z.string().max(8192).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(100).optional(),
    entityIds:z.array(z.string()).max(64).optional(),relationIds:z.array(z.string()).max(64).optional(),
    incidentTo:z.array(z.string()).max(64).optional(),direction:z.enum(['incoming','outgoing','both']).optional(),
    sourceFiles:z.array(z.string()).max(64).optional(),relationTypes:z.array(z.string()).max(64).optional(),
    relationMeanings:z.array(z.string()).max(64).optional(),relationOrigins:z.array(z.string()).max(64).optional(),
    ontologyTypes:z.array(z.string()).max(64).optional(),
    recordKinds:z.array(z.enum(['design-record','design-content','design-artifact'])).max(64).optional(),
    identityQualities:z.array(z.enum(['stable','structural','anonymous'])).max(64).optional(),
  }, true)
  register('design_begin_main_bundle', 'beginMainBundle', 'Begin or recover a Bundle configured for main-conversation execution. Returns an invocation ID, not a child agent ID.', { skill: z.string().min(1) })
  register('design_prepare_auto_panel', 'prepareAutoPanel', 'Prepare a bounded UI-only task for this saved Bundle. Use the same native model to answer its prompt and submit components; never modify Design Files for UI generation. Ready means no generation needed.', { skill: z.string().min(1) })
  register('design_submit_auto_panel', 'submitAutoPanel', 'Submit native model components for the exact returned request ID. If repair-required, follow its prompt once; failed/stale/expired requires new preparation, not a Design File edit.', {
    requestId: z.string().uuid(), components: z.array(z.unknown()).max(256),
  })
  register('design_finish_main_bundle', 'finishMainBundle', 'Settle the main Bundle using shared validation, checkpoint and handoff. Does not end the main session.', {
    invocationId: z.string().uuid(), scope: z.enum(['state', 'completion']).optional(), outcome: z.enum(['complete', 'pause', 'failed', 'cancelled', 'no-progress']).optional(),
  })
  register('design_register_run', 'registerNativeRun', 'Bind an actual native Producer/Worker to its design target. Server verifies exact native identity, parent and project ownership.', {
    ...nativeLaunch.shape, role: z.enum(['producer', 'worker']), skill: z.string().min(1), artifactId: z.string().min(1),
    artifactKind: z.string().optional(), artifactFile: z.string().optional(),
    invocationId: z.string().uuid().optional().describe('Required for a Worker spawned directly by the main Agent; exact begin_main_bundle invocation.'),
  })
  register('design_focus_artifact', 'focusArtifact', 'Associate serial artifact work with the existing main Bundle invocation or verified Producer native run. Does not create an agent/attempt, write Design state or accept an artifact. Supply exactly one runId or invocationId; stable artifact IDs cannot be rebound.', {
    runId: nativeId.optional(), invocationId: z.string().uuid().optional(),
    artifact_kind: z.string().min(1), artifact_id: z.string().min(1), artifact_file: z.string().min(1),
  }, false, value => value, ({ artifact_kind, artifact_id, artifact_file, ...identity }) => ({ ...identity,
    artifactKind: artifact_kind, artifactId: artifact_id, artifactFile: artifact_file }))
  register('design_finish_run', 'finishNativeRun', 'Validate on-disk files and checkpoint the registered run through existing settlement. This does not mark a native agent stopped.', {
    runId: nativeId, scope: z.enum(['state', 'completion']).optional(), outcome: z.enum(['complete', 'pause', 'failed', 'cancelled', 'no-progress']).optional(),
  })
  register('design_prepare_review', 'prepareReview', 'Prepare one existing bounded background review. Skip spawning when the returned request is not new; never wait for GRA in foreground.', {
    profile: z.enum(['grounding', 'reflection', 'alignment', 'clarity']),
    userContext: z.string().max(8192).optional().describe('Current user intent and current editing scope, including requests to simplify or defer. Not authority to change Design Files.'),
  })
  register('design_read_review_policy', 'readReviewPolicy', 'Read the existing project GRA policy. A read never changes policy or dispatches reviews.', {}, true)
  register('design_update_review_policy', 'updateReviewPolicy', 'Update the existing project GRA policy ONLY after the user selects a change. For off, preserve existing interval fields from design_read_review_policy; manual design_recheck_reviews remains available. Never change policy merely because background execution is unavailable.', {
    policy:z.object({mode:z.enum(['auto','continuous','off']),autoMergeWindowMs:z.number().int().min(0).max(3600000),continuousIntervalMs:z.number().int().min(60000).max(86400000).optional()}).strict(),
  })
  register('design_recheck_reviews', 'recheckReviews', 'ONLY for an explicit human request to check/recheck Design. May run while GRA is off or already completed; does not change the user policy. Keep requestId and executionMode unchanged when retrying. Default background retains ordinary dispatch ownership and native binding. Use executionMode=foreground ONLY when the user chooses to occupy the main conversation for this batch: main reads each request and submits its result without nativeRun, not a new child or model client. Never call autonomously or silently fall back to foreground.', {
    requestId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/),
    profiles:z.array(z.enum(['grounding','reflection','alignment'])).min(1).max(3).optional(),
    userContext:z.string().max(8192).optional(),
    executionMode:z.enum(['background','foreground']).optional(),
  })
  register('design_bind_review', 'bindReviewRun', 'Bind an exact native runId or Codex launch reference. The adapter resolves paths and verifies native evidence; never search session files yourself.', { reviewId: z.string().min(1), nativeRun:nativeLaunch })
  register('design_prepare_reviews', 'prepareReviews', 'Prepare selected independent reviews together, returning short references. Only dispatch=true is new work; reused requests require inspection, not duplicate spawning. Does not spawn agents.', {
    profiles: z.array(z.enum(['grounding', 'reflection', 'alignment', 'clarity'])).min(1).max(4).optional().describe('Normally omit: service selects G/R/A, without another U/S/T evaluator. Explicit subsets are for scoped reviews or diagnostics.'),
    userContext: z.string().max(8192).optional(),
  })
  register('design_read_review', 'readReview', 'Reviewer reads its exact request, schema and registered binding directly. Changed or superseded evidence must not be presented as current. Does not create or start work.', { reviewId: z.string().min(1) }, true)
  register('design_bind_reviews', 'bindReviewRuns', 'Bind up to four exact native reviewers in one call. Each binding is independently verified; inspect per-item errors. Does not discover or guess identities.', {
    bindings: z.array(z.object({ reviewId: z.string().min(1), nativeRun:nativeLaunch }).strict()).min(1).max(4),
  })
  // Publish the shared result types in the tool itself, so native tool bridges
  // receive actual numbers/arrays rather than an untyped nested object. Preserve
  // extra fields for the bound server's exact profile validation and optional KAG
  // error isolation: a bad relationship must not discard otherwise valid advice.
  const reviewResult = z.union([
    ...[OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_ALIGNMENT_PROFILE]
      .map(id => z.fromJSONSchema({ ...officialAdvisoryProfile(id).outputSchema, additionalProperties: true })),
    z.fromJSONSchema(DESIGN_CLARITY_OUTPUT_SCHEMA),
  ], { error: 'Use the exact result schema from design_read_review: numeric fields must stay numbers (GRA schemaVersion is 1), and collection fields/facets must be JSON arrays, never {item: ...} wrappers.' })
  register('design_submit_review', 'submitReview', 'Submit the typed JSON result for the exact schema from design_read_review. Background requests require their registered nativeRun and unchanged native proof. Only an already prepared explicit manual foreground request permits main to omit nativeRun. The server validates stored execution mode, main session, profile, evidence and result; a submission cannot change mode.', {
    reviewId: z.string().min(1), nativeRun:nativeRun.optional(), result: reviewResult,
  })
  register('design_read_review_action', 'readReviewAction', 'Read accepted advice, current pins and candidate hints before choosing a response. Grants no execution authority.', { advisoryId:z.string().min(1) }, true)
  register('design_select_review_action', 'selectReviewAction', 'Record a revalidated choice for accepted advice: a suitable Bundle, host questioning/research, or no action. Only Bundle selection returns an exact execution receipt. Markers are hints, not bindings; selecting is not executing.', {
    advisoryId:z.string().min(1), acceptanceReceiptId:z.string().min(1),
    kind:z.enum(['bundle','host-question','host-research','no-action']),reason:z.string().min(1).max(2048),
    revision:z.number().int().nonnegative(),skillName:z.string().min(1).optional(),
    currency:z.object({checkpoint:z.string(),worktreeRevision:z.string(),kit:z.string(),version:z.string(),relationVocabularyRevision:z.string()}).strict(),
  })
  for (const [name, method, description] of [
    ['design_claim_action', 'claimReviewAction', 'Claim a user-accepted advisory receipt for its exact registered waiting Producer. Does not accept advice.'],
    ['design_settle_action', 'settleReviewAction', 'Settle an already claimed action after files and native execution end. Server derives the outcome.'],
  ]) register(name, method, description, { receiptId: z.string().min(1), runId: nativeId.optional(), invocationId: z.string().uuid().optional() })
  return server
}

export async function startDesignMcp(options) {
  const server = createDesignMcp(options)
  await server.connect(new StdioServerTransport())
  return server
}
