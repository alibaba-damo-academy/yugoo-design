/**
 * Design panel store (browser half): the dual-baseline draft model ported from
 * extend-design-skill's design.store.ts. Every skill keeps a `drafts` copy
 * (user edits) beside its `originals` host-confirmed value; dirty detection
 * compares render-relevant field subsets per skill (design.selectors.ts
 * rules). Agent updates while the tab is off-screen set the `new` unread
 * badge; on-screen updates emit a nonce-keyed flash. Drafts live in this
 * external store, so inactive panels can unmount without losing local edits.
 */
import type { DesignProjection, SkillManifestLite } from './types.ts'
import { panelPresentation, type NativePanelRegistry } from './native-panel-registry.ts'

/** The store's immutable snapshot (identity changes on every update). */
export interface PanelStoreState {
  /** Stable tab order: initial manifest order followed by newly opened skills. */
  skills: string[]
  active: string | undefined
  drafts: Record<string, unknown>
  originals: Record<string, unknown>
  manifests: Record<string, SkillManifestLite>
  /** Latest Design File publication sequence processed for each skill. */
  changedSeqs: Record<string, number>
  /** Off-screen agent updates pending acknowledgement (tab click clears). */
  unread: Record<string, true>
  /** On-screen agent update flash signal (nonce restarts the animation). */
  flash: { skill: string; nonce: number } | undefined
  saving: boolean
  error: string | undefined
}

let snap: PanelStoreState = {
  skills: [],
  active: undefined,
  drafts: {},
  originals: {},
  manifests: {},
  changedSeqs: {},
  unread: {},
  flash: undefined,
  saving: false,
  error: undefined,
}

const listeners = new Set<() => void>()

// Read receipts contain fingerprints only, never drafts or Design File text.
let readScope: string | undefined
let receipts: Record<string, { fingerprint: string; unread: boolean }> = {}
let savedReceipts: string | undefined
const memoryReceipts = new Map<string, typeof receipts>()
let panelVisible = false
let readableSkills: ReadonlySet<string> | undefined
let hasProjection = false
const contentFingerprints: Record<string, string> = {}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    }
    return item
  }) ?? ''
}

