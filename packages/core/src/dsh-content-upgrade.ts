/** Native DSH semantic migration: scoped candidate tools, real Agent receipt, one Core adoption. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createYugooDesignMessage } from './dsh-message-source.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { applyChildComposition, appendDelegatedPolicyOverrides, captureDelegatedPolicyOverrides,
  resolveChildAgentOptions, resolveChildDepth, snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { designUnseededChildSessionMeta } from './dsh-child-session-meta.ts'
import { designSessionEvents } from './dsh-session-events.ts'
import type DesignService from './design-service.ts'
import type { DesignProjectKitPin } from './design-project.ts'
import type { ProjectContentMigration, NativeContentMigrationEvidence } from './project-content-migration.ts'
import { markContentRecoveryTool } from './dsh-content-recovery-tool.ts'

const textOutput = { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
  render: (_args: unknown, value: { content: string }) => [{ type: 'text' as const, text: value.content }] } as const

/** No generic filesystem/shell tools are inherited by this child. */
export async function runNativeContentMigration(input: {
  parent: Agent; migration: ProjectContentMigration; plan: Awaited<ReturnType<ProjectContentMigration['prepare']>>
  signal: AbortSignal; maxTokens?: number; maxDepth?: number
}): Promise<{ proof: object; evidence: NativeContentMigrationEvidence }> {
  const { parent, plan, signal } = input
  signal.throwIfAborted()
  const candidate = await input.migration.candidate(plan.id)
  let evidence: NativeContentMigrationEvidence | undefined
  let primary: unknown
  const depth = resolveChildDepth(parent, input.maxDepth)
  const sessionId = SessionId(randomUUID())
  const policy = captureDelegatedPolicyOverrides(parent)
  const descriptor = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'dsh-design-content-upgrade', label: 'Design content upgrade' })
  const filesRoot = join(plan.candidateRoot, 'design_files')
  const handle = await parent.ctx.agents.create({ sessionId,
    meta: { ...designUnseededChildSessionMeta(parent, depth), cwd: filesRoot },
    agentOptions: resolveChildAgentOptions(parent, input.maxTokens === undefined ? undefined : { maxTokens: input.maxTokens }, depth), signal,
    async setup(ctx, child) {
      if (!child) throw new Error('upgrade: native child Agent is unavailable')
      applyChildComposition(ctx, parent, { toolFilter: { allow: [] } })
      appendDelegatedPolicyOverrides(child.session, policy)
      let appended = false
      ctx.on('agent/pre-step', async (execution, next) => {
        const decision = await next()
        if (execution.agent === child && !appended && decision.kind === 'enter') { appended = true; child.session.append('subagent/descriptor', descriptor) }
        return decision
      })
      ctx.systemPrompt.section({ name: 'design:content-upgrade', order: 550, text: `${plan.method}\nRead BOTH required definitions with read_upgrade_definition, paging through every part before validation. They retain complete changed domain methods and output contracts, related contracts and shared constraints without repeated compiled forms. availableResources lists every original method/resource for exact on-demand reading; resource=complete retains the full original Kit. Read additional evidence whenever needed to preserve semantics. Use only the installed candidate capabilities. Saved facts and existing resources are authoritative; do not create requirements merely to satisfy a target field. Call validate_upgrade with semantic accounting for every original canonical file. If it returns diagnostics, repair in this same Agent and validate again. When facts cannot be translated without a new decision, return needs-user-input with precise questions. Never edit the live project or its pin. Stop after accepted validation; Core publishes only after the Host verifies your normal native terminal event.` })
      ctx.tools.register(defineTool({ name: 'read_upgrade_definition', description: 'Read the required complete affected methods/contracts/shared constraints, or one exact original resource. Page both required sides fully; all original definitions remain available on demand.',
        parameters: { side: { type: 'string', required: true, enum: ['source', 'target'] }, offset: { type: 'integer', required: true }, resource: { type: 'string' } }, output: textOutput,
        async execute(args) {
          signal.throwIfAborted()
          return { content: JSON.stringify(await candidate.readDefinition(args.side as 'source' | 'target', args.offset, args.resource)) }
        } }))
      ctx.tools.register(defineTool({ name: 'list_upgrade_files', description: 'List files in the isolated candidate. No live project reads.', parameters: {}, output: textOutput,
        async execute() {
          signal.throwIfAborted()
          return { content: JSON.stringify(await candidate.list()) }
        } }))
      ctx.tools.register(defineTool({ name: 'read_upgrade_file', description: 'Read a UTF-8 candidate Design File. Use offsets for long files.',
        parameters: { path: { type: 'string', required: true }, offset: { type: 'integer', required: true } }, output: textOutput,
        async execute(args) {
          signal.throwIfAborted()
          return { content: JSON.stringify(await candidate.read(args.path, args.offset)) }
        } }))
      ctx.tools.register(defineTool({ name: 'write_upgrade_file', description: 'Replace one candidate UTF-8 Design File. Metadata, definitions and live project are outside this capability.',
        parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } }, output: textOutput,
        async execute(args) {
          signal.throwIfAborted()
          await candidate.write(args.path, args.content)
          evidence = undefined
          return { content: 'Candidate updated; no live files or pins changed.' }
        } }))
      ctx.tools.register(defineTool({ name: 'validate_upgrade', description: 'Validate semantic accounting and existing target contracts. Validation is not publication; unknown domain facts require user input.',
        parameters: {
          status: { type: 'string', required: true, enum: ['equivalent', 'needs-user-input'] }, summary: { type: 'string', required: true },
          sources: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { file: { type: 'string', required: true }, explanation: { type: 'string', required: true } } } },
          unresolvedFacts: { type: 'array', required: true, items: { type: 'string' } },
        }, output: textOutput,
        async execute(args) {
          signal.throwIfAborted()
          candidate.assertDefinitionsRead()
          const submitted: NativeContentMigrationEvidence = { ...args, status: args.status as NativeContentMigrationEvidence['status'] }
          if (submitted.status === 'needs-user-input' && submitted.unresolvedFacts.length) { evidence = submitted; return { content: 'User input required. Candidate preserved; no adoption.' } }
          try { await input.migration.validateCandidate(plan.id, submitted); evidence = submitted; return { content: 'Candidate accepted for Host settlement. Finish this native turn.' } }
          catch (error) { evidence = undefined; return { content: JSON.stringify({ accepted: false, diagnostics: [String(error)], next: 'Repair this candidate in this same native Agent; do not change saved facts to satisfy a validator.' }) } }
        } }))
      // DSH restrictions filter inherited/global definitions; these local
      // capabilities remain visible in the owning child scope. Naming local
      // definitions in tools.restrict would be rejected by the real registry.
    },
  })
  const child = handle.agent
  const cancel = () => child.cancel({ kind: 'parent' })
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const boundary = designSessionEvents(child.session).length
    child.followup(createYugooDesignMessage({ content: [{ type: 'text', text: `Migrate this isolated candidate from its complete source to target definitions. Project ${plan.projectId}, source checkpoint ${plan.sourceCheckpoint}. ${plan.method}` }] }))
    await child.whenIdle()
    signal.throwIfAborted()
    const ends = designSessionEvents(child.session).slice(boundary).filter(event => event.type === 'turn/end')
    if (!ends.length || ends.some(event => event.data.reason?.kind !== 'completed')) throw new Error('upgrade: native Producer did not complete normally; candidate preserved')
    if (!evidence) throw new Error('upgrade: native Producer ended without accepted semantic evidence; candidate preserved')
    // This object exists only in the Host closure after a real normal native terminal event.
    return { proof: Object.freeze({ sessionId, parentSessionId: parent.session.id, candidateRoot: plan.candidateRoot }), evidence }
  } catch (error) { primary = error; throw error }
  finally {
    signal.removeEventListener('abort', cancel)
    try { await handle.dispose() } catch (error) { if (primary === undefined) throw error }
  }
}

