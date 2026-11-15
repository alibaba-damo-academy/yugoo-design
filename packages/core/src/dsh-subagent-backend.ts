import type { Context } from '@deepseek-ai/cordis'

/** Capability shapes verified against the supported native Host SDKs. */
export function dshSubagentBackend(runtime: unknown, owner: string, agents?: unknown): 'one-shot-runtime' | 'agent-factory' {
  if (runtime === null || typeof runtime !== 'object') throw new Error(`${owner}: native Subagent Runtime is unavailable`)
  const shape = runtime as Record<string, unknown>
  if (typeof shape.start === 'function' && typeof shape.registerProvider === 'function') return 'one-shot-runtime'
  // Activation identifies the modern runtime; scoped children use agents.get
  // and agents.create, not its preparation/wait methods (changed in DSH 0.2.2).
  // Check the capabilities we actually consume before choosing that backend.
  const factory = agents as Record<string, unknown> | null | undefined
  if (shape.start === undefined && typeof shape.startActivation === 'function'
    && factory && typeof factory.get === 'function' && typeof factory.create === 'function') return 'agent-factory'
  throw new Error(`${owner}: unsupported native Subagent Runtime API`)
}

/** Keep bounded children on the Host's native executor, including under a PTC parent. */
export async function selectDshChildNativeTools(ctx: Context): Promise<void> {
  const tools = ctx.tools as unknown as {
    presentAs?: (mode: 'native') => void
    setExecutor?: (executor: unknown) => unknown
  }
  if (typeof tools.presentAs === 'function') {
    tools.presentAs('native')
    return
  }
  if (typeof tools.setExecutor !== 'function') throw new Error('design child: native tool executor API is unavailable')
  // This optional Host peer did not exist on legacy SDKs. Resolve it only for
  // the explicit executor API; a failed import/start must not broaden tools.
  const hostExecutor = '@deepseek-ai/dsh-tool-executor-native'
  const { NativeToolExecutor } = await import(hostExecutor)
  tools.setExecutor(new NativeToolExecutor(ctx))
}
