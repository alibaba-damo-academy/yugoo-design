/** Read-only access to the existing graph, bound by native Agent ancestry. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type DesignService from './design-service.ts'

export type { KnowledgeReadArguments } from './design-knowledge-query.ts'

/** Follow native caller cancellation without imposing a separate query deadline.
 * The race releases this tool wait; an uncooperative storage read may continue. */
export async function cancellableKnowledgeQuery<T>(
  read: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return read()
  signal.throwIfAborted()
  let rejectAbort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(signal.reason ?? new Error('Knowledge query cancelled'))
    signal.addEventListener('abort', rejectAbort, { once: true })
  })
  try {
    return await Promise.race([read(signal), cancelled])
  } finally {
    signal.removeEventListener('abort', rejectAbort)
  }
}

export function registerKnowledgeQueryTool(ctx: Context, design: DesignService) {
  ctx.tools.register(defineTool({
    name: 'design_query_knowledge',
    description: 'Read the selected Design Project ontology-aware unified KAG for generation, revision or review; never writes or starts indexing. Locate relevant constraints, dependencies or change impacts with text/sourceFiles, exact entityIds/relationIds, or generated ontologyTypes, recordKinds and identityQualities. These are projection facts, not authored roles. The Host binds every caller, including a Producer or Worker, to its selected project through native ancestry. A first query needs only relevant filters; retain the returned project, checkpoint and revision for pagination or an explicitly snapshot-bound task. Continue with page.nextOffset and unchanged filters and pins. Empty ID arrays select none of that type. Candidate relationships are not established facts. Unloaded endpoints or a partial page do not prove absence. Zero matches only means no records matched the combined filters in that snapshot; they do not prove a missing source fact, an incomplete index or an embedding failure. evidence.sourceReadRequired=true always requests source verification, including for matches; it is not a failure or lag flag. Use available coverage and design_knowledge_status when exposed to assess freshness and embedding readiness separately. If unavailable or stale, continue from the Design Files; do not repeatedly retry.',
    parameters: {
      project: { type: 'string' }, checkpoint: { type: 'string' }, revision: { type: 'string' },
      text: { type: 'string', description: 'Filter by a case-insensitive literal substring across serialized projected entities and relations. Spaces are literal; this is not tokenized or vector search. Prefer a short verbatim keyword from source evidence.' }, offset: { type: 'integer' }, limit: { type: 'integer', description: 'Page size per entity/relation list: 1–100, default 30. Continue with page.nextOffset and the same revision.' },
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
      const result = await cancellableKnowledgeQuery(
        signal => design.queryStoredKnowledge(exec.agent!, args, signal),
        exec.signal,
      )
      return { content: JSON.stringify(result) }
    },
  }))
}
