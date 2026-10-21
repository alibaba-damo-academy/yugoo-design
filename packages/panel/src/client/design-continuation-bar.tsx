/**
 * Native continuation bar for the host composer area.
 *
 * When the Runtime exposes a current user-continue gate,
 * the host presents Continue / Later / Adjust
 * above the chat composer instead of a panel-owned button. Continue sends the
 * manifest-owned resume label through the ordinary composer path, opening a
 * new user turn; Later dismisses only the current local rendering; Adjust
 * focuses the composer so the user can rephrase. This host-owned interaction
 * is the only visible resume control; Bundle panels remain pure design views.
 */
import { useState, type ReactElement } from 'react'
import type { DesignContinuationDescriptor } from 'dsh-design-core/design-continuation'
import { currentLanguage } from './ported/host.ts'

/**
 * Select the newest real pending continuation exposed by the Runtime.
 * @param continuations - current authoritative workspace gate projection.
 * @returns the frozen descriptor, or undefined when nothing is pending.
 */
export function designContinuationOf(
  continuations: readonly DesignContinuationDescriptor[] | undefined,
): DesignContinuationDescriptor | undefined {
  let selected: DesignContinuationDescriptor | undefined
  for (const descriptor of continuations ?? []) {
    if (selected === undefined
      || (descriptor.journalRevision !== undefined
        && (selected.journalRevision === undefined || descriptor.journalRevision > selected.journalRevision))) {
      selected = descriptor
    }
  }
  return selected
}

/**
 * Dismissal identity of one Runtime gate. A new invocation resurfaces the bar,
 * even when the Bundle reuses the same action route.
 * @param descriptor - pending continuation.
 * @returns the stable dismissal key.
 */
export function continuationDismissKey(descriptor: DesignContinuationDescriptor): string {
  return `${descriptor.skill}\u0000${descriptor.routeId}\u0000${descriptor.invocationId}`
}

/**
 * Pick the resume label in the active UI language, mirroring the panel's
 * manifest-label fallback (active language first, the other as fallback).
 * @param descriptor - pending continuation.
 * @returns the label text to send on Continue.
 */
export function continuationLabelOf(descriptor: DesignContinuationDescriptor): string {
  const { zh, en } = descriptor.label
  return currentLanguage() === 'zh_CN' ? (zh || en) : (en || zh)
}

/**
 * Pick the skill display title in the active UI language, falling back to the
 * raw skill id when the manifest declares no bilingual title.
 * @param descriptor - pending continuation.
 * @returns the localized skill title for the bar.
 */
export function continuationSkillTitleOf(descriptor: DesignContinuationDescriptor): string {
  const title = descriptor.title
  if (title === undefined) return descriptor.skill
  return currentLanguage() === 'zh_CN' ? (title.zh || title.en) : (title.en || title.zh)
}

/** Props for the native continuation bar. */
export interface IDesignContinuationBarProps {
  /** Pending continuation; absent renders nothing. */
  descriptor?: DesignContinuationDescriptor
  /** Sends the exact resume label through the ordinary composer path. */
  onContinue: (label: string) => void
  /** Focuses the empty composer so the user can adjust the request. */
  onAdjust?: () => void
}

/**
 * Render Continue / Later / Adjust for one pending continuation. Later only
 * dismisses the current local rendering (no durable state is consumed); the
 * bar returns whenever the projection still carries the same pending
 * descriptor after a remount.
 * @param props - descriptor plus host continue/adjust handlers.
 * @returns the bar element, or null when gated out or locally dismissed.
 */
export function DesignContinuationBar(props: IDesignContinuationBarProps): ReactElement | null {
  const descriptor = props.descriptor
  const [dismissed, setDismissed] = useState<string | null>(null)
  const isZh = currentLanguage() === 'zh_CN'
  if (descriptor === undefined) return null
  const key = continuationDismissKey(descriptor)
  if (dismissed === key) return null
  const label = continuationLabelOf(descriptor)
  return (
    <div className='dsh-design-continuation' data-testid='dsh-design-continuation-bar'>
      <div className='dsh-design-continuation-text'>
        <span className='dsh-design-continuation-skill'>{continuationSkillTitleOf(descriptor)}</span>
        {descriptor.summary === undefined ? null : <span>{descriptor.summary}</span>}
      </div>
      <div className='dsh-design-continuation-actions'>
        <button
          type='button'
          data-testid='dsh-design-continuation-continue'
          className='dsh-design-continuation-continue'
          onClick={() => props.onContinue(label)}
        >
          {label}
        </button>
        <button
          type='button'
          data-testid='dsh-design-continuation-adjust'
          onClick={() => props.onAdjust?.()}
        >
          {isZh ? '调整' : 'Adjust'}
        </button>
        <button
          type='button'
          data-testid='dsh-design-continuation-later'
          onClick={() => setDismissed(key)}
        >
          {isZh ? '稍后' : 'Later'}
        </button>
      </div>
    </div>
  )
}
