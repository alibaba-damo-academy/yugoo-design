/** Rule admission for hosts whose reviewer launch remains owned by the native Agent.
 * Delivery acceptance is NOT reviewer execution. Never blindly replay a delivery.
 */
import { randomUUID } from 'node:crypto'
import { DesignContinuousReviewClock } from '../../core/lib/index.js'
export function createNativeReviewScheduler({ reviews, project, connection, getConnectionPath, getPolicy, canDispatch = async () => true, onError = () => {} }) {
  let timer, closed = false, draining = false, tail = Promise.resolve()
  const reduce = operation => reviews.publicationQueue(operation)
  const clock = new DesignContinuousReviewClock(async () => {
    if (closed || draining || (await getPolicy()).mode !== 'continuous' || !await canDispatch()) return
    if ((await reviews.readReviewStatus()).some(row=>['prepared','running'].includes(row.status))) return
    if (!(await project.refreshAccess()).writable) return
    const workspace = await project.readWorkspace()
    if (!workspace.checkpoint || closed || (await getPolicy()).mode !== 'continuous') return
    const revision = await reviews.publishedRevision(workspace.checkpoint)
    await drain({checkpoint:workspace.checkpoint,revision,context:'',exactPublication:true,cycleId:`periodic-${randomUUID()}`})
  }, onError)
  function schedule(delay) {
    clearTimeout(timer)
    timer = setTimeout(() => void drain().catch(onError), delay)
    timer.unref?.()
  }
  async function pending() {
    const policy = await getPolicy()
    clock.configure(policy)
    return reduce((queue, state) => {
      queue.configure(policy)
      if (policy.mode === 'off' && state.nativeDelivery?.status === 'prepared-unavailable') state.nativeDelivery.status = 'cancelled-policy'
      const retry = state.nativeDelivery?.status === 'prepared-unavailable'
      return { size: queue.size + (retry ? 1 : 0), delay: retry ? 0 : queue.delay(Date.now()) }
    })
  }
  async function drain(periodicTarget) {
    if (closed || draining) return
    draining = true
    try {
      const policy = await getPolicy()
      // Keep the existing queue intact while native background readiness is
      // unknown. Never test a synchronous fallback with a real review prompt.
      if (periodicTarget && policy.mode !== 'continuous' || !await canDispatch()) return
      const pendingDelivery = await reduce((queue, state) => {
        queue.configure(policy)
        const prior = state.nativeDelivery
        const target = periodicTarget ?? (prior?.status === 'prepared-unavailable' ? prior.target : undefined) ?? queue.take(Date.now())
        if (target) state.nativeDelivery = { checkpoint: target.checkpoint, status: 'preparing' }
        return { target, refs: prior?.status === 'prepared-unavailable' && prior.checkpoint === target?.checkpoint ? prior.requests : undefined }
      })
      const { target } = pendingDelivery
      if (!target || closed) return
      if (!(await project.refreshAccess()).writable) throw new Error('Project Kit is not writable')
      const refs = pendingDelivery.refs ?? (await reviews.preparePublicationReviews(target)).requests.filter(item => item.dispatch)
      if (!refs.length) return
      const latestPolicy = await getPolicy()
      if (closed || latestPolicy.mode === 'off' || (periodicTarget && latestPolicy.mode !== 'continuous')) return
      if (!await canDispatch()) {
        // No transport attempt occurred. Retain these exact prepared references
        // for recovery instead of fabricating execution or preparing duplicates.
        await reduce((queue, state) => {
          state.nativeDelivery = { checkpoint: target.checkpoint, target, status: 'prepared-unavailable', requests: refs }
        })
        return
      }
      // Persist the attempt BEFORE entering a transport that may accept a
      // message and then throw. Restart cannot safely infer non-delivery.
      await reduce((_queue, state) => { state.nativeDelivery = { checkpoint: target.checkpoint, status: 'delivery-unknown', requests: refs } })
      const result = await (connection.sendEvent ?? connection.send)([
        `Design Project: ${project.project.metadata.name}\nDesign Files: ${project.project.designFilesRoot}`,
        `Background GRA rule notice; connection: ${getConnectionPath()}. Published checkpoint: ${target.checkpoint}.`,
        `Exact prepared review references: ${JSON.stringify(refs)}.`,
        'Read the project GRA policy first. If off, do not launch these automatic reviews. Otherwise use the plugin native-execution reference to launch independent native background reviewers for these exact IDs, then bind the actual native launches in one batch. Each reviewer reads its own request and submits its own result. These reviews are immutable publication snapshots: a historical revision is intentional, not permission to change its target. Do not prepare another batch, wait for reviews, busy-poll, or block the user task. If the host cannot spawn native children, report that capability limitation; a queued notice is not a running reviewer.',
      ].join('\n\n'))
      await reduce((_queue, state) => { state.nativeDelivery = { checkpoint: target.checkpoint, status: result?.accepted === true ? 'queued' : 'delivery-unknown', requests: refs } })
    } catch (error) { onError(error) }
    finally {
      try {
        // The final queue read still owns storage. Keep close() joined until
        // every drain operation is done, not merely the transport callback.
        if (!closed) {
          const next = await pending()
          if (!closed && next.size && await canDispatch()) schedule(next.delay)
        }
      } finally { draining = false }
    }
  }
  return {
    notify(_context = '', workspace) {
      const next = tail.then(async () => {
        if (closed || !workspace?.checkpoint || !(await project.refreshAccess()).writable) return
        const policy = await getPolicy()
        const revision = await reviews.publishedRevision(workspace.checkpoint)
        const admitted = await reduce(queue => {
          queue.configure(policy)
          return queue.publish({ checkpoint: workspace.checkpoint, revision, context: '', exactPublication: true }, Date.now())
        })
        if (!closed && admitted && await canDispatch()) { const next = await pending(); schedule(next.delay) }
      })
      tail = next.catch(() => {})
      return next
    },
    async configure() { clearTimeout(timer); const next = await pending(); if (!closed && next.size && await canDispatch()) schedule(next.delay) },
    async resumePending() { const next = await pending(); if (!closed && next.size && await canDispatch()) schedule(next.delay) },
    async close() {
      closed = true; clearTimeout(timer)
      clock.close()
      await tail
      while (draining) await new Promise(resolve => setTimeout(resolve, 10))
    },
  }
}
