/** Editable local source instances. Persistence and preview remain host capabilities. */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { DesignBundleVersionPin, DesignKitVersionPin, StudioPanelPreviewResult } from 'dsh-design-studio'
import type { StudioInstanceChangeRequest, StudioInstanceCandidate, StudioInstanceSaveChanges, StudioInstanceChangeReceipt } from 'dsh-design-studio'
import type { StudioAuthoring } from './authoring.ts'
import { renderStudioDocument } from './markdown.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { MountEditor, type MountEditorActions } from './MountEditor.tsx'
import { FileExplorer } from './FileExplorer.tsx'
import { FileInfoSidebar, FileName } from './FileInfoSidebar.tsx'
import { useSourceCandidate, type SourceCandidateOptions, type StudioPreparedSourceChanges } from './source-candidate-state.ts'
import { SourceFileDiff } from './SourceFileDiff.tsx'
import { StudioFeedback, type StudioFeedbackDetail } from './StudioFeedback.tsx'
import { StudioEmptyState } from './StudioEmptyState.tsx'
import { StudioErrorDialog } from './StudioErrorDialog.tsx'

export interface StudioInstance {
  readonly id: string
  readonly kind: 'kit' | 'bundle'
  readonly title: { readonly zh: string; readonly en: string }
  readonly description?: string
  readonly displayDescription?: { readonly zh: string; readonly en: string }
  readonly source: { readonly kit?: DesignKitVersionPin; readonly bundle?: DesignBundleVersionPin }
  readonly kit?: DesignKitVersionPin
  readonly bundle?: DesignBundleVersionPin
  readonly revision: number
  /** This record is the current content of an existing catalog identity. */
  readonly current?: boolean
  /** Existing S2 creation provenance; never implies definition validity. */
  readonly createdBlank?: boolean
  readonly readiness?: { readonly ready: boolean; readonly diagnostics: readonly { code: string; message: string; path?: string; severity?: 'error' | 'warning' }[] }
  readonly files?: readonly { readonly path: string; readonly bytes: number; readonly editable: boolean }[]
  readonly mounts: readonly { readonly bundle: DesignBundleVersionPin & { readonly instanceId?: string; readonly revision?: number;
    readonly source?: { readonly snapshot: string; readonly sourceId: string } }; readonly instanceId?: string }[]
  readonly refs: readonly { readonly id: string; readonly title: { readonly zh: string; readonly en: string } }[]
  readonly deletedAt?: string
  readonly availableBundles?: readonly (DesignBundleVersionPin & { readonly title: { readonly zh: string; readonly en: string }; readonly instanceId?: string; readonly revision?: number; readonly runtimeName?: string; readonly description?: string; readonly displayDescription?: { readonly zh: string; readonly en: string } })[]
}

export interface StudioInstanceClient {
  /** Open the current library item for editing without creating a new identity. */
  editCurrent?(input: { kind: 'kit' | 'bundle'; kit?: DesignKitVersionPin; bundle?: DesignBundleVersionPin }): Promise<StudioInstance>
  importSources?(input: { kind: 'kit' | 'bundle'; files: readonly { path: string; base64: string }[]; title?: { zh: string; en: string } }): Promise<StudioInstance>
  /** Optional explicit blank-object creation through the same S2 repository. */
  create?(input: { kind: 'kit' | 'bundle'; title: { zh: string; en: string } }): Promise<StudioInstance>
  list(input?: { kind?: 'kit' | 'bundle' }): Promise<readonly StudioInstance[]>
  read(input: { id: string }): Promise<StudioInstance>
  copy(input: { kind: 'kit' | 'bundle'; kit?: DesignKitVersionPin; bundle?: DesignBundleVersionPin; title?: { zh: string; en: string }; sourceId?: string; mountInstanceIds?: string[] }): Promise<StudioInstance>
  rename(input: { id: string; expectedRevision: number; title: { zh: string; en: string } }): Promise<StudioInstance>
  remove(input: { id: string; expectedRevision: number }): Promise<{ id: string; revision: number; trashed: true }>
  readFile(input: { id: string; path: string }): Promise<{ id: string; revision: number; path: string; content: string }>
  saveFile(input: { id: string; expectedRevision: number; path: string; content: string }): Promise<StudioInstance>
  /** Optional host capability; shares the same source record and CAS as saveFile. */
  prepareChanges?(input: StudioInstanceChangeRequest): Promise<StudioInstanceCandidate>
  saveChanges?(input: StudioInstanceSaveChanges): Promise<StudioInstance & { changeReceipt: StudioInstanceChangeReceipt }>
  preview(input: { id: string; expectedRevision: number; bundle?: DesignBundleVersionPin; locale?: string }): Promise<StudioPanelPreviewResult>
  updateMounts?(input: { id: string; expectedRevision: number; bundles: readonly (DesignBundleVersionPin & { readonly instanceId?: string; readonly revision?: number })[] }): Promise<StudioInstance>
}

