/** Capability shapes verified against the supported native Host SDKs. */
export function dshSubagentBackend(runtime: unknown, owner: string): 'one-shot-runtime' | 'agent-factory' {
  if (runtime === null || typeof runtime !== 'object') throw new Error(`${owner}: native Subagent Runtime is unavailable`)
  const shape = runtime as Record<string, unknown>
  if (typeof shape.start === 'function' && typeof shape.registerProvider === 'function') return 'one-shot-runtime'
  if (shape.start === undefined && ['startActivation', 'prepareContinuable', 'waitForChildren', 'registerProvider']
    .every(key => typeof shape[key] === 'function')) return 'agent-factory'
  throw new Error(`${owner}: unsupported native Subagent Runtime API`)
}
