/**
 * Fallback panel: skills without a bespoke component render through the
 * declarative panel.yaml interpreter in editable mode.
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import { renderManifest, type RenderOptions } from '../../interpreter.ts'
import { applyDesignEditToDraft, applyPanelUpdatesToDraft, recordsAtPath, sectionBindingOf, fieldValuesOf, type DesignData, type DesignEdit } from '../../record-state.ts'
import { parsePanelManifest, declarativePanelOwnsWorkspace, type PanelManifest } from '../../dsl.ts'
import { isRecord } from '../types.ts'
import type { SkillPanelProps } from './shared.ts'
import { DECLARATIVE_PANEL_ARTIFACTS_KEY, QUESTION_MAX_ATTACHMENTS, type StandardQuestionAttachment, type PendingDeclarativeArtifact } from '../../question-attachments.tsx'
import { panelText } from '../../panel-i18n.tsx'
import { PANEL_TEXT_ARTIFACTS_KEY, stageTextArtifact } from '../../text-artifact-edit.ts'

export { declarativePanelOwnsWorkspace } from '../../dsl.ts'

/** Pure atomic composition used by the live DslPanel and attachment regressions. */
export function applyDeclarativePanelTransaction(
  draft: Record<string, unknown>,
  manifest: PanelManifest,
  edits: readonly DesignEdit[],
  updates: Record<string, unknown>,
): Record<string, unknown> {
  let next = draft
  for (const edit of edits) next = applyDesignEditToDraft(next, manifest, edit)
  next = applyPanelUpdatesToDraft(next, updates)
  // An exhausted browser-only transport is not a design edit. Keep nonempty
  // (or malformed) transport observable so pending bytes are never discarded.
  for (const key of [DECLARATIVE_PANEL_ARTIFACTS_KEY, PANEL_TEXT_ARTIFACTS_KEY]) {
    if (Object.hasOwn(next, key) && Array.isArray(next[key]) && next[key].length === 0) {
      next = { ...next }
      delete next[key]
    }
  }
  return next
}

export function appendDeclarativeAttachments(draft: Record<string, unknown>, manifest: PanelManifest, section: string, record: string,
  additions: readonly { ref: StandardQuestionAttachment; pending: PendingDeclarativeArtifact }[], locale?: string): Record<string, unknown> {
  const binding = sectionBindingOf(manifest, section)
  const stored = recordsAtPath(draft as DesignData, binding.recordsPath)
  if (!Object.hasOwn(stored, record)) throw new Error(panelText('attachmentRecordGone', locale))
  const current = fieldValuesOf(stored[record]!, binding.fieldsPath).multimodal_answer
  if (current !== undefined && (!Array.isArray(current) || current.some(item => !isRecord(item)
    || typeof item.file_md5 !== 'string' || typeof item.filename !== 'string'))) throw new Error(panelText('attachmentInvalidState', locale))
  const refs = [...(current ?? []), ...additions.map(item => item.ref)] as StandardQuestionAttachment[]
  const unique = refs.filter((ref, index) => refs.findIndex(item => item.file_md5 === ref.file_md5 && item.filename === ref.filename) === index)
  if (unique.length > QUESTION_MAX_ATTACHMENTS) throw new Error(panelText('attachmentLimit', locale, { count: QUESTION_MAX_ATTACHMENTS }))
  const pending = Array.isArray(draft[DECLARATIVE_PANEL_ARTIFACTS_KEY]) ? draft[DECLARATIVE_PANEL_ARTIFACTS_KEY] as PendingDeclarativeArtifact[] : []
  const transport = [...pending, ...additions.map(item => item.pending)]
  return applyDeclarativePanelTransaction(draft, manifest, [{ section, record, field: 'multimodal_answer', value: unique }], {
    [DECLARATIVE_PANEL_ARTIFACTS_KEY]: transport.filter((item, index) => transport.findIndex(value => value.path === item.path) === index),
  })
}

