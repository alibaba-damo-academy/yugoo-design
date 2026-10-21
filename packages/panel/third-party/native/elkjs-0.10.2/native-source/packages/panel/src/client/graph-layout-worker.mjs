import { solveLayout, solveDraggedNeighborhood } from './graph-layout.mjs'
import { stressPositions } from './graph-stress.mjs'
self.onmessage = async ({ data }) => {
  try {
    const positions = data.engine.startsWith('stress2') || data.engine.startsWith('stress3')
      ? new Map(stressPositions(data.scope, data.engine))
      : data.dragged
      ? await solveDraggedNeighborhood(data.scope, new Map(data.positions), data.dragged)
      : await solveLayout(data.scope, data.engine, new Map(data.positions))
    self.postMessage({ positions: [...positions] })
  } catch (error) { self.postMessage({ error: String(error) }) }
}
