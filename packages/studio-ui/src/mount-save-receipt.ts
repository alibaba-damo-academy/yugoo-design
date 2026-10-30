/** Admission of the existing S2 mount CAS receipt, never another save authority. */
import type { StudioInstance, StudioInstanceClient } from './InstanceWorkbench.tsx'

export type MountPins = Parameters<NonNullable<StudioInstanceClient['updateMounts']>>[0]['bundles']
export interface PendingMountSave { readonly base: StudioInstance; readonly bundles: MountPins }
export const mountKey = (pin: { name: string; version: string }) => pin.name

/** Preserve Bundle identity and unavailable mounts without pinning mutable library content. */
export function selectedMountPins(record: StudioInstance, keys: Iterable<string>): MountPins {
  return [...keys].map(key => {
    const source = record.availableBundles?.find(bundle => mountKey(bundle) === key)
      ?? record.mounts.find(mount => mountKey(mount.bundle) === key)?.bundle
    if (!source) throw Error('The selected Bundle source is unavailable. Reopen the Kit before saving.')
    const { name, version, instanceId } = source
    return { name, version, ...(instanceId === undefined ? {} : { instanceId }) }
  })
}
const samePin = (a?: { name: string; version: string }, b?: { name: string; version: string }) =>
  a?.name === b?.name && a?.version === b?.version

export function mountSaveMatches(value: StudioInstance, pending: PendingMountSave): boolean {
  const { base, bundles } = pending
  return !!value && value.id === base.id && value.kind === 'kit' && value.revision === base.revision + 1 && !value.deletedAt
    && samePin(value.kit, base.kit) && samePin(value.source?.kit, base.source?.kit)
    && value.title?.zh === base.title.zh && value.title?.en === base.title.en
    && Array.isArray(value.mounts) && value.mounts.length === bundles.length
    && value.mounts.every((mount, index) => {
      const expected = bundles[index]!
      return samePin(mount?.bundle, expected) && mount.bundle.instanceId === expected.instanceId
    })
}

/** Exact S2 rejections before the instance replace; generic transport/parse errors
 * can follow a committed write and therefore cannot unlock a second submission.
 */
export function mountWriteWasRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return [
    'Instance changed elsewhere. Reopen it before saving.',
    'Studio source changed elsewhere. Reopen it before saving.',
    'This working copy is no longer available or has been moved to the system trash.',
    'This legacy instance requires explicit migration before editing or mounting.',
    'Provide a bounded Bundle selection.',
    'Select an exact source version.',
    'A Kit can mount each Bundle only once.',
    'Mount management requires a local Kit instance.',
    'Bundle binding keys must be unique.',
    'Bundle binding key must preserve its runtime name.',
    'Bundle instance identity does not match its pin.',
    'Installed Bundle pins do not accept local instance fields.',
  ].some(message => error.message === message || error.message.endsWith(`: ${message}`))
    || /(?:^|: )Bundle [a-z][a-z0-9_]*@\d+\.\d+ is unavailable in the global catalog\.$/.test(error.message)
}
