/** Producer attribution for Yugoo's DSH messages; delivery remains Host-owned. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'

/** `kind` identifies the producer; a notice retains its own presentation metadata. */
export type YugooDesignMessageSource = { readonly kind: 'yugoo-design' } & (
  | { readonly form?: never }
  | { readonly form: 'notice'; readonly summary: string }
)

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'yugoo-design': YugooDesignMessageSource
  }
}

/**
 * Construct plugin-authored context or a delegated task without claiming human
 * input. Callers still choose the existing inject/followup delivery operation.
 * Explicit user commands use the Host's ordinary `kind: 'user'` path instead.
 */
export function createYugooDesignMessage(input: {
  readonly content: Parameters<typeof createUserMessage>[0]['content']
  readonly notice?: string
}): UserMessage {
  return createUserMessage({
    content: input.content,
    source: input.notice === undefined
      ? { kind: 'yugoo-design' }
      : { kind: 'yugoo-design', form: 'notice', summary: input.notice },
  })
}
