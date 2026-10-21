/** Original MCP App owns delivery; queue acceptance is never agent completion. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { requireThreadId } from './codex-connection.mjs'
export function createWorkBuddyConnection({ threadId, queue, timeoutMs = 35000 }) {
  requireThreadId(threadId)
  return { host: 'workbuddy', threadId, async send(text) {
    const id = randomUUID()
    try { queue.submit(id,text) } catch (error) { throw Object.assign(Error(`WorkBuddy 当前连接不可用：${error.message} 已保存文件不受影响。`), { notSubmitted:true }) }
    const end = Date.now()+timeoutMs
    while (Date.now()<end) {
      const status=queue.status(id).message?.status
      if (status==='submitted_unverified') return { accepted:true, status, messageId:id }
      if (status==='delivery_unknown') return { accepted:false, status:'unknown', messageId:id }
      if (status==='not_delivered') return { accepted:false, status:'unavailable', notSubmitted:true, messageId:id }
      await delay(50)
    }
    return { accepted:false, status:'unknown', messageId:id }
  } }
}
