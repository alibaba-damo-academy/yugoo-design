/** DSH Web/Desktop share this read-only project tool and Core implementation. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type DesignService from './design-service.ts'
import { DESIGN_GIT_READ_ACTIONS, DESIGN_GIT_READ_DESCRIPTION } from './design-git-read.ts'

export function registerDesignGitReadTool(ctx: Context, design: DesignService): void {
  ctx.tools.register(defineTool({
    name: 'design_git_read', description: DESIGN_GIT_READ_DESCRIPTION,
    parameters: {
      action: { type: 'string', required: true, enum: [...DESIGN_GIT_READ_ACTIONS] },
      project: { type: 'string' }, checkpoint: { type: 'string' }, from: { type: 'string' },
      path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('A calling Agent is required')
      const timeout = AbortSignal.timeout(30_000)
      const signal = exec.signal ? AbortSignal.any([exec.signal, timeout]) : timeout
      return { content: JSON.stringify(await design.queryDesignGit(exec.agent, args, signal)) }
    },
  }))
}