/** The DSL panel: manifest parse + editable interpreter render. */
export function DslPanel({ skill, draft, originalState, onChange, panelYaml, panelData, readArtifact, sourceRevision, readBinaryArtifact, artifactFiles, readOnly = false, allowAttachments = true, locale, artifactActivities, executionAttempts, readExecutionLog, registerBeforeSave, selectPanel, onSaveAndContinue, sendPrompt, running }: SkillPanelProps & {
  skill: string
  readOnly?: boolean
  locale?: string
  selectPanel?: (skill: string) => void
  sendPrompt?: RenderOptions['sendPrompt']
  running?: boolean
  onSaveAndContinue?: () => void
  allowAttachments?: boolean
  panelYaml: string | undefined
  /** Cross-panel option source (other skills' section records); optional. */
  panelData?: RenderOptions['panelData']
}): ReactElement {
  const latestDraft = useRef<Record<string, unknown>>({})
  const savingEditor = useRef(0)
  latestDraft.current = isRecord(draft) ? draft : {}
  const uploadScope = useRef({ live: true, writable: !readOnly && allowAttachments, editorWritable: !readOnly, skill })
  uploadScope.current.writable = !readOnly && allowAttachments
  uploadScope.current.editorWritable = !readOnly
  uploadScope.current.skill = skill
  useEffect(() => { uploadScope.current.live = true; return () => { uploadScope.current.live = false } }, [])
  const parsed = useMemo(() => {
    if (typeof panelYaml !== 'string') return { manifest: undefined as PanelManifest | undefined, error: undefined as string | undefined }
    try {
      return { manifest: parsePanelManifest(panelYaml), error: undefined }
    } catch (failure) {
      // Fail loud: surface the manifest diagnostics instead of a blank panel.
      return { manifest: undefined, error: failure instanceof Error ? failure.message : String(failure) }
    }
  }, [panelYaml])
  if (parsed.error !== undefined) {
    return <div className='dsh-design-dock-empty'><pre className='dsh-design-manifest-error'>{parsed.error}</pre></div>
  }
  if (parsed.manifest === undefined) {
    return <div className='dsh-design-dock-empty'>{panelText('panelNoManifest', locale)}</div>
  }
  // Edits apply through the shared pure helpers: binding-aware field writes
  // and dotted-path panel updates (proto-safe, hasOwn-guarded).
  const onEdit = (edit: DesignEdit): void => {
    const next = applyDesignEditToDraft({ ...parsed.manifest?.initial_values, ...latestDraft.current }, parsed.manifest as PanelManifest, edit)
    latestDraft.current = next
    onChange(next)
  }
  const onPanelUpdate = (updates: Record<string, unknown>): void => {
    const next = applyDeclarativePanelTransaction({ ...parsed.manifest?.initial_values, ...latestDraft.current }, parsed.manifest as PanelManifest, [], updates)
    latestDraft.current = next
    onChange(next)
  }
  const onTransaction = (edits: readonly DesignEdit[], updates: Record<string, unknown>): void => {
    const next = applyDeclarativePanelTransaction({ ...parsed.manifest?.initial_values, ...latestDraft.current }, parsed.manifest as PanelManifest, edits, updates)
    latestDraft.current = next
    onChange(next)
  }
  const pendingArtifacts = isRecord(draft) && Array.isArray(draft[DECLARATIVE_PANEL_ARTIFACTS_KEY])
    ? draft[DECLARATIVE_PANEL_ARTIFACTS_KEY] as readonly PendingDeclarativeArtifact[]
    : []
  const ownsWorkspace = declarativePanelOwnsWorkspace(parsed.manifest)
  return <div className={`dsh-design-dock-panel-body${ownsWorkspace ? ' dsh-design-dock-panel-workspace' : ''}`}>{renderManifest(parsed.manifest, draft as DesignData, {
    editable: !readOnly,
    onSaveAndContinue: readOnly ? undefined : onSaveAndContinue,
    sendPrompt: readOnly ? undefined : sendPrompt,
    running,
    locale,
    collapseToken: originalState,
    onEdit,
    onPanelUpdate,
    onTransaction,
    onAppendAttachments: (section, record, additions) => {
      if (!uploadScope.current.live || !uploadScope.current.writable || uploadScope.current.skill !== skill) return
      const next = appendDeclarativeAttachments(latestDraft.current, parsed.manifest as PanelManifest, section, record, additions, locale)
      latestDraft.current = next
      onChange(next)
    },
    panelData,
    readArtifact,
    sourceRevision,
    artifactActivities,
    executionAttempts,
    readExecutionLog,
    registerBeforeSave: registerBeforeSave ? flush => registerBeforeSave(async () => {
      savingEditor.current++
      try { await flush() } finally { savingEditor.current-- }
    }) : undefined,
    onStageArtifact: edit => {
      if (!uploadScope.current.live || uploadScope.current.skill !== skill || (!uploadScope.current.editorWritable && !savingEditor.current)) {
        throw new Error(panelText('panelEditorUnavailable', locale))
      }
      const next = stageTextArtifact(latestDraft.current, skill, edit)
      latestDraft.current = next
      onChange(next)
    },
    selectPanel,
    readBinaryArtifact,
    artifactFiles,
    allowAttachments,
    pendingArtifacts,
    skill,
  })}</div>
}

export default DslPanel
