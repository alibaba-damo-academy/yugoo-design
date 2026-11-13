/** Explicit advisory acceptance uses the existing Host notice and waking inbox. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionDesignAdvisory } from './design-advisory-events.ts'
import { createYugooDesignMessage } from './dsh-message-source.ts'
import { designSessionEvents } from './dsh-session-events.ts'

export interface AdvisoryAcceptanceDelivery {
  readonly notification: 'sent' | 'failed' | 'unknown'
  readonly notificationError?: string
}

/** Native log evidence, including queued messages not yet claimed by the Agent. */
function alreadyDelivered(agent: Agent, reference: string): boolean {
  const matches = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false
    const message = value as { source?: { kind?: string; form?: string }; content?: { type?: string; text?: string }[] }
    return message.source?.kind === 'yugoo-design' && message.source.form === 'notice'
      && Array.isArray(message.content) && message.content.some(part => part.type === 'text'
        && typeof part.text === 'string' && part.text.split('\n').includes(reference))
  }
  return designSessionEvents(agent.session).some(event => event.type === 'user/message'
    ? matches(event.data)
    : event.type === 'agent/inbox/spliced' && event.data.inserted.some(matches))
}

/**
 * Called only after the real accepted disposition/paired receipts are durable.
 * Host metadata owns the collapsed human account; content retains actual facts
 * and authority. A queued notice is not proof of execution or completion.
 */
export function deliverDshAdvisoryAcceptance(agent: Agent, entry: SessionDesignAdvisory): AdvisoryAcceptanceDelivery {
  if (!entry.acceptanceReceiptId || !entry.actionReceipts || !entry.executionStatus) {
    return { notification: 'failed', notificationError: 'Accepted advisory authority is unavailable.' }
  }
  const reference = `Acceptance receipt (selection evidence only): ${entry.acceptanceReceiptId}`
  try {
    if (alreadyDelivered(agent, reference)) return { notification: 'sent' }
    const advisory = entry.advisory
    const context = advisory.acceptanceInstruction?.trim() || [advisory.summary,
      ...advisory.items.map(item => [item.title, item.detail, item.rationale, ...item.references].filter(Boolean).join('\n')),
    ].join('\n')
    const summary = advisory.summary.replace(/\s+/gu, ' ').trim()
    agent.followup(createYugooDesignMessage({
      notice: /[\u3400-\u9fff]/u.test(summary) ? `已接受设计建议：${summary}` : `Accepted design suggestion: ${summary}`,
      content: [{ type: 'text', text: [
        'This design advisory was accepted. Revalidate its specific findings against current Design Files before acting.',
        `advisoryId: ${JSON.stringify(advisory.id)}`,
        context,
        reference,
        `Exact action receipts (the acceptance receipt is NOT execution authority): ${JSON.stringify(entry.actionReceipts)}`,
        'Use design_read_review_action with this exact advisoryId when more context is needed. Only each exact action receipt authorizes its paired Bundle. A review-choice without action receipts requires reading and selecting an appropriate action first. Do not replace the finding, invent authority, write files directly, or start unrelated work. Notification delivery is not execution or completion.',
      ].join('\n\n') }],
    }))
    return { notification: 'sent' }
  } catch (error) {
    // followup can admit a message before a later observer throws. Inspect the
    // durable inbox before offering retry, rather than enqueueing it twice.
    try {
      if (alreadyDelivered(agent, reference)) return { notification: 'sent' }
      return { notification: 'failed', notificationError: error instanceof Error ? error.message : String(error) }
    } catch {
      return { notification: 'unknown', notificationError: 'Notice admission could not be verified. Check the original conversation before retrying.' }
    }
  }
}
