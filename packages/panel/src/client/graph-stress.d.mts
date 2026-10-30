import type { GraphScope } from './graph-model.js'
/** Pure production Stress solver; never changes input identities or relations. */
export function stressPositions(graph: Pick<GraphScope, 'nodes' | 'edges'>, mode: string): Array<[string, { x: number; y: number; z: number }]>
