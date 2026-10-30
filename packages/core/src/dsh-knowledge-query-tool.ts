/** Read-only access to the existing graph, bound by native Agent ancestry. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type DesignService from './design-service.ts'

export type { KnowledgeReadArguments } from './design-knowledge-query.ts'

export const KNOWLEDGE_QUERY_DEADLINE_MS = 10_000

/** Bound an optional KAG read even when a storage driver fails to settle. */
export async function boundedKnowledgeQuery<T>(
  read: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  deadlineMs = KNOWLEDGE_QUERY_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController()
  const abortFromParent = (): void => { controller.abort(parentSignal?.reason ?? new Error('Knowledge query cancelled')) }
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timeout = setTimeout(() => { controller.abort(new Error(`Design Knowledge query timed out after ${deadlineMs}ms`)) }, deadlineMs)
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = (): void => { reject(controller.signal.reason ?? new Error('Knowledge query cancelled')) }
    if (controller.signal.aborted) rejectAbort()
    else controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  try {
    return await Promise.race([read(controller.signal), aborted])
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

export function registerKnowledgeQueryTool(ctx: Context, design: DesignService) {
  ctx.tools.register(defineTool({
    name: 'design_query_knowledge',
    description: 'Read the selected Design Project ontology-aware unified KAG for generation, revision or review; never writes or starts indexing. Locate relevant constraints, dependencies or change impacts with text/sourceFiles, exact entityIds/relationIds, or generated ontologyTypes, recordKinds and identityQualities. These are projection facts, not authored roles. Continue with page.nextOffset and the same revision. Empty ID arrays select none of that type. Subagents must pass project, checkpoint and revision from their delegated task or review context, originally returned by a real query. Candidate relationships are not established facts. Unloaded endpoints or a partial page do not prove absence. Zero matches only means no records matched the combined filters in that snapshot; they do not prove a missing source fact, an incomplete index or an embedding failure. evidence.sourceReadRequired=true always requests source verification, including for matches; it is not a failure or lag flag. Use design_knowledge_status and available coverage to assess freshness and embedding readiness separately. If unavailable or stale, continue from the pinned Design Files; do not repeatedly retry.',
    parameters: {
      project: { type: 'string' }, checkpoint: { type: 'string' }, revision: { type: 'string' },
      text: { type: 'string', description: 'Filter by a case-insensitive literal substring across serialized projected entities and relations. Spaces are literal; this is not tokenized or vector search. Prefer a short verbatim keyword from source evidence.' }, offset: { type: 'integer' }, limit: { type: 'integer' },
      entityIds: { type: 'array', items: { type: 'string' } }, relationIds: { type: 'array', items: { type: 'string' } },
      incidentTo: { type: 'array', items: { type: 'string' } }, direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] },
      sourceFiles: { type: 'array', items: { type: 'string' }, description: 'Filter by exact provenance.evidence[].source values. Copy the recorded Design-Files-relative path verbatim; do not add a host root or design_files/ prefix.' }, relationTypes: { type: 'array', items: { type: 'string' } },
      relationMeanings: { type: 'array', items: { type: 'string' } }, relationOrigins: { type: 'array', items: { type: 'string' } },
      ontologyTypes: { type: 'array', items: { type: 'string' } },
      recordKinds: { type: 'array', items: { type: 'string', enum: ['design-record', 'design-content', 'design-artifact'] } },
      identityQualities: { type: 'array', items: { type: 'string', enum: ['stable', 'structural', 'anonymous'] } },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      const result = await boundedKnowledgeQuery(
        signal => design.queryStoredKnowledge(exec.agent!, args, signal),
        exec.signal,
      )
      return { content: JSON.stringify(result) }
    },
  }))
}
