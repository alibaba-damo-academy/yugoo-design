/** DeepSeek Harness adapter for non-waking Design System advice. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createYugooDesignMessage } from './dsh-message-source.ts'
import {
  renderDesignAdvisoryReminder,
  type AdvisoryDeliveryPort,
  type DesignAdvisory,
} from './design-advisory.ts'

/** Durable advisory publication surface owned by the Design System seam. */
export interface AdvisoryPublishPort {
  /**
   * Persist one advisory for the agent's conversation before any notice is
   * delivered. Rejecting the publication must prevent the inbox notice.
   * @param agent - owning main Agent whose session scopes the publication.
   * @param advisory - trusted bounded advisory.
   */
  publishAdvisory(agent: Agent, advisory: DesignAdvisory): Promise<void>
}

/**
 * DSH delivery uses the ordinary Agent inject path: the spliced inbox notice
 * is a built-in `agent/inbox/spliced` event the host already understands, and
 * a running Agent may consume it at a later step without being woken.
 */
export const DSH_ADVISORY_DELIVERY: AdvisoryDeliveryPort<Agent> = Object.freeze({
  injectNextBoundary(agent: Agent, advisory: DesignAdvisory): void {
    agent.inject(createYugooDesignMessage({
      content: [{ type: 'text', text: renderDesignAdvisoryReminder(advisory) }],
      notice: `design ${advisory.kind}: ${advisory.id}`,
    }))
  },
})

/**
 * Publish one DSH advisory through the durable port, then the Agent's
 * non-waking inbox notice path. The notice is injected only after the port's
 * publication resolves; a rejected publication fails loud and never injects.
 * @param port - durable advisory publication surface.
 * @param agent - owning main Agent and Session.
 * @param advisory - trusted bounded advisory.
 */
export async function publishDshDesignAdvisory(
  port: Pick<AdvisoryPublishPort, 'publishAdvisory'>,
  agent: Agent,
  advisory: DesignAdvisory,
): Promise<void> {
  await port.publishAdvisory(agent, advisory)
  await DSH_ADVISORY_DELIVERY.injectNextBoundary(agent, advisory)
}

function escapeReminderText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Render the durable unresolved advisory projection for the main Agent.
 * @param advisories - current bounded advisories in review priority order.
 * @returns source-attributed model context for one natural Agent boundary.
 */
export function renderDshDesignAdvisorySetReminder(advisories: readonly DesignAdvisory[]): string {
  const actionable = advisories.filter(advisory => advisory.attention === 'human-review')
  const lines = [
    `<design-advisory-set count="${advisories.length}" actionable="${actionable.length}">`,
    'This is the current durable Design advisory projection for recommendation routing. Each review loop publishes independently; this aggregate is a display projection, not an atomic G/R/A result.',
  ]
  for (const advisory of advisories) {
    lines.push(`- [${escapeReminderText(advisory.profile)}] ${escapeReminderText(advisory.summary)}`)
  }
  if (actionable.length > 0) {
    lines.push(`When offering the next host-native Design choice, reserve one option for reviewing these ${actionable.length} current advisory item(s). The review option does not accept advice or run a Bundle.`)
  }
  lines.push('Advice remains non-authoritative until the user explicitly accepts it.', '</design-advisory-set>')
  return lines.join('\n')
}
