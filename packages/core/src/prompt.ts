/**
 * Model-visible design context. The running design-state summary is published as
 * a per-turn runtime-context snapshot (`ctx.systemPrompt.context`), which the
 * agent loop logs and automatically re-emits after compaction removes it.
 */
import type { PromptAssemblyLike, SystemPromptLike } from './dsh-contracts.ts'

/**
 * Register the design-state runtime context.
 * @param systemPrompt - the system-prompt service.
 * @param render - returns the current design-state summary text (empty hides it).
 * @returns a disposer that removes the context.
 */
export function registerDesignStateContext(
  systemPrompt: SystemPromptLike,
  render: (context: PromptAssemblyLike) => string,
): () => void {
  return systemPrompt.context({
    name: 'design:state',
    order: 600,
    text: (context) => render(context),
  })
}