function fingerprint(value: unknown): string {
  const text = canonical(value)
  let a = 2166136261
  let b = 5381
  for (let index = 0; index < text.length; index++) {
    a = Math.imul(a ^ text.charCodeAt(index), 16777619)
    b = Math.imul(b, 33) ^ text.charCodeAt(index)
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`
}

function saveReceipts(): void {
  if (readScope === undefined) return
  for (const skill of snap.skills) {
    receipts[skill] = { fingerprint: contentFingerprints[skill], unread: snap.unread[skill] === true }
  }
  memoryReceipts.set(readScope, { ...receipts })
  const serialized = JSON.stringify(receipts)
  if (serialized === savedReceipts) return
  try {
    globalThis.localStorage?.setItem(`dsh-design-read-v1:${readScope}`, serialized)
    savedReceipts = serialized
  } catch { /* Storage is optional. */ }
}

/** The store's observable face (consumed through useSyncExternalStore). */
export const panelStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot: (): PanelStoreState => snap,
}

function emit(next: PanelStoreState): void {
  snap = next
  saveReceipts()
  for (const listener of listeners) listener()
}

/** Skill.yaml `order` with a stable fallback for manifest-less skills. */
function orderOf(skill: string, manifests: Record<string, SkillManifestLite>): number {
  const order = manifests[skill]?.order
  return typeof order === 'number' ? order : Number.MAX_SAFE_INTEGER
}

function compareFreshSkills(
  left: string,
  right: string,
  design: DesignProjection,
  manifests: Record<string, SkillManifestLite>,
  initialWorkspace: boolean,
): number {
  if (!initialWorkspace) {
    const leftSeq = design[left]?.changedSeq
    const rightSeq = design[right]?.changedSeq
    if (leftSeq !== undefined || rightSeq !== undefined) {
      if (leftSeq === undefined) return -1
      if (rightSeq === undefined) return 1
      if (leftSeq !== rightSeq) return leftSeq - rightSeq
    }
  }
  return orderOf(left, manifests) - orderOf(right, manifests) || left.localeCompare(right)
}

/**
 * Fold one projection snapshot into the store: refresh originals, carry
 * clean drafts forward, and raise unread/flash signals for agent updates.
 * @param design - the latest `design` projection face value.
 * @param dockOpen - whether the dock is visible (flash vs unread routing).
 * @param activitySkill - latest Host activity target; honored only when that Panel appears for the first time.
 */
export function syncProjection(
  design: DesignProjection | undefined,
  dockOpen: boolean,
  nativePanels: NativePanelRegistry,
  activitySkill?: string,
  artifactFiles?: Readonly<Record<string, string>>,
  renderedSkills?: readonly string[],
): void {
  if (design === undefined) return
  panelVisible = dockOpen
  readableSkills = renderedSkills === undefined ? undefined : new Set(renderedSkills)
  const visible = (skill: string): boolean => dockOpen && (readableSkills?.has(skill) ?? true)
  const known = new Set(snap.skills)
  const originals = { ...snap.originals }
  const drafts = { ...snap.drafts }
  const manifests = { ...snap.manifests }
  const changedSeqs = { ...snap.changedSeqs }
  let changed = false
  for (const [skill, entry] of Object.entries(design)) {
    if (entry.skillManifest !== undefined) {
      const nextManifest = entry.skillManifest as SkillManifestLite
      if (JSON.stringify(manifests[skill]) !== JSON.stringify(nextManifest)) changed = true
      manifests[skill] = nextManifest
    }
  }
  const projectedSkills = Object.keys(design).filter((skill) => panelPresentation(manifests[skill]).mode !== 'none')
  const projected = new Set(projectedSkills)
  const initialWorkspace = snap.skills.length === 0
  const fresh = projectedSkills
    .filter((skill) => !known.has(skill))
    .sort((a, b) => compareFreshSkills(a, b, design, manifests, initialWorkspace))
  // Manifest order establishes the first workspace layout. Afterwards, tab
  // position is interaction history: retained tabs never move and new tabs
  // always append, even when their manifest order is lower.
  const skills = [...snap.skills.filter((skill) => projected.has(skill)), ...fresh]
  const firstAppearanceFocus = activitySkill !== undefined && fresh.includes(activitySkill)
    ? activitySkill
    : undefined
  const unread = { ...snap.unread }
  let flash = snap.flash
  for (const skill of skills) {
    const entry = design[skill]
    const previous = originals[skill]
    const artifacts = Object.fromEntries(Object.entries(artifactFiles ?? {}).filter(([path]) =>
      path.startsWith(`${skill}/`) && path !== `${skill}/${skill}.json`))
    const nextFingerprint = fingerprint({ state: entry.state, artifacts })
    const priorFingerprint = contentFingerprints[skill] ?? receipts[skill]?.fingerprint
    const contentChanged = priorFingerprint !== undefined && priorFingerprint !== nextFingerprint
    if (contentChanged) changed = true
    const newPanel = previous === undefined && (!initialWorkspace || hasProjection)
    if (previous === undefined && receipts[skill]?.unread) unread[skill] = true
    contentFingerprints[skill] = nextFingerprint
    const hadDraft = skill in drafts
    const dirty = hadDraft && previous !== undefined
      && !areRenderEqual(manifests[skill], nativePanels, drafts[skill], previous)
    const ownSaveEcho = dirty
      && areRenderEqual(manifests[skill], nativePanels, drafts[skill], entry.state)
    const previousChangedSeq = changedSeqs[skill]
    const newerChange = entry.changedSeq !== undefined
      && (previousChangedSeq === undefined || entry.changedSeq > previousChangedSeq)
    if (newerChange) {
      changedSeqs[skill] = entry.changedSeq as number
      changed = true
    }
    if (originals[skill] !== entry.state) {
      originals[skill] = entry.state
      if (!dirty) drafts[skill] = entry.state
      changed = true
    }
    // Content (including owned artifacts), not publication/object identity,
    // determines updates. A matching dirty draft is this panel's save echo;
    // a historical panel origin must not hide later live agent edits.
    if ((contentChanged || newPanel) && !(entry.origin === 'panel' && newerChange) && !ownSaveEcho) {
      if (skill === snap.active && visible(skill)) {
        delete unread[skill]
        flash = { skill, nonce: (flash?.nonce ?? 0) + 1 }
      } else unread[skill] = true
    }
  }
  let active = snap.active
  if (active === undefined || !skills.includes(active)) {
    active = firstAppearanceFocus ?? (initialWorkspace ? skills[0] : fresh.at(-1) ?? skills[0])
  } else if (fresh.some((skill) => skill !== active)) {
    // The newest brand-new skill is the rightmost appended tab and steals
    // focus once. Existing publications never participate in this branch.
    active = firstAppearanceFocus ?? fresh.at(-1) ?? active
  }
  if (active !== undefined && visible(active) && unread[active] === true) {
    delete unread[active]
    changed = true
  }
  hasProjection = true
  if (flash !== undefined && (flash.skill !== active || !visible(flash.skill))) {
    flash = undefined
    changed = true
  }
  if (!changed && active === snap.active && skills.join(',') === snap.skills.join(',')) return
  emit({ ...snap, skills, active, originals, drafts, manifests, changedSeqs, unread, flash })
}

/** Switch the visible tab and acknowledge its unread badge. */
export function selectTab(skill: string): void {
  if (!snap.skills.includes(skill)) return
  if (skill === snap.active && snap.unread[skill] !== true) return
  const unread = { ...snap.unread }
  if (panelVisible && (readableSkills?.has(skill) ?? true)) delete unread[skill]
  emit({ ...snap, active: skill, unread, flash: undefined })
}

/** Apply one draft edit for a skill (immutably). */
export function editDraft(skill: string, next: unknown): void {
  emit({ ...snap, drafts: { ...snap.drafts, [skill]: next }, error: undefined })
}

/** Replace a just-saved transient editor draft with its canonical wire state. */
export function settleSavedDraft(skill: string, state: unknown): void {
  emit({ ...snap, drafts: { ...snap.drafts, [skill]: state }, error: undefined })
}

/** Whether the draft diverges from the host value on render-relevant fields. */
export function isDirty(skill: string, nativePanels: NativePanelRegistry): boolean {
  return skill in snap.drafts
    && snap.originals[skill] !== undefined
    && !areRenderEqual(snap.manifests[skill], nativePanels, snap.drafts[skill], snap.originals[skill])
}

/** Any skill with pending local edits (drives the save bar availability). */
export function hasPendingChanges(nativePanels: NativePanelRegistry): boolean {
  return snap.skills.some((skill) => isDirty(skill, nativePanels))
}

/** Discard every skill's local edits (the footer's regenerate action). */
export function revertAll(): void {
  const drafts: Record<string, unknown> = {}
  for (const skill of snap.skills) drafts[skill] = snap.originals[skill]
  emit({ ...snap, drafts, error: undefined })
}

/** Mark the save round-trip in flight (or finished with an error). */
export function setSaving(saving: boolean, error?: string): void {
  emit({ ...snap, saving, error })
}

/**
 * Compare draft state through the projected presentation renderer. Declarative
 * Bundles always use structural JSON equality, regardless of their skill name.
 * A missing native definition compares only identical references: its explicit
 * workspace error remains visible without discarding a pre-existing draft.
 */
export function areRenderEqual(
  manifest: SkillManifestLite | undefined,
  nativePanels: NativePanelRegistry,
  a: unknown,
  b: unknown,
): boolean {
  if (a === b) return true
  const presentation = panelPresentation(manifest)
  if (presentation.mode === 'declarative') return JSON.stringify(a) === JSON.stringify(b)
  if (presentation.mode === 'auto') return JSON.stringify(a) === JSON.stringify(b)
  if (presentation.mode === 'none') return JSON.stringify(a) === JSON.stringify(b)
  if (presentation.mode === 'invalid') return false
  const definition = presentation.renderer === undefined
    ? undefined
    : nativePanels.get(presentation.renderer)
  if (definition === undefined) return false
  return definition.equalsDraft?.(a, b) ?? JSON.stringify(a) === JSON.stringify(b)
}

/** Reset the store (session switch). */
export function resetPanelStore(scope?: string): void {
  readScope = scope
  savedReceipts = undefined
  receipts = scope === undefined ? {} : { ...memoryReceipts.get(scope) }
  if (scope !== undefined) {
    try {
      const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(`dsh-design-read-v1:${scope}`) ?? '{}')
      if (saved !== null && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [skill, value] of Object.entries(saved)) {
          if (value !== null && typeof value === 'object' && 'fingerprint' in value
            && typeof value.fingerprint === 'string' && 'unread' in value && typeof value.unread === 'boolean') {
            receipts[skill] = { fingerprint: value.fingerprint, unread: value.unread }
          }
        }
      }
    } catch { /* Invalid/unavailable browser storage does not block Panels. */ }
  }
  for (const skill of Object.keys(contentFingerprints)) delete contentFingerprints[skill]
  panelVisible = false
  readableSkills = undefined
  hasProjection = false
  emit({
    skills: [],
    active: undefined,
    drafts: {},
    originals: {},
    manifests: {},
    changedSeqs: {},
    unread: {},
    flash: undefined,
    saving: false,
    error: undefined,
  })
}
