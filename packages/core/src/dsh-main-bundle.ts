/** A Bundle engagement in the existing Agent; never starts or impersonates a child. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DshProducerAgentRequest, DshProducerSkillAgentRuntime } from './dsh-producer-agent.ts'
import { registerDshProducerDesignTools, type DesignProducerFinishReceipt } from './dsh-producer-design-tools.ts'
import { renderResult, type RunDesignSkillPort, type RunDesignSkillResult } from './dsh-run-design-skill-tool.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type Slot = {
  ready: ReturnType<typeof deferred<RunDesignSkillResult>>
  receipt: ReturnType<typeof deferred<DesignProducerFinishReceipt>>
  outcome: Promise<RunDesignSkillResult>
  callback?: (result: RunDesignSkillResult) => Promise<void>
  dispose?: () => Promise<void>
  skillName: string
  projectId?: string
  invocationId?: string
  brief?: string
  settled: boolean
}
const slots = new WeakMap<Agent, Slot>()
const interrupted = new WeakMap<Agent, { skillName: string; brief?: string }>()

/** Existing live engagement, not another scheduler or persisted execution status. */
export function activeMainBundleWork(agent: Agent, projectId?: string): { skillName: string; brief?: string; projectId?: string; invocationId?: string } | undefined {
  const slot = slots.get(agent)
  if (!slot || (projectId !== undefined && slot.projectId !== projectId)) return undefined
  return { skillName: slot.skillName, ...(slot.brief ? { brief: slot.brief } : {}),
    ...(slot.projectId === undefined ? {} : { projectId: slot.projectId }),
    ...(slot.invocationId === undefined ? {} : { invocationId: slot.invocationId }) }
}

/** A prior main-mode invocation lost its scoped capability before publication. */
export function interruptedMainBundleWork(agent: Agent): { skillName: string; brief?: string } | undefined {
  const work = interrupted.get(agent)
  return work === undefined ? undefined : { ...work }
}

/** Share the existing engagement/settlement pipeline; only its execution location changes. */
export function createMainBundleBridge(fallback: DshProducerSkillAgentRuntime) {
  const runtime: DshProducerSkillAgentRuntime = {
    async run(request: DshProducerAgentRequest) {
      const slot = slots.get(request.parent)
      if (!slot) return fallback.run(request)
      const fiber = request.parent.ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(ctx) {
        ctx.tools.restrict({ allow: [...request.allowedInheritedTools] })
        ctx.systemPrompt.section({ name: 'design:main-bundle', order: 550, text: request.systemPrompt })
        registerDshProducerDesignTools(ctx, request.workspace, request.resources, request.handoff,
          request.activity, request.delegation?.settlementDiagnostics, request.scripts,
          request.allowedInheritedTools, request.reconstructionSourceRoot, async receipt => {
            slot.settled = true
            interrupted.delete(request.parent)
            slot.receipt.resolve(receipt)
            // Includes shared handoff derivation, synchronous clarity and advisory settlement.
            return renderResult(await slot.outcome)
          })
        request.delegation?.install(ctx)
        ctx.on('tools/post-execute', async (exec, result, next) => {
          const decision = await next()
          if (exec.agent !== request.parent) return decision
          const blocked = decision.kind === 'block'
          const value = decision.kind === 'accept' && Object.hasOwn(decision, 'value') ? decision.value : result.value
          await request.activity.observeTool({ name: exec.name, arguments: exec.arguments,
            isError: result.isError || blocked, ...(!result.isError && !blocked ? { value } : {}) })
          return decision
        })
      } })
      slot.dispose = async () => { await fiber.dispose() }
      await fiber
      request.signal.throwIfAborted()
      slot.ready.resolve({ kind: 'in_progress', summary: `${request.prompt}\nExecute this Bundle here in the main conversation with the installed Design tools. Do not spawn a Producer. Worker delegation remains available when the Bundle calls for it. Use design_publish to settle the Bundle and receive its handoff/clarity result before proposing the next action.` })
      return slot.receipt.promise
    },
  }
  return {
    runtime,
    wrap(port: RunDesignSkillPort, isMain: (agent: Agent, skill: string) => boolean,
      selectedProjectId?: (agent: Agent, signal: AbortSignal) => Promise<string | undefined> | string | undefined): RunDesignSkillPort {
      return {
        ...port,
        onMainSettlement(agent, callback) {
          const slot = slots.get(agent)
          if (!slot) throw new Error('No active main Bundle engagement')
          slot.callback = callback
        },
        async run(request) {
          if (slots.has(request.agent)) return { kind: 'invalid', summary: 'Finish or cancel the active Bundle before starting another.' }
          if (!isMain(request.agent, request.name)) return port.run(request)
          request.signal.throwIfAborted()
          const projectId = await selectedProjectId?.(request.agent, request.signal)
          request.signal.throwIfAborted()
          if (slots.has(request.agent)) return { kind: 'invalid', summary: 'Finish or cancel the active Bundle before starting another.' }
          const abort = new AbortController()
          const slot: Slot = { ready: deferred(), receipt: deferred(), skillName: request.name,
            projectId, invocationId: request.invocationId,
            brief: request.brief?.slice(0, 8192), settled: false,
            outcome: Promise.resolve({ kind: 'invalid', summary: 'Not started' }) }
          // Installation can fail before runtime reaches the receipt await.
          void slot.receipt.promise.catch(() => {})
          slots.set(request.agent, slot)
          interrupted.delete(request.agent)
          const cancel = () => {
            if (!slot.settled) interrupted.set(request.agent, {
              skillName: slot.skillName,
              ...(slot.brief === undefined ? {} : { brief: slot.brief }),
            })
            abort.abort()
            slot.receipt.reject(new Error('Main Bundle ended before publication; working files are preserved.'))
          }
          const removeStopping = request.agent.ctx.on('agent/turn-stopping', ({ agent }) => {
            if (agent === request.agent) cancel()
          })
          // The initial tool signal owns preparation, not the subsequent main-Agent tools.
          request.signal.addEventListener('abort', cancel, { once: true })
          slot.outcome = port.run({ ...request, signal: abort.signal }).then(async result => {
            await slot.callback?.(result)
            return result
          }).finally(async () => {
            request.signal.removeEventListener('abort', cancel)
            removeStopping()
            try { await slot.dispose?.() }
            finally { slots.delete(request.agent) }
          })
          try {
            return await Promise.race([slot.ready.promise, slot.outcome])
          } finally {
            request.signal.removeEventListener('abort', cancel)
          }
        },
      }
    },
  }
}
