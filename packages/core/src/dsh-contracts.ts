/**
 * Structural contracts for the dsh services this plugin consumes.
 *
 * The design system is an external plugin: it builds standalone against cordis
 * and binds these services at mount time through the shared Cordis context.
 * Each interface mirrors the real dsh surface (dsh-system-prompt and dsh-tools)
 * closely enough to register correctly; when the plugin is compiled
 * against the harness, these can be swapped for the packages' own types.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'

/** A per-turn runtime-context contribution (`ctx.systemPrompt.context`). */
export interface PromptContextLike {
  name: string
  order: number
  text: (context: PromptAssemblyLike) => string
}

/** Agent-aware fields supplied for one Harness prompt assembly. */
export interface PromptAssemblyLike {
  readonly agent?: Agent
  readonly scope?: object
  readonly signal?: AbortSignal
}

/** The system-prompt service surface used here. */
export interface SystemPromptLike {
  section(section: { name: string; order: number; text: (context: PromptAssemblyLike) => string }): () => void
  context(context: PromptContextLike): () => void
}

/** Subprocess spawn handle (adapted from `ctx.subprocess.spawn`). */
export interface SubprocessHandleLike {
  readonly stdout?: AsyncIterable<Uint8Array>
  done: Promise<{ exitCode: number | null }>
  collected?: {
    stdout?: { readFrom(offset: number): { text: string } }
    stderr?: { readFrom(offset: number): { text: string } }
  }
}

/** The subprocess service (`ctx.subprocess`). */
export interface SubprocessLike {
  spawn(request: {
    argv: readonly string[]
    cwd: string
    stdio?: unknown
    env?: Readonly<Record<string, string>>
    graceMs?: number
    signal?: AbortSignal
  }): SubprocessHandleLike
}
