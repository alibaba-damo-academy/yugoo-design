/** Conversation-locale authority for user-facing Design text. */
import type { DesignBilingualText } from './types.ts'

/** One conversation language the Design System renders user-facing text in. */
export type DesignLocale = 'zh' | 'en'

/** Structural view of one user-message payload carrying text blocks. */
interface DirectHumanEvent {
  readonly type: 'user/message'
  readonly data: {
    readonly source?: { readonly kind?: string }
    readonly content?: readonly { readonly type: string; readonly text?: string }[]
  }
}

function isDirectHumanEvent(value: unknown): value is DirectHumanEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as { type?: unknown; data?: unknown }
  if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) return false
  const data = event.data as { source?: unknown; content?: unknown }
  if (data.source !== undefined && (typeof data.source !== 'object' || data.source === null)) return false
  if (data.content !== undefined && !Array.isArray(data.content)) return false
  return true
}

/** Character bound of the latest direct-human text retained for language detection and advisory prose. */
export const DESIGN_LOCALE_CONTEXT_CHARACTERS = 6_000

/**
 * Extract the latest direct-human message text from a host session event log.
 * Scans newest-first for a `user/message` event sourced by the human, joins its
 * text blocks, and bounds the tail; tool outputs, notices, and model messages
 * never influence the result. Accepts any host event union and narrows
 * structurally, so locale resolution stays host-agnostic.
 * @param events - host session events in log order.
 * @returns the bounded latest human text, or undefined when none exists.
 */
export function latestDirectHumanText(events: readonly unknown[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (!isDirectHumanEvent(event) || event.data.source?.kind !== 'user') continue
    const message = (event.data.content ?? [])
      .flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text.trim()] : [])
      .filter(Boolean)
      .join('\n')
    if (message === '') continue
    return message.slice(-DESIGN_LOCALE_CONTEXT_CHARACTERS)
  }
  return undefined
}

/**
 * Resolve the conversation locale from the latest direct-human text. Chinese
 * script marks the conversation Chinese; anything else, including the absence
 * of human text, resolves to the English fallback.
 * @param latestHumanText - bounded latest human message text, if any.
 * @returns the resolved conversation locale.
 */
export function resolveConversationLocale(latestHumanText: string | undefined): DesignLocale {
  return latestHumanText !== undefined && /[\u3400-\u9fff\uf900-\ufaff]/u.test(latestHumanText) ? 'zh' : 'en'
}

/**
 * Select one language of validated bilingual text for a locale. The loader
 * guarantees both languages are non-empty, and English remains the fallback
 * language of record.
 * @param text - loader-validated bilingual text.
 * @param locale - the conversation locale to render.
 * @returns the locale's text.
 */
export function designText(text: DesignBilingualText, locale: DesignLocale): string {
  return locale === 'zh' ? text.zh : text.en
}
