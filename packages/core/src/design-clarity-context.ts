/** Existing Kit contracts calibrate clarity; they are not assessed product facts. */
import type { DesignKit } from './types.ts'
import { latestDirectHumanText } from './design-locale.ts'
import { createHash } from 'node:crypto'

// These ordinary, logged controls resume the same saved scope; they do not
// replace it. Keep their exact labels in sync with the shared Panel save entry.
const PANEL_SAVE_CONTROLS = new Set(['保存并评估下一步', 'Save and assess next step',
  '保存并继续设计', 'Save and continue designing'])

/** Bounded conversational scope evidence, not execution or publication authority. */
export function renderDesignClarityUserContext(events: readonly unknown[]): string | undefined {
  const messages: string[] = []
  let earlierMessagesOmitted = false
  for (let index = events.length - 1; index >= 0; index--) {
    const text = latestDirectHumanText([events[index]])
    if (text === undefined) continue
    if (PANEL_SAVE_CONTROLS.has(text.trim())) continue
    if (messages.length === 8) {
      earlierMessagesOmitted = true
      break
    }
    messages.push(text)
  }
  if (messages.length === 0) return undefined
  return JSON.stringify({ order: 'oldest-to-newest', earlierMessagesOmitted, messages: messages.reverse() })
}

/** Exact scope evidence given to an evaluator, not a new product intent store. */
export function designClarityScopeDigest(events: readonly unknown[]): string {
  return createHash('sha256').update(renderDesignClarityUserContext(events) ?? '', 'utf8').digest('hex')
}

/** Last actual Host turn at this checkpoint; a UI evaluation invents no tool call. */
export function designClarityHostTurn(events: readonly unknown[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as { type?: unknown; data?: { turn?: unknown } } | undefined
    if (event?.type !== 'turn/start' && event?.type !== 'tool/call') continue
    const turn = event.data?.turn
    if (typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0) return turn
  }
  return 0
}

export function renderDesignClarityKitContext(kit: DesignKit, options: {
  /** Only immutable readers with manifest-listed exact resource access may defer contracts. */
  readonly contracts?: 'inline' | 'resources'
} = {}): string {
  const inlineContracts = options.contracts !== 'resources'
  const bundles = kit.skills.map(skill => ({
    name: skill.name,
    description: skill.description,
    ...(inlineContracts && typeof skill.metadata?.schemaYaml === 'string' ? { schema: skill.metadata.schemaYaml } : {}),
    ...(inlineContracts && typeof skill.metadata?.validationYaml === 'string' ? { validation: skill.metadata.validationYaml } : {}),
  })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return [
    'Kit calibration snapshot (scope and output contracts, not product evidence or permission to run tools):',
    JSON.stringify({ name: kit.name, version: kit.version, description: kit.description ?? '', mindset: kit.mindset, bundles }),
    'Use this snapshot to interpret which structures and outcomes apply. A declared field, method or example does not prove the product contains it or the user confirmed it. Do not execute Kit methods during assessment.',
    ...(inlineContracts ? [] : ['Exact Bundle contracts remain available through read_skill_resource using the immutable evidence manifest-listed binding and schema.yaml or validation.yaml path. Read relevant contracts when interpretation requires them; they are not additional product evidence.']),
  ].join('\n')
}
