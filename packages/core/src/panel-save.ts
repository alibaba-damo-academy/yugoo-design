/**
 * Panel edit round-trip (host side). When the user saves an editable design
 * panel, the edit is written to Design Files (schema-validated), git-committed
 * (approach A), and an authoritative diff note is built for the model so it
 * knows the change already happened and must not be re-applied.
 *
 * The client emits the edit (Phase 4); this module performs the durable write
 * and produces the `<panel_save_context>` notification injected into the next
 * turn. The caller resolves the store from the design seam for the session cwd.
 */
import type { DesignFilesStore, DesignWriteEvent, DesignWriteOptions, SchemaValidator } from './design-files.ts'

/** Shared main-conversation contract for the user's Save and assess action. */
export const DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE = [
  'The user chose Save and assess next step. After a meaningful Panel save, you must assess the latest saved Design evidence against the agreed user scope and call report_design_clarity in this same main-conversation continuation before asking the next question, recommending another Bundle or ending your reply.',
  'Use the current server-supplied project, saved checkpoint and Kit input. If those inputs have changed, read the current Design context before reporting; do not assess a superseded checkpoint as current. Explain known evidence and gaps without inventing facts or a zero score.',
  'Several saves delivered together need one assessment of their latest relevant state. An unchanged or replayed save does not require another score; reuse an existing assessment only when its saved Design evidence, Kit content and reasoning still apply to the current agreed scope.',
  'A later user stop, cancellation or instruction not to assess takes priority. If the reporting capability is unavailable or reporting fails, state that limitation and preserve the saved result; a missing score does not block independently authorized Design work.',
  'No second evaluator is required. Do not start another model or Bundle, reopen a settled invocation, or rewrite saved Design Files just to assess them. Existing user-input handoffs and main-Agent permissions remain in force.',
].join(' ')

/** Decode bounded Panel attachment transport; store enforces path ownership. */
export function parsePanelArtifacts(
  skill: string,
  value: unknown,
): Readonly<Record<string, string | Uint8Array>> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error('design panel: artifacts must be a list of at most 64 files')
  }
  const artifacts: Record<string, string | Uint8Array> = {}
  let totalBytes = 0
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('design panel: each artifact must be an object')
    }
    const entry = raw as Record<string, unknown>
    const path = entry.path
    const content = entry.content
    if (typeof path !== 'string' || typeof content !== 'string') {
      throw new Error('design panel: each artifact requires string path and content')
    }
    const encoding = entry.encoding
    if (encoding !== undefined && encoding !== 'base64') {
      throw new Error('design panel: artifact encoding must be base64 when present')
    }
    if (Object.keys(entry).some(key => key !== 'path' && key !== 'content' && key !== 'encoding')) {
      throw new Error('design panel: artifact entries accept only path, content and encoding')
    }
    if (Object.hasOwn(artifacts, path)) throw new Error(`design panel: duplicate artifact path ${JSON.stringify(path)}`)
    let prepared: string | Uint8Array = content
    let bytes = Buffer.byteLength(content, 'utf8')
    if (encoding === 'base64') {
      if (content === '' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(content)) {
        throw new Error(`design panel: artifact ${JSON.stringify(path)} is not canonical base64`)
      }
      const decoded = Buffer.from(content, 'base64')
      if (decoded.toString('base64') !== content) throw new Error(`design panel: artifact ${JSON.stringify(path)} is not canonical base64`)
      prepared = Uint8Array.from(decoded)
      bytes = decoded.byteLength
    }
    if (bytes > 16 * 1024 * 1024) throw new Error(`design panel: artifact ${JSON.stringify(path)} exceeds 16 MiB`)
    totalBytes += bytes
    if (totalBytes > 64 * 1024 * 1024) throw new Error('design panel: artifacts exceed 64 MiB in total')
    // DesignFilesStore performs the canonical path parser and Bundle-prefix check.
    artifacts[path] = prepared
  }
  return Object.freeze(artifacts)
}

/** One panel save: the owning skill and its full post-edit state. */
export interface PanelEdit {
  skill: string
  state: unknown
}

/** The result of applying a panel edit. */
export interface PanelSaveResult {
  skill: string
  commit?: string
  diff: string
  note: string
}

/** Server-observed evidence to assess, never browser-supplied score authority. */
export interface PanelSaveClarityInput {
  readonly projectId: string
  readonly selectionRevision?: number
  readonly assessedCheckpoint: string
  readonly kitContentHash: string
  readonly scopeDigest?: string
}

/**
 * Build the model-facing note that carries the authoritative git diff.
 * @param skill - the skill whose panel was saved.
 * @param diff - the unified diff of the save commit.
 * @returns the `<panel_save_context>` note text.
 */
export function buildPanelSaveNote(skill: string, diff: string, clarityInput?: PanelSaveClarityInput): string {
  return [
    '<panel_save_context>',
    `The backend has already persisted the "${skill}" panel edits. The raw Git diff below is the authoritative change record. Do not call a write tool to apply it again.`,
    '<git_diff>',
    diff,
    '</git_diff>',
    `This is a change diff, not the complete "${skill}" state. Reuse it and the evidence already available; read the saved JSON or a referenced artifact only when needed context is absent or the diff is insufficient.`,
    ...(clarityInput === undefined ? [] : [
      DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE,
      `Call report_design_clarity with input=${JSON.stringify(clarityInput)} and evidence-based U/S/T for the latest saved Design state and agreed user scope. The Design save is already completed independently of this report.`,
      'The current assembly supplies design_clarity_input for project, saved commit and Kit content. Use current user intent to decide whether the saved reasoning needs reassessment; conversational scope is not an identity ticket.',
      'Several saved edits may be assessed together. Reuse a score only when its evidence and reasoning remain applicable; corrections and same-turn reassessment are allowed. Reporting failure does not undo the save or block authorized work, and old scores are not fresh evidence.',
    ]),
    '</panel_save_context>',
  ].join('\n')
}

/**
 * Apply one panel edit: validate, persist, version, and build the agent note.
 * @param store - the session's Design Files store.
 * @param edit - the panel save (owning skill + post-edit state).
 * @param settleEvent - awaited plugin Journal settlement after commit.
 * @param validate - write-time schema validator (fail loud).
 * @param artifacts - deterministic files prepared by the runtime driver.
 * @param ownedArtifacts - complete artifact set retained by this Bundle.
 * @param signal - cancellation before transaction acceptance.
 * @returns the commit, diff, and the note to inject into the next turn.
 */
export async function applyPanelEdit(
  store: DesignFilesStore,
  edit: PanelEdit,
  settleEvent: (event: DesignWriteEvent) => Promise<void>,
  validate?: SchemaValidator,
  artifacts?: Readonly<Record<string, string | Uint8Array>>,
  ownedArtifacts?: readonly string[],
  signal?: AbortSignal,
  audit?: DesignWriteOptions['audit'],
): Promise<PanelSaveResult> {
  const { commit, diff } = await store.write(edit.skill, edit.state, {
    origin: 'panel',
    ...(validate === undefined ? {} : { validate }),
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(ownedArtifacts === undefined ? {} : { ownedArtifacts }),
    ...(signal === undefined ? {} : { signal }),
    ...(audit === undefined ? {} : { audit }),
    settleEvent,
  })
  return { skill: edit.skill, commit, diff, note: buildPanelSaveNote(edit.skill, diff) }
}