export interface InstanceWorkbenchProps {
  client: StudioInstanceClient
  id: string
  locale: 'zh' | 'en'
  onBack: () => void
  onChanged: (record?: StudioInstance) => void
  onExport?: (record: StudioInstance) => void
  renderPreview?: StudioAuthoring['renderPreview']
  /** Navigation may also protect host conversation input; export uses the canonical source state. */
  onDirtyChange?: (dirty: boolean, state?: { readonly sourceDirty: boolean }) => void
  /** Optional host contribution alongside the current source editor. Never owns its source state. */
  renderSupplement?: (state: { record?: StudioInstance; dirty: boolean; busy: boolean; previewBundle?: DesignBundleVersionPin; currentFile?: string; intent?: 'create' | 'edit'; proposalReplacement?: {
    /** Derived from this editor's drafts and save fence; grants no source/save authority. */
    canReplace: () => boolean
    canDiscard: () => boolean
    /** Explicit user choice, using the ordinary discard confirmation and restoration. */
    discard: () => boolean
  } }) => ReactNode
  /** User's entry action; a prompt hint, never source or save authority. */
  authoringIntent?: 'create' | 'edit'
  /** Host composition only; ordinary catalog editors retain their standalone main. */
  embedded?: boolean
  /** A host-verified proposal uses this workbench's existing file tree and save surface. */
  sourceChanges?: { prepared: StudioPreparedSourceChanges; client: SourceCandidateOptions['client']; onDismiss: () => void; onSaved?: (record: StudioInstance) => void }
  /** Read-only browsing never activates host authoring or source mutation controls. */
  readOnly?: boolean
  onEdit?: () => void
  initialView?: 'files' | 'preview'
  /** Exact host handoff. A Kit without a Bundle pin starts in its source view. */
  initialSelection?: { expectedRevision: number; bundle?: DesignBundleVersionPin }
}

