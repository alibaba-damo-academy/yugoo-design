/** Shared candidate lifetime and verified save state. Presentation grants no new authority. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioInstanceCandidate, StudioInstanceChangeRequest } from 'dsh-design-studio'
import type { StudioInstance, StudioInstanceClient } from './InstanceWorkbench.tsx'

export interface StudioPreparedSourceChanges {
  readonly request: StudioInstanceChangeRequest
  readonly candidate: StudioInstanceCandidate
}
export interface SourceCandidateOptions {
  readonly prepared: StudioPreparedSourceChanges
  readonly client: Pick<StudioInstanceClient, 'read' | 'readFile'> & Required<Pick<StudioInstanceClient, 'saveChanges'>>
  readonly locale: 'zh' | 'en'
  readonly renderPreview?: unknown
  readonly instanceId?: string
  readonly onSaved: (record: StudioInstance) => void
  readonly onDirtyChange?: (dirty: boolean) => void
}
const identity = (value?: StudioPreparedSourceChanges) => value
  ? `${value.request.id}:${value.request.expectedRevision}:${value.candidate.digest}` : undefined

/** Optional so the ordinary workbench remains mounted before, during and after a proposal. */
export function useSourceCandidate(options?: SourceCandidateOptions) {
  // Human edits and AI proposals save the same current files. Preview validity
  // determines whether a preview can render, never whether work may be saved.
  const mode = 'draft'
  const key = options ? `${identity(options.prepared)}:${mode}` : undefined, client = options?.client, instanceId = options?.instanceId
  const currentKey = () => callbacks.current ? `${identity(callbacks.current.prepared)}:${mode}` : undefined
  // A host cannot mutate the captured text after the user has seen it.
  const prepared = useMemo(() => options ? structuredClone(options.prepared) : undefined, [key])
  const [record, setRecord] = useState<StudioInstance>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  const [saveUnverified, setSaveUnverified] = useState(false)
  const generation = useRef(0), callbacks = useRef(options); callbacks.current = options
  const submitted = useRef(false), selected = useRef<string>(), readOwner = useRef(client)
  const submittedRecord = useRef<StudioInstance>()
  // Presentation may consult the existing synchronous save fence before replacing a proposal.
  const isSaveSubmitted = useCallback(() => submitted.current, [])
  const request = prepared?.request, candidate = prepared?.candidate
  const zh = options?.locale === 'zh'
  const matches = !!request && !!candidate && (!options?.instanceId || request.id === options.instanceId)
    && candidate.id === request.id && candidate.baseRevision === request.expectedRevision
    && candidate.revision === request.expectedRevision + 1 && /^[a-f0-9]{64}$/.test(candidate.digest)
    && candidate.diff.every(diff => request.changes.some(change => change.path === diff.path
      && (change.content === null ? diff.after === undefined : change.content === diff.after)))
    && (!candidate.preview || candidate.preview.revision === candidate.revision)

  useEffect(() => {
    const current = ++generation.current
    const isCurrent = () => generation.current === current && callbacks.current?.client === client
      && currentKey() === key && callbacks.current?.instanceId === instanceId
    setRecord(undefined); setBusy(false); readOwner.current = client
    if (selected.current !== key) {
      selected.current = key; submitted.current = false; submittedRecord.current = undefined; setSaved(false); setSaveUnverified(false)
    }
    if (!prepared || !client) { setError(''); return () => { ++generation.current } }
    if (submitted.current) {
      setSaveUnverified(true)
      setError(zh ? '保存期间连接已改变，请重新打开副本核对结果。' : 'The connection changed after save was submitted. Reopen the working copy to verify the result.')
    } else setError('')
    callbacks.current?.onDirtyChange?.(true)
    if (!matches) setError(zh ? '候选与这次修改不一致，请重新准备。' : 'The candidate does not match these changes. Prepare it again.')
    else void client.read({ id: prepared.request.id }).then(value => {
      if (!isCurrent()) return
      if (value.id !== prepared.request.id || value.revision !== prepared.request.expectedRevision || value.deletedAt) {
        setError(zh ? '工作副本已改变，请基于当前内容重新准备修改。' : 'The working copy changed. Prepare changes against its current contents.')
        return
      }
      setRecord(value)
    }, failure => { if (isCurrent()) setError(String(failure instanceof Error ? failure.message : failure)) })
    return () => { ++generation.current; callbacks.current?.onDirtyChange?.(false) }
  }, [client, prepared, instanceId])

  const currentRecord = selected.current === key && readOwner.current === client ? record : undefined
  const canSave = !!currentRecord && !busy && !saved && !saveUnverified && !submitted.current && !error
    && matches && !!client?.saveChanges
  const save = async () => {
    if (!canSave || !request || !candidate || !client || callbacks.current?.client !== client
      || currentKey() !== key || selected.current !== key || callbacks.current?.instanceId !== instanceId) return
    const current = generation.current
    const isCurrent = () => generation.current === current && callbacks.current?.client === client
      && currentKey() === key && callbacks.current?.instanceId === instanceId
    submitted.current = true; submittedRecord.current = currentRecord; setBusy(true)
    try {
      const value = await client.saveChanges({ ...request, mode, digest: candidate.digest })
      if (!isCurrent()) return
      const receipt = value.changeReceipt
      if (value.id !== request.id || value.kind !== currentRecord?.kind || value.revision !== candidate.revision || receipt.digest !== candidate.digest
        || receipt.baseRevision !== request.expectedRevision || receipt.revision !== candidate.revision
        || receipt.mode !== mode || receipt.validation !== 'not_requested') throw Error(zh ? '保存回执与修改不一致，请重新打开核对。' : 'The save receipt does not match these changes. Reopen to verify it.')
      setRecord(value); setSaved(true); callbacks.current?.onDirtyChange?.(false); callbacks.current?.onSaved(value)
    } catch (failure) {
      if (isCurrent()) { setSaveUnverified(true); setError(String(failure instanceof Error ? failure.message : failure)) }
    } finally { if (isCurrent()) setBusy(false) }
  }
  const verifySave = async () => {
    if (!saveUnverified || busy || !submitted.current || !request || !candidate || !client) return
    const current = generation.current
    const isCurrent = () => generation.current === current && callbacks.current?.client === client
      && currentKey() === key && callbacks.current?.instanceId === instanceId
    setBusy(true)
    try {
      const value = await client.read({ id: request.id })
      if (!isCurrent()) return
      if (value.id !== request.id || value.kind !== submittedRecord.current?.kind || value.deletedAt) {
        throw Error(zh ? '无法核对当前副本，草稿已保留。' : 'The current copy could not be verified. Your draft is retained.')
      }
      if (value.revision === request.expectedRevision) {
        // No write committed. Keep the exact proposal and human edits; retry is explicit.
        submitted.current = false; setSaveUnverified(false); setRecord(value); setError('')
        return
      }
      let matchesSaved = value.revision === candidate.revision
      if (matchesSaved && !value.files) throw Error(zh ? '未能读取已保存文件清单，草稿已保留。请重试核对。' : 'The saved file list is unavailable. Your draft is retained. Retry verification.')
      if (matchesSaved) for (const change of request.changes) {
        const exists = value.files?.some(file => file.path === change.path)
        if (change.content === null) { if (exists) matchesSaved = false; continue }
        if (!exists) { matchesSaved = false; break }
        const file = await client.readFile({ id: request.id, path: change.path })
        if (!isCurrent()) return
        if (file.id !== request.id || file.path !== change.path || file.revision !== value.revision || file.content !== change.content) {
          matchesSaved = false; break
        }
      }
      if (!matchesSaved) {
        // A confirmed different revision is a conflict, not an unknown write outcome.
        submitted.current = false; setSaveUnverified(false)
        setError(zh ? '已保存内容与这次修改不同，草稿已保留。请对比当前内容后重新准备修改。' : 'The saved content differs from these changes. Your draft is retained. Compare the current content and prepare changes again.')
        return
      }
      setRecord(value); setSaved(true); setSaveUnverified(false); setError('')
      callbacks.current?.onDirtyChange?.(false); callbacks.current?.onSaved(value)
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : String(failure))
    } finally { if (isCurrent()) setBusy(false) }
  }
  return prepared ? { prepared, record: currentRecord, error, busy, saved, saveUnverified, matches, canSave, save, verifySave, isSaveSubmitted } : undefined
}
