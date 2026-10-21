import type { GraphScope } from './graph-model.js'
export type Positions = Map<string, { x: number; y: number; z?: number }>
export function recordRadius(count: number): number
export function recordGroups(scope: GraphScope): Map<string, GraphScope['nodes']>
export function initialPositions(scope: GraphScope, previous?: Positions): Positions
export function solveLayout(scope: GraphScope, engine: string, previous?: Positions, fixed?: Set<string>): Promise<Positions>
export function solveDraggedNeighborhood(scope: GraphScope, positions: Positions, id: string): Promise<Positions>