/** One attached native upgrade entry. No separate scheduler, model client or registry authority. */
export function registerContentUpgradeTool(ctx: Context, design: DesignService, config: { producerMaxTokens?: number; producerMaxDepth?: number }): void {
  const active = new Set<string>()
  ctx.tools.register(defineTool({ name: 'design_upgrade_content',
    description: 'Explicitly upgrade the selected existing Design Project to an installed exact Kit version and optional mounted Bundle versions. Runs an isolated native semantic Producer over complete affected methods/contracts with the full exact source/target closure available on demand; adopts the same project only after existing target validation and semantic accounting. No version ranges, latest fallback, guessed facts or live file edits. Call only for the user-requested upgrade.',
    parameters: { kit: { type: 'string', required: true }, version: { type: 'string', required: true },
      bundles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', required: true }, version: { type: 'string', required: true },
      } } } }, output: textOutput,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('upgrade: a calling native Agent is required')
      const project = await design.projectForAgent(exec.agent, exec.signal)
      if (active.has(project.projectId)) throw new Error('upgrade: this project already has a native migration running')
      active.add(project.projectId)
      let accepted: object | undefined
      try {
        const migration = await design.contentMigrationFor(exec.agent, {
          assertQuiescent: () => design.assertContentUpgradeQuiescent(project.projectId),
          verifyNativeProducer: async (proof, root) => {
            if (!accepted || proof !== accepted || (accepted as { candidateRoot: string }).candidateRoot !== root) throw new Error('upgrade: actual confined native Producer receipt required')
          },
        })
        if (args.bundles && new Set(args.bundles.map(bundle => bundle.name)).size !== args.bundles.length) throw new Error('upgrade: duplicate Bundle identity')
        const pin: DesignProjectKitPin = { name: args.kit, version: args.version as DesignProjectKitPin['version'],
          ...(args.bundles === undefined ? {} : { bundles: Object.fromEntries(args.bundles.map(bundle => [bundle.name, bundle.version])) as DesignProjectKitPin['bundles'] }) }
        const plan = await migration.prepare(pin)
        const result = await runNativeContentMigration({ parent: exec.agent, migration, plan, signal: exec.signal,
          ...(config.producerMaxTokens === undefined ? {} : { maxTokens: config.producerMaxTokens }),
          ...(config.producerMaxDepth === undefined ? {} : { maxDepth: config.producerMaxDepth }) })
        accepted = result.proof
        if (result.evidence.status === 'needs-user-input') return { content: JSON.stringify({ adopted: false, candidateId: plan.id, ...result.evidence }) }
        const receipt = await migration.finish(plan.id, result.proof, result.evidence)
        await design.projectForAgent(exec.agent, exec.signal)
        return { content: JSON.stringify({ adopted: true, ...receipt, semanticEvidence: result.evidence }) }
      } finally { active.delete(project.projectId) }
    },
  }))
  ctx.tools.register(defineTool({ name: 'design_resolve_disconnected_panels',
    description: 'Ask the actual user whether disconnected Design Panel drafts were abandoned. Clears only the exact still-disconnected observations after native user confirmation. Does not save files, discard live drafts or start an upgrade.',
    parameters: {}, output: textOutput, async execute(_args, exec) {
      if (!exec.agent) throw new Error('upgrade: a calling native Agent is required')
      return { content: JSON.stringify(await design.resolveDisconnectedProjectPanels(exec.agent, exec.signal)) }
    } }))
  ctx.tools.register(markContentRecoveryTool(defineTool({ name: 'design_recover_content_upgrade', description: 'Recover an already authorized adoption after interruption. Reconciles exact Git commit, original project identity, bytes and idempotent journal; never starts another migration.',
    parameters: {}, output: textOutput, async execute(_args, exec) {
      if (!exec.agent) throw new Error('upgrade: a calling native Agent is required')
      return { content: JSON.stringify({ recovered: await design.recoverContentMigrationFor(exec.agent) ?? null }) }
    } })))
}