export function InstanceWorkbench({ client, id, locale, onBack, onChanged, onExport, renderPreview, onDirtyChange, renderSupplement, authoringIntent, embedded = false, readOnly = false, onEdit, initialView = 'files', initialSelection, sourceChanges }: InstanceWorkbenchProps): ReactElement {
  const zh = locale === 'zh'
  const [record, setRecord] = useState<StudioInstance>()
  const [path, setPath] = useState(''), [content, setContent] = useState(''), [saved, setSaved] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftsRef = useRef(drafts); draftsRef.current = drafts
  const [fileView, setFileView] = useState<'edit' | 'diff'>('edit')
  const [preparedDraft, setPreparedDraft] = useState<{ key: string; prepared: StudioPreparedSourceChanges }>()
  const [saveIssuesOpen, setSaveIssuesOpen] = useState(false)
  const [preparingDraft, setPreparingDraft] = useState(false), [draftError, setDraftError] = useState('')
  const [mountActions, setMountActions] = useState<MountEditorActions>()
  const [loaded, setLoaded] = useState(false), [sourceBusy, setBusy] = useState(false), [error, setError] = useState('')
  const [opening, setOpening] = useState(true)
  const [tab, setTab] = useState<'files' | 'preview' | 'mounts'>(initialView), [reading, setReading] = useState(readOnly)
  const [renaming, setRenaming] = useState(false), [title, setTitle] = useState('')
  const [newFileOpen, setNewFileOpen] = useState(false), [newFilePath, setNewFilePath] = useState(''), [newFileError, setNewFileError] = useState('')
  const newFileErrorId = useId()
  const [preview, setPreview] = useState<StudioPanelPreviewResult>(), [previewBusy, setPreviewBusy] = useState(false)
  const [mountsDirty, setMountsDirty] = useState(false), [mountsBusy, setMountsBusy] = useState(false)
  const [mountsEpoch, setMountsEpoch] = useState(0)
  const busy = sourceBusy || mountsBusy
  const sourceEditor = useRef<HTMLTextAreaElement>(null)
  const generation = useRef(0), fileRequest = useRef(0), previewRequest = useRef(0), prepareRequest = useRef(0)
  const sourceDirty = Object.keys(drafts).length > 0
  const dirty = sourceDirty || mountsDirty
  const selectedBundle = record?.kind === 'bundle' ? record.bundle ?? record.source.bundle
    : record?.mounts.find(mount => mount.bundle.name === initialSelection?.bundle?.name && mount.bundle.version === initialSelection.bundle.version)?.bundle
  // Storage retains source/mount provenance; preview and host targets accept only the exact pin.
  const previewBundle = useMemo(() => selectedBundle ? { name: selectedBundle.name, version: selectedBundle.version } : undefined,
    [selectedBundle?.name, selectedBundle?.version])
  const titleDirty = renaming && title !== record?.title[locale]
  const notifyDirty = useRef(onDirtyChange); notifyDirty.current = onDirtyChange
  const fail = (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))

  const editableChanges = readOnly ? undefined : sourceChanges
  const candidateKey = editableChanges ? `${editableChanges.prepared.request.id}:${editableChanges.prepared.request.expectedRevision}:${editableChanges.prepared.candidate.digest}` : undefined
  useEffect(() => setSaveIssuesOpen(false), [id, candidateKey])
  const capturedProposal = useMemo(() => editableChanges ? structuredClone(editableChanges.prepared) : undefined, [candidateKey])
  const candidateOwner = useRef<string>()
  if (!editableChanges) candidateOwner.current = undefined
  else if (candidateOwner.current !== candidateKey && !dirty && !titleDirty && !busy) candidateOwner.current = candidateKey
  const proposal = candidateOwner.current === candidateKey ? capturedProposal : undefined
  const draftRequest = useMemo(() => {
    if (!record || !sourceDirty) return undefined
    const changes = new Map(proposal?.request.changes.map(change => [change.path, change.content]) ?? [])
    for (const [path, content] of Object.entries(drafts)) changes.set(path, content)
    return { ...proposal?.request, id, expectedRevision: record.revision, changes: [...changes].map(([path, content]) => ({ path, content })) }
  }, [record?.id, record?.revision, id, drafts, proposal, sourceDirty])
  const draftKey = draftRequest ? JSON.stringify(draftRequest) : undefined
  const draftClient = useMemo(() => client.saveChanges ? { read: client.read.bind(client), saveChanges: client.saveChanges.bind(client) } : undefined, [client])
  const currentPrepared = sourceDirty ? preparedDraft && preparedDraft.key === draftKey ? preparedDraft.prepared : undefined : proposal
  const sourceClient = proposal ? editableChanges?.client : draftClient
  const candidateState = useSourceCandidate(currentPrepared && sourceClient ? {
    prepared: currentPrepared, client: sourceClient, instanceId: id, locale, renderPreview,
    onSaved: value => {
      setRecord(value); setDrafts({}); setPreparedDraft(undefined); setError(''); setPreview(undefined); setLoaded(false)
      setPath(previous => value.files?.some(file => file.path === previous) ? previous : value.files?.[0]?.path ?? '')
      notifyDirty.current?.(false)
      if (proposal && editableChanges?.onSaved) editableChanges.onSaved(value)
      else { if (proposal) editableChanges?.onDismiss(); onChanged(value) }
    },
  } : undefined)
  const candidatePending = !!proposal
  const activeCandidateKey = candidatePending ? candidateKey : undefined
  const displayedProposal = useRef<string>()
  const candidateBusy = candidateState?.busy === true
  const fileChange = proposal?.candidate.diff.find(file => file.path === path)
  const filePaths = [...new Set([...(record?.files?.map(file => file.path) ?? []), ...(proposal?.candidate.diff.map(file => file.path) ?? []), ...Object.keys(drafts)])]

  useEffect(() => {
    const current = ++prepareRequest.current, scope = generation.current
    setDraftError('')
    if (!draftRequest || !draftKey || !client.prepareChanges || !draftClient) { setPreparingDraft(false); return }
    setPreparingDraft(true)
    const timer = setTimeout(() => {
      void client.prepareChanges!(draftRequest).then(candidate => {
        if (scope !== generation.current || current !== prepareRequest.current) return
        if (candidate.id !== id || candidate.baseRevision !== draftRequest.expectedRevision || candidate.revision !== draftRequest.expectedRevision + 1) throw Error(zh ? '预览内容已改变，请重新打开。' : 'The preview changed. Reopen the content.')
        setPreparedDraft({ key: draftKey, prepared: { request: draftRequest, candidate } })
      }).catch(failure => { if (scope === generation.current && current === prepareRequest.current) setDraftError(failure instanceof Error ? failure.message : String(failure)) })
        .finally(() => { if (scope === generation.current && current === prepareRequest.current) setPreparingDraft(false) })
    }, 200)
    return () => { clearTimeout(timer); ++prepareRequest.current }
  }, [draftKey, client, draftClient])

  useEffect(() => {
    if (!candidateKey) { displayedProposal.current = undefined; return }
    if (!candidateKey || dirty || titleDirty || busy) return
    const scope = `${sourceChanges!.prepared.request.id}:${sourceChanges!.prepared.request.expectedRevision}`
    const replacing = displayedProposal.current === scope
    displayedProposal.current = scope
    if (!replacing) { setTab('files'); setReading(false); setFileView('edit'); setMountsDirty(false) }
    setPath(previous => (replacing ? filePaths.includes(previous) : sourceChanges!.prepared.candidate.diff.some(file => file.path === previous)) ? previous : sourceChanges!.prepared.candidate.diff[0]?.path ?? previous)
    setPreview(undefined); setPreviewBusy(false); ++previewRequest.current
  }, [candidateKey, candidatePending])

  useEffect(() => {
    const current = ++generation.current
    ++fileRequest.current; ++previewRequest.current
    setRecord(undefined); setOpening(true); setPath(''); setContent(''); setSaved(''); setDrafts({}); setPreparedDraft(undefined); setFileView('edit'); setLoaded(false); setBusy(false); setError(''); setPreview(undefined); setPreviewBusy(false); setRenaming(false); setMountsDirty(false); setMountsBusy(false); setMountActions(undefined); setTab(initialView); setNewFileOpen(false); setNewFilePath(''); setNewFileError('')
    void client.read({ id }).then(value => {
      if (generation.current !== current || value.id !== id) return
      const selected = initialSelection?.bundle
      const own = value.bundle ?? value.source.bundle
      if (initialSelection && (value.deletedAt || value.revision !== initialSelection.expectedRevision
        || (selected && !(value.kind === 'bundle' ? own?.name === selected.name && own.version === selected.version
          : value.mounts.some(mount => mount.bundle.name === selected.name && mount.bundle.version === selected.version))))) {
        fail(zh ? '交接的内容或技能包已改变，请从原对话重新打开。' : 'The handed-off revision or Bundle changed. Reopen it from the original conversation.')
        return
      }
      setRecord(value)
      setPath(initialView === 'preview' && value.kind === 'bundle' && value.files?.some(file => file.path === 'panel.yaml') ? 'panel.yaml'
        : value.files?.find(file => /(^|\/)(mindset|SKILL)\.md$/.test(file.path))?.path ?? value.files?.[0]?.path ?? '')
      if (value.kind === 'kit' || !value.files?.some(file => file.path === 'panel.yaml')) setTab('files')
    }, failure => { if (generation.current === current) fail(failure) }).finally(() => { if (generation.current === current) setOpening(false) })
    return () => { ++generation.current; ++fileRequest.current; ++previewRequest.current; notifyDirty.current?.(false) }
  // Entry props apply once for this client/copy. Consuming a handoff after save must not reset its file selection.
  }, [client, id])

  useEffect(() => {
    if (!path || !record || record.id !== id) return
    const current = ++fileRequest.current, scope = generation.current
    setLoaded(false); setError('')
    if (fileChange) {
      setSaved(fileChange.before ?? ''); setContent(draftsRef.current[path] ?? fileChange.after ?? ''); setLoaded(true)
      return
    }
    if (Object.hasOwn(draftsRef.current, path) && !record.files?.some(file => file.path === path)) {
      setSaved(''); setContent(draftsRef.current[path]!); setLoaded(true); return
    }
    if (record.files?.find(file => file.path === path)?.editable === false) {
      setContent(''); setSaved('')
      return
    }
    void client.readFile({ id, path }).then(value => {
      if (scope !== generation.current || current !== fileRequest.current) return
      if (value.id !== id || value.path !== path || value.revision !== record.revision) { setError(zh ? '内容已在其他位置更新，请重新打开。' : 'This content changed elsewhere. Reopen it to load the saved changes.'); return }
      setContent(draftsRef.current[path] ?? value.content); setSaved(value.content); setLoaded(true)
    }, failure => { if (scope === generation.current && current === fileRequest.current) fail(failure) })
    return () => { ++fileRequest.current }
  }, [client, id, path, record?.revision, activeCandidateKey])

  useEffect(() => { notifyDirty.current?.(dirty || titleDirty || busy || candidatePending) }, [dirty, titleDirty, busy, candidatePending])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || titleDirty || busy || candidatePending) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { window.removeEventListener('beforeunload', unload) }
  }, [dirty, titleDirty, busy, candidatePending])

  const discard = (): boolean => !(dirty || titleDirty) || window.confirm(zh ? '放弃未保存的修改？' : 'Discard unsaved changes?')
  const restore = () => { ++prepareRequest.current; ++previewRequest.current; setPreview(undefined); setContent(saved); setDrafts({}); setPreparedDraft(undefined); setRenaming(false); setMountsDirty(false); setMountsEpoch(value => value + 1); setNewFileOpen(false); setNewFileError(''); setPath(previous => record?.files?.some(file => file.path === previous) ? previous : record?.files?.find(file => /(^|\/)(mindset|SKILL)\.md$/.test(file.path))?.path ?? record?.files?.[0]?.path ?? '') }
  const proposalReplacement = useMemo(() => {
    const scope = generation.current
    const canDiscard = () => scope === generation.current && !readOnly && !busy && !candidateBusy && !preparingDraft
      && !candidateState?.saved && !candidateState?.saveUnverified && !candidateState?.isSaveSubmitted() && !mountActions?.isSaveSubmitted()
    return {
      canReplace: () => canDiscard() && !dirty && !titleDirty,
      canDiscard,
      discard: () => { if (!canDiscard() || !discard()) return false; restore(); return true },
    }
  }, [client, id, record?.revision, generation.current, readOnly, dirty, titleDirty, busy, candidateBusy, preparingDraft,
    candidateState?.saved, candidateState?.saveUnverified, candidateState?.isSaveSubmitted, mountActions, candidateKey, locale])
  const dismissChanges = () => { sourceChanges?.onDismiss(); setPath(previous => record?.files?.some(file => file.path === previous) ? previous : record?.files?.[0]?.path ?? ''); setError('') }
  const changeTab = (next: 'files' | 'preview' | 'mounts') => {
    if (next === tab || busy || candidateBusy || mountActions?.isSaveSubmitted()) return
    if (next === 'mounts' || tab === 'mounts') { if (!discard()) return; restore() }
    if (next === 'preview' && filePaths.includes('panel.yaml') && !openFile('panel.yaml')) return
    setTab(next)
  }
  const mutate = async (action: () => Promise<StudioInstance | undefined>) => {
    const current = generation.current
    setBusy(true); setError(''); ++previewRequest.current; setPreview(undefined); setPreviewBusy(false)
    try {
      const value = await action()
      if (current !== generation.current) return
      if (value?.id === id) setRecord(value)
      setRenaming(false); onChanged(value)
    } catch (failure) { if (current === generation.current) fail(failure) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const save = () => {
    if (readOnly || !record || !loaded || !sourceDirty || busy) return
    const text = content, current = generation.current
    void mutate(async () => { const value = await client.saveFile({ id, expectedRevision: record.revision, path, content: text }); if (current === generation.current && value.id === id) setDrafts({}); return value })
  }
  const refresh = () => {
    if (mountActions?.isSaveSubmitted()) { if (mountActions.saveUnverified) void mountActions.verifySave(); return }
    if (busy || candidateBusy || !discard()) return
    const current = generation.current
    void mutate(async () => {
      const value = await client.read({ id })
      if (current !== generation.current) return undefined
      if (value.id !== id) throw Error(zh ? '刷新结果不属于当前内容。' : 'The refreshed record belongs to another item.')
      restore(); return value
    })
  }
  const rename = () => {
    if (readOnly || !record || busy || candidateBusy || candidateState?.saveUnverified || mountActions?.isSaveSubmitted() || !title.trim()) return
    if (title === record.title[locale]) { setRenaming(false); return }
    void mutate(() => client.rename({ id, expectedRevision: record.revision, title: { ...record.title, [locale]: title.trim() } }))
  }
  const duplicate = () => {
    if (!record || busy || candidateBusy || candidateState?.saveUnverified || mountActions?.isSaveSubmitted() || !discard()) return
    restore()
    void mutate(() => client.copy({ kind: record.kind, kit: record.source.kit, bundle: record.source.bundle, sourceId: id }))
  }
  const remove = () => {
    if (!record || busy || candidateBusy || candidateState?.saveUnverified || mountActions?.isSaveSubmitted() || !discard()) return
    if (!confirmInstanceRemoval(record, locale)) return
    restore()
    void mutate(async () => { await client.remove({ id, expectedRevision: record.revision }); return undefined })
  }

  useEffect(() => {
    if (tab !== 'preview' || record?.kind !== 'bundle' || busy || candidatePending || sourceDirty) return
    const bundle = previewBundle
    setPreview(undefined)
    if (!bundle) return
    const current = ++previewRequest.current, scope = generation.current
    setPreviewBusy(true); setError('')
    void client.preview({ id, expectedRevision: record.revision, bundle, locale: zh ? 'zh-CN' : 'en-US' }).then(value => {
      if (scope !== generation.current || current !== previewRequest.current) return
      if (value.preview && value.preview.revision !== record.revision) { setError(zh ? '预览版本已过期，请重试。' : 'Preview revision is stale. Please retry.'); return }
      setPreview(value)
    }, failure => { if (scope === generation.current && current === previewRequest.current) fail(failure) }).finally(() => { if (scope === generation.current && current === previewRequest.current) setPreviewBusy(false) })
    return () => { ++previewRequest.current }
  }, [client, id, record?.revision, record?.kind, tab, previewBundle, locale, busy, candidatePending, sourceDirty])

  const file = record?.files?.find(entry => entry.path === path)
  const exportDisabled = !record || record.id !== id || dirty || renaming || busy || candidateBusy || candidateState?.saveUnverified || mountActions?.isSaveSubmitted() || previewBusy || candidatePending
  const exportSaved = () => { if (!exportDisabled && record) onExport?.(structuredClone(record)) }
  const sourcePending = sourceDirty || candidatePending
  const sourceLocked = busy || candidateBusy || candidateState?.saveUnverified === true || mountActions?.isSaveSubmitted() === true
  const batchSource = !!client.prepareChanges && !!draftClient
  const canSaveSource = sourceDirty && !batchSource ? loaded && !!file?.editable && !busy : !!candidateState?.canSave && !preparingDraft
  const canSave = tab === 'mounts' ? !!mountActions?.canSave : canSaveSource || (!!draftError && sourceDirty && !preparingDraft)
  const saveLabel = mountsBusy && mountActions?.saveUnverified ? (zh ? '正在核对…' : 'Verifying…')
    : busy || candidateBusy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存' : 'Save')
  const saveCurrent = () => {
    if (!canSave || sourceLocked) return
    if (tab !== 'mounts' && draftError) { setSaveIssuesOpen(true); return }
    if (tab === 'mounts') void mountActions?.save()
    else if (candidateState) void candidateState.save()
    else save()
  }
  const revertCurrent = () => {
    if (sourceLocked || !discard()) return
    restore()
    if (candidatePending) dismissChanges()
  }
  const sourceStatus = candidateState?.saveUnverified ? (zh ? '保存结果待确认' : 'Save needs verification')
    : sourcePending ? (zh ? `${draftRequest?.changes.length ?? proposal?.request.changes.length ?? 1} 个文件未保存` : `${draftRequest?.changes.length ?? proposal?.request.changes.length ?? 1} unsaved files`)
      : (zh ? '已保存' : 'Saved')
  const editSource = (text: string) => {
    if (sourceLocked || !loaded || readOnly || text === content) return
    ++prepareRequest.current
    setContent(text)
    setDrafts(previous => {
      const next = { ...previous }
      if ((file || fileChange) && text === (fileChange?.after ?? saved)) delete next[path]
      else next[path] = text
      return next
    })
  }
  const openFile = (next: string) => {
    if (sourceLocked) return false
    if (next === path) return true
    if (!batchSource && sourceDirty) { if (!discard()) return false; restore() }
    setPath(next)
    return true
  }
  const createFile = () => {
    if (readOnly || sourceLocked || !batchSource) return
    const next = newFilePath.trim()
    if (!next || /[\\:\u0000-\u001f]/u.test(next) || next.split('/').some(part => !part || ['.', '..', '.git', 'node_modules'].includes(part))) {
      setNewFileError(zh ? '请输入相对文件名，例如 reference/notes.md。' : 'Enter a relative filename, such as reference/notes.md.'); return
    }
    const folded = next.toLowerCase()
    if (filePaths.some(file => file.toLowerCase() === folded || file.toLowerCase().startsWith(folded + '/') || folded.startsWith(file.toLowerCase() + '/'))) {
      setNewFileError(zh ? '这个文件名已被占用，请换一个名称。' : 'This filename is already in use. Choose another name.'); return
    }
    setDrafts(previous => ({ ...previous, [next]: '' })); setPath(next); setFileView('edit'); setReading(false)
    setNewFileOpen(false); setNewFilePath(''); setNewFileError('')
  }
  const issueDetails = (entries: readonly { message: string; subject?: string }[]): StudioFeedbackDetail[] => entries.map(entry => {
    // Diagnostics have no separate path field. Navigate only an unambiguous exact
    // existing filename, never an arbitrary path supplied by diagnostic text.
    const words = entry.message.split(/[\s"'`(),:\[\]{}]+/u)
    const matches = filePaths.filter(file => entry.subject === file || words.includes(file))
    const file = matches.length === 1 ? matches[0] : undefined
    return { message: entry.message, file, onOpen: file ? () => { if (openFile(file)) setTab('files') } : undefined }
  })
  const saveBlocker = candidateState?.saveUnverified ? (zh ? '保存结果待核对' : 'Verify the save result')
    : draftError ? (zh ? '未能读取待保存修改' : 'Changes could not be read for saving') : ''
  const saveDetails = candidateState?.saveUnverified
    ? [{ message: candidateState.error || (zh ? '请刷新内容核对保存结果，输入仍保留。' : 'Refresh the content to verify the save. Your input is retained.') }]
    : draftError ? [{ message: draftError }] : []
  const missingSourceFiles = sourcePending ? [] : record?.readiness?.diagnostics.filter(item => item.code === 'instance.missing_source').flatMap(item => item.path ? [item.path] : []) ?? []
  const previewState = (diagnostics: readonly { code: string; message: string; subject?: string }[], noPanel: boolean) => missingSourceFiles.length
    ? <StudioEmptyState title={zh ? '技能包内容尚未补齐' : 'Bundle files are incomplete'} description={zh ? `缺少 ${missingSourceFiles.join('、')}。可在原始文件中补充。` : `Missing ${missingSourceFiles.join(', ')}. Add them in Source Files.`}
      actions={[{ label: zh ? '查看原始文件' : 'View source files', onClick: () => setTab('files') }]} />
    : diagnostics.length
    ? diagnostics.every(item => item.code === 'preview.sample_missing')
      ? <StudioEmptyState title={zh ? '缺少预览样例' : 'Preview sample is missing'} description={zh ? '添加 reference/preview.json 后，可在这里查看面板效果。' : 'Add reference/preview.json to preview the Panel here.'} />
      : <StudioFeedback feedbackId={`preview:${JSON.stringify(diagnostics)}`} tone="error" locale={locale} title={zh ? '面板预览未能生成' : 'Panel preview could not be generated'} details={issueDetails(diagnostics)} />
    : <StudioEmptyState tone="info" title={noPanel ? (zh ? '此技能包无需面板预览' : 'No Panel preview is needed') : (zh ? '此处暂不支持面板预览' : 'Panel preview is unavailable here')} description={zh ? '可在原始文件中查看和编辑技能内容。' : 'View and edit this skill in Source Files.'} />
  const noPanelRequired = sourcePending ? !!candidateState?.matches && candidateState.prepared.candidate.valid && !candidateState.prepared.candidate.preview : !!preview && !preview.diagnostics.length && !preview.preview
  const sourcePane = <div className="ygd-studio-content-pane">
      <div className="ygd-studio-doc-toolbar"><div className="ygd-studio-file-heading"><FileName path={path} locale={locale} /></div><div className="ygd-studio-doc-toggle-group">{readOnly && /\.md$/i.test(path) ? <button type="button" className="ygd-studio-doc-toggle" aria-pressed={reading} onClick={() => setReading(!reading)}>{reading ? (zh ? '原文' : 'Source') : (zh ? '阅读' : 'Read')}</button> : !readOnly && <>
        <button type="button" className="ygd-studio-doc-toggle" aria-pressed={fileView === 'edit'} onClick={() => setFileView('edit')}>{zh ? '编辑' : 'Edit'}</button>
        <button type="button" className="ygd-studio-doc-toggle" aria-pressed={fileView === 'diff'} onClick={() => setFileView('diff')}>{zh ? '对比' : 'Diff'}</button>
      </>}</div></div>
      <div className="ygd-studio-document-body ygd-studio-source-body">{file?.editable === false ? <p role="status">{zh ? '此文件不支持文本编辑，复制时会完整保留。' : 'This file is not available for text editing. Copies preserve it in full.'}</p> : !loaded ? <p role="status">{error ? (zh ? '无法读取此文件。' : 'Could not load this file.') : path ? (zh ? '读取中…' : 'Loading…') : (zh ? '没有可读取的文件。' : 'No readable files.')}</p> : !readOnly && fileView === 'diff' ? <SourceFileDiff path={path} before={fileChange?.before ?? saved} after={fileChange && !Object.hasOwn(drafts, path) ? fileChange.after : content} /> : readOnly && reading && /\.md$/i.test(path) ? <div>{renderStudioDocument(content, { locale })}</div> : <textarea ref={sourceEditor} aria-label={path || 'Source file'} spellCheck={false} value={content} readOnly={readOnly || sourceLocked} onChange={event => editSource(event.target.value)} className="ygd-studio-source-input" />}</div>
      <footer className="ygd-studio-doc-footer"><span>{candidateState?.saveUnverified ? (zh ? '保存结果待确认，请刷新内容核对；不会自动重试' : 'Save result needs verification. Refresh the content; saving will not retry automatically.') : candidatePending ? (zh ? '待保存修改' : 'Proposed changes · not saved') : dirty ? (zh ? '未保存' : 'Unsaved') : !readOnly && file?.editable ? (zh ? '已保存 · 可编辑' : 'Saved · editable') : (zh ? '只读文件' : 'Read-only file')}</span><span>{loaded ? new TextEncoder().encode(content).length : fileChange ? new TextEncoder().encode(fileChange.after ?? '').length : file?.bytes ?? 0} {zh ? '字节' : 'bytes'}</span></footer>
    </div>
  const mountGeneration = generation.current
  const Root = embedded ? 'section' : 'main'
  return <Root className="ygd-studio-main ygd-studio-bundle-main ygd-studio-instance">
    <header className="ygd-studio-content-header"><div>
      <div className="ygd-studio-header-title-group">
        <button type="button" className="ygd-studio-instance-pencil" disabled={busy || candidateBusy} aria-label={zh ? '返回' : 'Back'} title={zh ? '返回' : 'Back'} onClick={() => { if (discard() && (!candidatePending || window.confirm(zh ? '放弃未保存的修改？' : 'Discard unsaved changes?'))) { restore(); sourceChanges?.onDismiss(); notifyDirty.current?.(false); onBack() } }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg></button>
        <span className="ygd-studio-kitmark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></svg></span>
        {renaming ? <input autoFocus aria-label={zh ? '名称' : 'Name'} className="ygd-studio-search-input" value={title} disabled={busy || candidateBusy} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); rename() } if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) } }} /> : <h1 className="ygd-studio-page-title">{record?.title[locale] ?? (zh ? '正在打开…' : 'Opening…')}</h1>}
        {!readOnly && record && <button className="ygd-studio-instance-pencil" type="button" disabled={sourceLocked || candidatePending} aria-label={zh ? '重命名' : 'Rename'} title={zh ? '重命名' : 'Rename'} onClick={() => { if (!discard()) return; restore(); setTitle(record.title[locale]); setRenaming(true) }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m13 3 4 4-9 9-5 1 1-5 9-9ZM11 5l4 4" /></svg></button>}
      </div>
      <div className="ygd-studio-hero-actions">
        {record && <>
          <button type="button" className="ygd-studio-btn-secondary" disabled={sourceLocked || candidatePending} onClick={duplicate}>{zh ? '复制' : 'Copy'}</button>
          {readOnly && onEdit && <button type="button" className="ygd-studio-btn-primary" disabled={busy || candidatePending} onClick={() => { if (!busy && !candidatePending) onEdit() }}>{zh ? '编辑' : 'Edit'}</button>}
          {!readOnly && <div className="ygd-studio-save-feedback"><div className="ygd-studio-editor-actions" role="group" aria-label={zh ? '编辑操作' : 'Editor actions'}>
            <span className="ygd-studio-mounts-change-status" role="status">{tab === 'mounts' ? mountActions?.status ?? (zh ? '已保存' : 'Saved') : sourceStatus}</span>
            <button type="button" className="ygd-studio-btn-secondary" disabled={sourceLocked || !(sourcePending || mountsDirty || titleDirty)} onClick={revertCurrent}>{zh ? '还原' : 'Revert'}</button>
            <button type="button" className="ygd-studio-btn-primary" disabled={sourceLocked || !canSave} onClick={saveCurrent}>{saveLabel}</button>
          </div></div>}
          <InstanceActionsMenu locale={locale}>
            {onExport && <button type="button" disabled={exportDisabled} onClick={exportSaved}>{zh ? '导出' : 'Export'}</button>}
            <button type="button" disabled={busy || candidateBusy || (candidatePending && !candidateState?.saveUnverified)} onClick={refresh}>{zh ? '刷新内容' : 'Refresh content'}</button>
            <InstanceTrashAction locale={locale} disabled={sourceLocked || candidatePending} onClick={remove} />
          </InstanceActionsMenu>
        </>}
      </div>
    </div></header>
    <StudioErrorDialog open={saveIssuesOpen} onClose={() => setSaveIssuesOpen(false)} locale={locale}
      title={saveBlocker || (zh ? '暂不能保存这次修改' : 'These changes cannot be saved yet')}
      message={zh ? '修改和输入已保留。请继续编辑或在原对话中请求修复，然后重新保存。' : 'Your changes and input are retained. Continue editing or request a repair in the existing conversation, then save again.'}
      details={saveDetails} actions={[{ label: zh ? '继续编辑' : 'Continue editing', primary: true, onClick: () => { setTab('files'); setTimeout(() => sourceEditor.current?.focus(), 0) } }]} />
    {!readOnly && renderSupplement?.({ record, dirty: dirty || titleDirty || candidatePending, busy: busy || candidateBusy, previewBundle, currentFile: (tab === 'files' || (tab === 'preview' && path === 'panel.yaml')) && path ? path : undefined, intent: authoringIntent, proposalReplacement })}
    {record && (record.kind === 'bundle' || !readOnly) && <div className="ygd-studio-workplane-bar" aria-label={record.kind === 'kit' ? 'Kit content' : 'Bundle content'}>
      <button type="button" className="ygd-studio-workplane-tab" aria-pressed={tab === 'files'} disabled={busy || candidateBusy || mountActions?.isSaveSubmitted()} onClick={() => changeTab('files')}>{zh ? '原始文件' : 'Source Files'}</button>
      {record.kind === 'kit'
        ? <button type="button" className="ygd-studio-workplane-tab" aria-pressed={tab === 'mounts'} disabled={sourceLocked || candidatePending || !client.updateMounts} onClick={() => changeTab('mounts')}>{zh ? '挂载管理' : 'Mount management'}</button>
        : <button type="button" className="ygd-studio-workplane-tab" aria-pressed={tab === 'preview'} disabled={busy || candidateBusy} onClick={() => changeTab('preview')}>{zh ? '面板预览' : 'Panel Preview'}</button>}
    </div>}
    <div className="ygd-studio-instance-feedback">
      {candidateState?.error && <StudioFeedback feedbackId={`candidate:${candidateState.prepared.candidate.digest}:${candidateState.error}`} tone="error" autoOpen locale={locale}
        title={candidateState.saveUnverified ? (zh ? '保存结果待核对' : 'Verify the save result') : (zh ? '暂不能保存这次修改' : 'These changes cannot be saved yet')}
        message={zh ? '输入和修改均已保留。请先核对已保存内容，再继续编辑。' : 'Your input and changes are retained. Verify the saved content before continuing.'}
        details={[{ message: candidateState.error }]} actions={candidateState.saveUnverified ? [{ label: zh ? '核对保存结果' : 'Verify saved copy', primary: true, onClick: refresh }] : undefined} />}
      {error && <StudioFeedback feedbackId={`source:${error}`} tone="error" locale={locale} title={zh ? '操作未完成' : 'The operation could not be completed'} message={error} />}
    </div>
    {tab === 'mounts' && !readOnly && record?.kind === 'kit' && <MountEditor key={`${id}:${record.revision}:${mountsEpoch}`} client={client} record={record} locale={locale}
      onDirtyChange={setMountsDirty} onBusyChange={setMountsBusy} onActions={setMountActions} onSaved={value => {
        if (generation.current !== mountGeneration || value.id !== id) return
        setRecord(value); setMountsDirty(false); onChanged(value)
      }} />}

    {tab === 'files' && (record?.id === id ? <div className="ygd-studio-workspace-body ygd-studio-files-layout"><aside className="ygd-studio-file-tree-pane"><div className="ygd-studio-file-tree-header"><span>{zh ? '全部文件' : 'All Files'} · {filePaths.length}</span>{!readOnly && batchSource && <button type="button" className="ygd-studio-btn-link" disabled={sourceLocked} onClick={() => { setNewFileOpen(true); setNewFileError('') }}>{zh ? '新建文件' : 'New file'}</button>}</div>
      {newFileOpen && <form className="ygd-studio-new-file" onSubmit={event => { event.preventDefault(); createFile() }}>
        <input autoFocus className="ygd-studio-text-input" aria-label={zh ? '文件名' : 'Filename'} aria-invalid={!!newFileError || undefined} aria-describedby={newFileError ? newFileErrorId : undefined} placeholder="reference/notes.md" value={newFilePath} disabled={sourceLocked} onChange={event => { setNewFilePath(event.target.value); setNewFileError('') }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setNewFileOpen(false) } }} />
        {newFileError && <p id={newFileErrorId} className="ygd-studio-field-error" role="alert">{newFileError}</p>}
        <div className="ygd-studio-editor-actions"><button type="button" className="ygd-studio-btn-secondary" disabled={sourceLocked} onClick={() => setNewFileOpen(false)}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className="ygd-studio-btn-primary" disabled={sourceLocked || !newFilePath.trim()}>{zh ? '新建' : 'Create'}</button></div>
      </form>}<FileExplorer paths={filePaths} selected={path} disabled={sourceLocked} openFile={openFile} /></aside>{sourcePane}{readOnly && <FileInfoSidebar kind={record.kind} locale={locale} description={record.displayDescription?.[locale] ?? record.description} />}</div>
      : opening ? <LoadingIndicator label={zh ? '正在打开内容' : 'Opening content'} /> : null)}
    {tab === 'preview' && record?.kind === 'bundle' && <section className="ygd-studio-panel-split">
      <section className="ygd-studio-yaml-pane" aria-label={zh ? '面板源码' : 'Panel source'}>{filePaths.includes('panel.yaml') ? sourcePane : <StudioEmptyState tone={noPanelRequired ? 'info' : 'warning'} title={zh ? '未提供面板源码' : 'No Panel source'} description={zh ? '此技能包没有 panel.yaml 文件。' : 'This Bundle has no panel.yaml file.'} />}</section>
      <section className="ygd-studio-live-pane" aria-label={zh ? '实时面板预览' : 'Live Panel preview'}>
      <header><strong>{zh ? '面板预览' : 'Panel Preview'}</strong><span>{zh ? '随源码更新 · 样例数据' : 'Live source · sample data'}</span></header>
      <div className="ygd-studio-live-pane-body">
      {sourcePending ? <>
        {preparingDraft ? <LoadingIndicator label={zh ? '正在更新预览' : 'Updating preview'} /> : <>
          {candidateState?.matches && candidateState.prepared.candidate.preview && renderPreview ? renderPreview(candidateState.prepared.candidate.preview, () => {}, { readOnly: true, toolbarTarget: null }) : previewState(candidateState?.prepared.candidate.diagnostics ?? [], noPanelRequired)}
        </>}
      </> : <>
        {previewBusy && <LoadingIndicator label={zh ? '正在准备预览' : 'Preparing preview'} />}
        {preview?.preview && renderPreview ? renderPreview(preview.preview, () => {}, { readOnly, toolbarTarget: null }) : !previewBusy && previewState(preview?.diagnostics ?? [], noPanelRequired)}
      </>}
      </div></section>
    </section>}
  </Root>
}

