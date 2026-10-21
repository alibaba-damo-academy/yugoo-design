import source from 'design-graph-layout-worker-source'
import type { GraphScope } from './graph-model.js'
import type { Positions } from './graph-layout.mjs'

/** One owned Worker per view job. Superseded synchronous solvers are terminated. */
export function createGraphLayoutJob(scope: GraphScope, engine: string, positions: Positions, dragged?: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  let worker: Worker
  try { worker = new Worker(url) } finally { URL.revokeObjectURL(url) }
  let settled = false, rejectJob: (reason: Error) => void
  const timer = setTimeout(() => cancel(new Error('布局超过 30 秒；请缩小到记录概览或关联邻域。')), 30000)
  const result = new Promise<Positions>((resolve, reject) => {
    rejectJob = reject
    worker.onmessage = ({ data }) => {
      if (settled) return
      settled = true; clearTimeout(timer); worker.terminate()
      if (data.error) reject(new Error(data.error))
      else resolve(new Map(data.positions))
    }
    worker.onerror = event => cancel(new Error(event.message || 'Layout worker failed'))
    try { worker.postMessage({ scope, engine, positions: [...positions], dragged }) }
    catch (error) { cancel(error instanceof Error ? error : new Error(String(error))) }
  })
  function cancel(reason = new Error('Layout cancelled')) {
    if (settled) return
    settled = true; clearTimeout(timer); worker.terminate(); rejectJob(reason)
  }
  return { result, cancel }
}
