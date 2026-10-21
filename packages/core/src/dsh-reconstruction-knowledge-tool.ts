import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type DesignService from './design-service.ts'
import { reconstructionKnowledge } from './reconstruction-knowledge.ts'

const evidence = { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
  path: { type: 'string', required: true }, quote: { type: 'string', required: true },
} } } as const
const common = {
  id: { type: 'string', required: true }, kind: { type: 'string', required: true },
  summary: { type: 'string', required: true }, evidence,
} as const

/** Optional source-evidence memory; callers choose when and what to retrieve. */
export function registerReconstructionKnowledgeTool(ctx: Context, design: DesignService): void {
  ctx.tools.register(defineTool({
    name: 'design_reconstruction_knowledge',
    description: 'Optional evidence graph for an explicitly requested reconstruction from local evidence. Query with source_root and optional text. Batch upsert stable entities and relations after material inspection or Bundle completion, with exact short UTF-8 source quotes. This optional graph does not extract text from images, PDFs or video; skip graph writes for those materials. For a single-file source, evidence.path must identify that exact file (absolute path or its basename), not neighboring files. Reuse IDs to correct earlier interpretations. All records remain AI-proposed, never user-accepted. File hashes include uncommitted changes. Do not store secrets or whole source files. Failure does not block reconstruction: continue with source files and report the limitation.',
    parameters: {
      source_root: { type: 'string', required: true }, text: { type: 'string' },
      entities: { type: 'array', items: { type: 'object', additionalProperties: false, properties: common } },
      relations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        ...common, from: { type: 'string', required: true }, to: { type: 'string', required: true },
      } } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('A calling Agent is required')
      const agent = exec.agent
      try {
        const relationVocabulary = design.kitForAgent(agent)?.relationVocabulary
        const relationVocabularyRevision = relationVocabulary?.revision ?? 'legacy-unavailable'
        const { sourceRoot } = await design.inspectReconstructionSource(args.source_root, exec.signal)
        const result = await design.withSelectedKnowledge(agent, async (service, project, checkpoint) => {
          const currentVocabulary = design.kitForAgent(agent)?.relationVocabulary
          if ((currentVocabulary?.revision ?? 'legacy-unavailable') !== relationVocabularyRevision) {
            throw new Error('Reconstruction relation vocabulary changed')
          }
          return reconstructionKnowledge(service, project.projectId, checkpoint, sourceRoot, args, relationVocabulary)
        })
        return { content: JSON.stringify(result) }
      } catch (error) {
        exec.signal.throwIfAborted()
        return { content: JSON.stringify({ available: false, diagnostic: String(error), next: 'Continue reconstruction from files. Correct invalid evidence if appropriate; do not repeatedly retry an unavailable graph.' }) }
      }
    },
  }))
}
