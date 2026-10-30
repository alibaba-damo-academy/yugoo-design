/** Resolve continuation intent; execution stays in the visible native tool chain. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { designSessionEvents } from './dsh-session-events.ts'
import type { DesignExecutionGate } from './design-execution-runtime.ts'

type Gate = Extract<DesignExecutionGate, { kind: 'user_continue' }>

/** Only claimed, direct human input may produce a continuation-tool hint. */
export function installDesignResumeRouting(
  ctx: Context,
  resolveGate: (agent: Agent, text: string, signal: AbortSignal) => Promise<Gate | undefined>,
): void {
  const controls = new WeakMap<Agent, { turn: number; texts: string[]; eventOffset: number }>()
  const pending = new WeakMap<Agent, { turn: number; gate: Gate; eventOffset: number }>()
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    if (agent.session.header.origin === 'subagent' || message.source.kind !== 'user') return
    pending.delete(agent)
    const current = controls.get(agent)
    const entry = current?.turn === turn ? current : { turn, texts: [], eventOffset: designSessionEvents(agent.session).length }
    // Mixed/attachment-bearing human input is never interpreted as a bare control.
    entry.texts.push(message.content.length === 1 && message.content[0]?.type === 'text'
      ? message.content[0].text : '')
    controls.set(agent, entry)
  })
  ctx.on('agent/turn-stopping', ({ agent }) => {
    controls.delete(agent)
    pending.delete(agent)
  })
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context.agent
    if (agent === undefined || context.signal === undefined) return next()
    const entry = controls.get(agent)
    controls.delete(agent)
    if (entry === undefined || entry.texts.length !== 1 || entry.texts[0] === '') return next()
    const signal = context.signal
    const gate = await resolveGate(agent, entry.texts[0]!, signal)
    if (gate === undefined) return next()
    signal.throwIfAborted()
    // Do not await Producer work here: assembly precedes the native tool row.
    // The ordinary tool revalidates the current gate and human authorization.
    pending.set(agent, { turn: entry.turn, gate, eventOffset: entry.eventOffset })
    // The SDK resolves section providers before this waterfall. Update this
    // request's existing section so the hint reaches the first model step.
    const section = assembly.sections.find(section => section.name === 'design:accepted-resume')
    if (section !== undefined) section.text = continuationText(agent)
    return next()
  })
  ctx.systemPrompt.section({
    name: 'design:accepted-resume', order: 580,
    text: ({ agent }) => continuationText(agent),
  })

  function continuationText(agent: Agent | undefined): string {
    if (agent === undefined) return ''
    const intent = pending.get(agent)
    if (intent === undefined) return ''
    // The real tool result owns subsequent steps, including failure. Never
    // keep injecting this request and accidentally force automatic retries.
    if (designSessionEvents(agent.session).slice(intent.eventOffset).some(event => event.type === 'tool/call'
      && event.data.turn === intent.turn && event.data.name === 'run_design_skill')) {
      pending.delete(agent)
      return ''
    }
    const args = { name: intent.gate.pin.skillName, action: { routeId: intent.gate.action.routeId } }
    return `The current human message matches a pending Design continuation. It has NOT started yet. Briefly acknowledge it visibly, then call run_design_skill with exactly ${JSON.stringify(args)}. Do not add a brief (that would revise the plan), ask for confirmation again, or execute the Bundle by another route. The tool revalidates the current gate and authorization. In Producer mode stay attached to its visible execution/logs; in main mode follow the returned scoped method. After the tool returns, follow its actual outcome; do not automatically retry failures.`
  }
}
