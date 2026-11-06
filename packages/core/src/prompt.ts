/**
 * Model-visible design context. The running design-state summary is published as
 * a per-turn runtime-context snapshot (`ctx.systemPrompt.context`), which the
 * agent loop logs and automatically re-emits after compaction removes it.
 */
import type { PromptAssemblyLike, SystemPromptLike } from './dsh-contracts.ts'

/** Re-evaluate live text at assembly and Host request refresh. Transport literal
 * opening braces through a constant variable: the Host replaces each once and
 * never rescans the value. The model receives the exact original evidence.
 */
export function registerLiteralDesignContext(
  systemPrompt: SystemPromptLike,
  name: string,
  order: number,
  variable: string,
  render: (context: PromptAssemblyLike) => string,
): () => void {
  const removeVariable = systemPrompt.variable(variable, () => '{{')
  const removeContext = systemPrompt.context({ name, order,
    text: context => render(context).replaceAll('{{', `{{${variable}}}`) })
  return () => { removeContext(); removeVariable() }
}

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
  return registerLiteralDesignContext(systemPrompt, 'design:state', 600, 'design_state', render)
}