/** Existing Studio overflow pattern, shared by catalog cards and working-copy headers. */
export function InstanceActionsMenu({ locale, children }: { locale: 'zh' | 'en'; children: ReactNode }): ReactElement {
  return <details className="ygd-studio-instance-menu"><summary aria-label={locale === 'zh' ? '更多操作' : 'More actions'} title={locale === 'zh' ? '更多操作' : 'More actions'}>…</summary><div onClick={event => {
    if ((event.target as HTMLElement).closest('button:not(:disabled)')) event.currentTarget.parentElement?.removeAttribute('open')
  }}>{children}</div></details>
}

/** Removal uses the same revision/ref warning from both copy entry surfaces. */
export function confirmInstanceRemoval(record: StudioInstance, locale: 'zh' | 'en'): boolean {
  const refs = record.refs.map(ref => ref.title[locale]).join('、')
  return window.confirm(locale === 'zh' ? `将「${record.title[locale]}」移到系统回收站？${refs ? `以下引用将受影响：${refs}。` : ''}你可以从系统回收站恢复，或重新导入。`
    : `Move “${record.title[locale]}” to the system Trash? ${refs ? `Affected references: ${refs}. ` : ''}You can restore it from the Trash or import it again.`)
}

/** One destructive menu action for Kit/Bundle cards and their editor headers. */
export function InstanceTrashAction({ locale, disabled, onClick }: { locale: 'zh' | 'en'; disabled?: boolean; onClick: () => void }): ReactElement {
  return <button type="button" data-tone="danger" disabled={disabled} onClick={onClick}>{locale === 'zh' ? '移到回收站' : 'Move to Trash'}</button>
}
