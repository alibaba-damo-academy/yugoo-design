/**
 * Main-Agent orchestration surface for derived Design Knowledge (KAG) and GRA
 * reviews. The lower runtime keeps only safety invariants; these tools are how the main
 * Agent exercises judgement: read the honest compact state, start at most one
 * bounded maintenance pass for the current generation, and trigger only the
 * review profiles that are actually due. Every action returns a structured
 * accepted/noop/rejected result with the exact target identity, and none of
 * them ever loops or retries on its own.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type DesignService from './design-service.ts'

/** Register the KAG/GRA orchestration tools for the main Agent. */
export function registerKnowledgeOrchestrationTools(ctx: Context, design: DesignService): void {
  ctx.tools.register(defineTool({
    name: 'design_read_review_action',
    description: 'Read the complete findings, references and existing acceptance/action receipts for one exact advisoryId (the full run/result identity, never an item id or entityRefs). Grounding and fixed-target advice are readable too; only review-choice advice includes Kit catalog candidate hints for a subsequent choice. Revalidate the specific accepted finding and current evidence, never substitute another issue in the same Bundle. This read does not accept advice, mint receipts or grant execution authority.',
    parameters: { advisoryId: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      return { content: JSON.stringify(await design.reviewActionOptions(exec.agent, args.advisoryId)) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'design_select_review_action',
    description: 'After reading options and revalidating a user-accepted advisory, select one suitable Bundle or host-question/host-research/no-action with a reason. Markers are hints, not bindings. Only a Bundle choice returns an exact action receipt for run_design_skill. Host choices never authorize Design File writes. Selection does not itself execute or complete the work.',
    parameters: {
      advisoryId: { type: 'string', required: true }, acceptanceReceiptId: { type: 'string', required: true },
      kind: { type: 'string', enum: ['bundle', 'host-question', 'host-research', 'no-action'], required: true },
      reason: { type: 'string', required: true }, revision: { type: 'number', required: true },
      projectId: { type: 'string', required: true }, selectionRevision: { type: 'number', required: true },
      kitName: { type: 'string', required: true }, kitVersion: { type: 'string', required: true },
      skillName: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      return { content: JSON.stringify(await design.selectReviewAction(exec.agent, args)) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'design_knowledge_status',
    description: 'Read the compact honest status of the selected Design Project\'s derived knowledge (KAG) and GRA review freshness. Pure read: never starts indexing, reviews, or any background work. KAG state is one of current/due/queued/running/failed/disabled/unavailable/unknown with the target head, the latest-complete published head, and freshness. Review statuses are per profile: completed (with the exact reviewed revision/commit), due, never-reviewed, not-reviewable, or no-design-yet, plus any real runtime phase. Use this to decide whether a bounded refresh or only-due reviews are worth starting; reads of a stale KAG or the Design Files themselves never require freshness.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }] },
    async execute(_args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      const [knowledge, reviews, reviewPolicy] = await Promise.all([
        design.knowledgeStatusSnapshot(exec.agent, exec.signal),
        design.reviewStatuses(exec.agent),
        design.readReviewPolicy(exec.agent,exec.signal).catch(error=>({unavailable:true,error:String(error)})),
      ])
      return { content: JSON.stringify({ knowledge: knowledge ?? { state: 'unavailable', reason: 'no selected Design Project or knowledge runtime' }, reviews, reviewPolicy }) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'design_refresh_knowledge',
    description: 'Ask for at most ONE bounded KAG maintenance pass for the current project generation (file projection plus, when configured, semantic embedding). Returns accepted, noop (already current or already queued/running), or rejected with a reason and the exact target checkpoint/generation. Never blocks the conversation, never edits Design Files, and never retries by itself: a failed generation stays failed until you explicitly request again or the recovery retry gate applies. Only start this when changed design facts will materially benefit upcoming queries, reviews, or cross-Bundle decisions; opening a project or reading files does not require it.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }],
    },
    async execute(_args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      const result = await design.requestKnowledgeMaintenance(exec.agent, exec.signal)
      return { content: JSON.stringify(result) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'design_request_reviews',
    description: 'Trigger only the GRA review profiles that are due for the latest settled Design revision. Optional profiles list (grounding/reflection/alignment ids); omitted means every due profile. Returns accepted with the triggered profiles, noop when nothing is due or the same revision is already scheduled/running, or rejected with a reason. Reviews run detached against the published Git commit, never block the conversation, and publish advice through the ordinary advisory inbox; they are worth triggering when newly settled design content may carry cross-file inconsistencies, doubtful domain knowledge, or decisions only the user can clarify — not after every trivial save.',
    parameters: {
      profiles: { type: 'array', items: { type: 'string' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      const result = await design.requestReviews(exec.agent, args.profiles, exec.signal)
      return { content: JSON.stringify(result) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'design_recheck_reviews',
    description: 'Use ONLY when the user explicitly asks to check or recheck the current Design with GRA. Unlike design_request_reviews, this can re-examine an already completed revision. Supply a fresh portable requestId for each distinct user request and reuse exactly that id for any retry of the same request. Optional profiles limit grounding/reflection/alignment; omitted means all configured profiles. A same-target active review returns a no-op without consuming this requestId or starting a duplicate. The review remains detached and never requires a current KAG snapshot.',
    parameters: {
      requestId: { type: 'string', required: true },
      profiles: { type: 'array', items: { type: 'string' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      const result = await design.requestManualReviews(exec.agent, args.requestId, args.profiles, exec.signal)
      return { content: JSON.stringify(result) }
    },
  }))
}
