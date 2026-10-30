/** Browser projection only: native execution, candidate preparation and saving keep their existing owners. */
import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { InstanceWorkbench, StudioFeedback, ConversationMessage, ConversationMessages, type AgentConversationRow, type InstanceWorkbenchProps, type StudioInstance, type StudioInstanceClient } from 'dsh-design-studio-ui'
import { PanelSamplePreview } from 'dsh-design-panel/sample-preview'
import type { StudioPageAuthoringClient, StudioPageAuthoringStart } from './authoring.page-rpc.ts'
import type { StudioAuthoringObservation, StudioAuthoringReference } from './authoring-agent.types.ts'
import type { StudioSessionPrepared } from './authoring-session.types.ts'
import type { StudioPreparedLocator } from './authoring-host.types.ts'

export interface StudioAuthoringWorkbenchProps extends Omit<InstanceWorkbenchProps, 'client' | 'renderSupplement' | 'embedded' | 'initialView' | 'sourceChanges'> {
  /** Already scoped to the native parent by the page. Identity changes invalidate this open editor. */
  client: StudioPageAuthoringClient
  presentation?: 'content-only' | 'full'
  preparedLocator?: StudioPreparedLocator
  initialPrompt?: string
}
export const StudioAuthoringPromptContext = createContext<string | undefined>(undefined)
type Editor = Pick<Parameters<NonNullable<InstanceWorkbenchProps['renderSupplement']>>[0], 'record' | 'dirty' | 'busy' | 'previewBundle' | 'proposalReplacement'>
type Attempt = {
  request: StudioPageAuthoringStart
  intentVersion: number
  reference?: StudioAuthoringReference
  observation?: StudioAuthoringObservation
  prepared?: StudioSessionPrepared
  owned: boolean
  uncertain: boolean
  error?: string
}
type ConversationEntry = {
  id: string; prompt: string; status?: StudioAuthoringObservation['status']; uncertain: boolean
  candidateFiles?: number; candidateValid?: boolean; saved: boolean
  nativeRows?: readonly AgentConversationRow[]; omitted?: number
}
const conversationEntry = (attempt: Attempt, saved: boolean): ConversationEntry => ({
  id: attempt.request.invocationId, prompt: attempt.request.prompt, status: attempt.observation?.status,
  uncertain: attempt.uncertain, candidateFiles: attempt.prepared?.candidate.diff.length, candidateValid: attempt.prepared?.candidate.valid, saved,
  nativeRows: attempt.observation?.conversation?.rows, omitted: attempt.observation?.conversation?.omitted,
})
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const address = (ref: StudioAuthoringReference) => ({ sessionId: ref.sessionId, epoch: ref.epoch })
function sameReference(ref: StudioAuthoringReference, request: StudioPageAuthoringStart) {
  return ref.invocationId === request.invocationId && ref.scope.id === request.id
    && ref.scope.expectedRevision === request.expectedRevision
    && ref.scope.bundle?.name === request.bundle?.name && ref.scope.bundle?.version === request.bundle?.version
    && ref.scope.allowedPaths.length === request.paths.length
    && ref.scope.allowedPaths.every(path => request.paths.includes(path))
}
function sameRun(left: StudioAuthoringReference, right: StudioAuthoringReference) {
  return left.sessionId === right.sessionId && left.epoch === right.epoch
    && left.parentSessionId === right.parentSessionId && left.messageId === right.messageId
    && left.afterSeq === right.afterSeq && sameReference(left, { invocationId: right.invocationId,
      id: right.scope.id, expectedRevision: right.scope.expectedRevision, paths: right.scope.allowedPaths, bundle: right.scope.bundle, prompt: '' })
}
function matchesPrepared(prepared: StudioSessionPrepared, request: StudioPageAuthoringStart) {
  return prepared.request.id === request.id && prepared.request.expectedRevision === request.expectedRevision
    && prepared.candidate.id === request.id && prepared.candidate.baseRevision === request.expectedRevision
    && prepared.candidate.revision === request.expectedRevision + 1
}

/** Keep the editor mounted on connection changes, but never send old edits into a new parent's port. */
function guardInstances(source: StudioInstanceClient, active: () => boolean): StudioInstanceClient {
  // The transport freezes its own method properties. A fresh facade may wrap
  // those inherited methods without violating Proxy's frozen-property rules.
  return new Proxy(Object.create(source) as StudioInstanceClient, { get(_target, key) {
    const value = Reflect.get(source, key)
    if (typeof value !== 'function') return value
    return async (...args: unknown[]) => {
      if (!active()) throw new Error('The authoring connection changed. Your input is retained; reopen this working copy to reconnect.')
      const result = await Reflect.apply(value, source, args)
      if (!active()) throw new Error('The authoring connection changed while the request settled. Reopen to verify the saved source; your input is retained.')
      return result
    }
  } })
}

export function StudioAuthoringWorkbench(props: StudioAuthoringWorkbenchProps) {
  return <Workbench key={props.id} {...props} />
}

function Workbench({ client, id, locale, onBack, onChanged, onDirtyChange, renderPreview, initialSelection, onExport,
  presentation = 'full', preparedLocator, initialPrompt }: StudioAuthoringWorkbenchProps) {
  const contextPrompt = useContext(StudioAuthoringPromptContext)
  const prefill = initialPrompt ?? contextPrompt
  const zh = locale === 'zh'
  const text = (en: string, cn: string) => zh ? cn : en
  const initial = useRef(client), current = useRef(client); current.current = client
  const invalidated = useRef(false), live = useRef(true), sequence = useRef(0), reads = useRef(0)
  const connected = client === initial.current && !invalidated.current
  const active = useCallback(() => live.current && !invalidated.current && current.current === initial.current, [])
  const [instances] = useState(() => guardInstances(client.instances, active))
  const reviewClient = useMemo(() => guardInstances(initial.current.instances, active), [client, active])
  const editor = useRef<Editor>({ dirty: false, busy: false })
  const [snapshot, setSnapshot] = useState<Editor>(editor.current)
  const syncEditor = useCallback((next: Editor) => {
    editor.current = next
    setSnapshot(old => old.record === next.record && old.dirty === next.dirty && old.busy === next.busy && old.previewBundle === next.previewBundle && old.proposalReplacement === next.proposalReplacement ? old : next)
  }, [])
  const [intent, setIntent] = useState(prefill ?? ''), [attempt, setAttempt] = useState<Attempt>()
  const intentVersion = useRef(0)
  const usedPrefill = useRef(!!prefill)
  const currentIntent = useRef(intent); currentIntent.current = intent
  useEffect(() => {
    if (!prefill || usedPrefill.current) return
    usedPrefill.current = true
    if (!currentIntent.current.trim()) { intentVersion.current++; setIntent(prefill) }
  }, [prefill])
  // A compact projection of requests witnessed in this open editor, not a second native transcript.
  const [history, setHistory] = useState<ConversationEntry[]>([])
  const attemptRef = useRef(attempt); attemptRef.current = attempt
  useEffect(() => {
    if (attempt?.owned && !attempt.uncertain && attempt.observation?.consumed
      && attempt.observation.status !== 'unknown' && attempt.intentVersion === intentVersion.current) {
      setIntent(value => value === attempt.request.prompt ? '' : value)
    }
  }, [attempt])
  const [busy, setBusy] = useState(false), busyRef = useRef(false)
  const [error, setError] = useState(''), [review, setReview] = useState<StudioSessionPrepared>()
  const [reviewSaved, setReviewSaved] = useState(false)
  const [contentCandidate, setContentCandidate] = useState<StudioSessionPrepared>()
  const [contentError, setContentError] = useState(''), [contentLoading, setContentLoading] = useState(false)
  const [savedRequest, setSavedRequest] = useState<string>()
  const reviewRequest = useRef<string>()
  const reviewInvocation = useRef<string>()
  const openedRequest = useRef<string>()
  const openedFullCandidates = useRef(new Set<string>())
  const fullCandidateKey = attempt?.prepared ? JSON.stringify([attempt.request.invocationId,
    attempt.prepared.request.id, attempt.prepared.request.expectedRevision, attempt.prepared.candidate.digest]) : undefined
  const locatorKey = JSON.stringify(preparedLocator)
  const dirty = useRef(false), notify = useRef(onDirtyChange); notify.current = onDirtyChange
  const extraDirty = useRef(false)
  extraDirty.current = !!intent || (!!attempt && !reviewSaved) || (!!review && !reviewSaved)
  const reportDirty = useCallback(() => { if (live.current) notify.current?.(dirty.current || extraDirty.current, { sourceDirty: dirty.current }) }, [])
  const editorDirty = useCallback((value: boolean) => { dirty.current = value; reportDirty() }, [reportDirty])
  useEffect(reportDirty, [intent, attempt, review, reviewSaved, reportDirty])
  useLayoutEffect(() => { if (client !== initial.current) { invalidated.current = true; sequence.current++ } }, [client])
  useEffect(() => {
    live.current = true; reportDirty()
    const leave = (event: BeforeUnloadEvent) => { if (extraDirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leave)
    return () => { live.current = false; sequence.current++; window.removeEventListener('beforeunload', leave); notify.current?.(false) }
  }, [reportDirty])
  useEffect(() => {
    if (!preparedLocator || !connected) return
    const locator = structuredClone(preparedLocator)
    let stopped = false
    setContentCandidate(undefined); setContentError(''); setContentLoading(true)
    void initial.current.readPrepared(locator).then(value => {
      if (stopped || !active()) return
      if (!value || locator.id !== id || value.request.id !== locator.id || value.request.expectedRevision !== locator.expectedRevision
        || value.candidate.id !== locator.id || value.candidate.baseRevision !== locator.expectedRevision
        || value.candidate.revision !== locator.expectedRevision + 1 || value.candidate.digest !== locator.digest
        || (value.request.bundle && (value.request.bundle.name !== locator.bundle?.name || value.request.bundle.version !== locator.bundle?.version))
        || (value.candidate.preview && (value.candidate.preview.bundle.name !== locator.bundle?.name || value.candidate.preview.bundle.version !== locator.bundle?.version))) {
        throw new Error('The candidate does not match this exact working copy, revision, Bundle pin and digest.')
      }
      setContentCandidate(value)
    }).catch(failure => { if (!stopped && active()) setContentError(message(failure)) })
      .finally(() => { if (!stopped && active()) setContentLoading(false) })
    return () => { stopped = true }
  }, [locatorKey, presentation, connected, active, id])
  const update = (invocationId: string, change: (value: Attempt) => Attempt) => {
    if (!active()) return
    setAttempt(value => value?.request.invocationId === invocationId ? change(value) : value)
  }

  // Only reads may repeat. A missing or ambiguous response never causes a model dispatch.
  async function reconcile(value: Attempt) {
    if (!active()) return
    const reading = ++reads.current
    const valid = () => active() && reads.current === reading
    try {
      let ref = value.reference
      if (!ref) {
        const refs = (await initial.current.listReferences()).filter(ref => sameReference(ref, value.request))
        if (!valid()) return
        if (refs.length !== 1) throw new Error(text('This request is not yet uniquely recoverable. Check again; do not send it again.', '暂时无法唯一确认这次请求。请再次核对，不要重复发送。'))
        ref = refs[0]
        update(value.request.invocationId, old => ({ ...old, reference: ref }))
      }
      const [observed, prepared] = await Promise.allSettled([
        initial.current.observe(address(ref)), initial.current.readPrepared(address(ref)),
      ])
      if (!valid()) return
      if (prepared.status === 'fulfilled' && prepared.value && !matchesPrepared(prepared.value, value.request)) throw new Error('The candidate belongs to a different source revision or request.')
      const observation = observed.status === 'fulfilled' && sameRun(observed.value.reference, ref) ? observed.value : undefined
      update(value.request.invocationId, old => {
        const previous = old.observation
        // A delayed read cannot rewind a witnessed turn or terminal outcome.
        const next = observation && (!previous || (observation.throughSeq >= previous.throughSeq && (!previous.terminal || observation.terminal))) ? observation : previous
        return { ...old, reference: ref, observation: next,
          prepared: prepared.status === 'fulfilled' ? prepared.value : old.prepared,
          owned: prepared.status === 'fulfilled', uncertain: prepared.status === 'rejected' || !observation || observation.status === 'unknown',
          error: prepared.status === 'rejected' ? text('This connection cannot retrieve the owned candidate or control this run. Reopen to verify its outcome.', '当前连接无法取得候选或控制这次运行，请重新打开以核对结果。')
            : !observation ? text('Execution status could not be checked. An available candidate can still be reviewed; execution will not be resent.', '执行状态尚未核实。已取得的候选仍可审阅，不会重发执行。') : undefined,
        }
      })
    } catch (failure) {
      if (valid()) update(value.request.invocationId, old => ({ ...old, uncertain: true, owned: false, error: message(failure) }))
    }
  }
  const invocationId = attempt?.request.invocationId, nativeKey = attempt?.reference?.epoch
  useEffect(() => {
    if (presentation !== 'full' || !connected || !invocationId || busy) return
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const value = attemptRef.current
      if (!value || stopped) return
      await reconcile(value)
      const latest = attemptRef.current
      if (!stopped && active() && (!latest?.observation?.terminal || latest.uncertain)) timer = setTimeout(() => { void tick() }, 1200)
    }
    void tick()
    return () => { stopped = true; reads.current++; clearTimeout(timer) }
  }, [presentation, connected, invocationId, nativeKey, busy])

  const sourceReady = (value: Editor) => !value.dirty || (!!review && !!value.proposalReplacement?.canReplace()
    && review.request.id === value.record?.id && review.request.expectedRevision === value.record?.revision)
  async function begin(snapshot: Editor) {
    if (busyRef.current || contentLoading || !active() || !instances.saveChanges || !sourceReady(snapshot) || snapshot.busy || !snapshot.record || !intent.trim()) return
    const prior = attemptRef.current, record = snapshot.record
    const submittedIntentVersion = intentVersion.current
    const request: StudioPageAuthoringStart = { invocationId: crypto.randomUUID(), id: record.id,
      expectedRevision: record.revision, paths: record.files?.filter(file => file.editable).slice(0, 64).map(file => file.path) ?? [],
      bundle: snapshot.previewBundle ?? record.bundle ?? record.source.bundle, prompt: intent }
    if ((record.kind === 'bundle' && !request.bundle) || !request.paths.length || request.paths.length > 64) return
    if (prior && (!prior.reference || prior.uncertain || !prior.owned || !prior.observation?.terminal
      || !prior.observation.consumed || prior.observation.pendingInput || intent === prior.request.prompt)) return
    busyRef.current = true; setBusy(true); setError('')
    const token = ++sequence.current
    const valid = () => active() && token === sequence.current
    try {
      const now = editor.current
      if (!sourceReady(now) || now.busy || now.record?.id !== record.id || now.record.revision !== record.revision) throw new Error(text('Your source changed before authoring started. Save or discard edits, then send a new request.', '开始编辑前原始文件发生了修改。请先保存或放弃编辑，再明确发送新请求。'))
      const value: Attempt = { request, intentVersion: submittedIntentVersion, owned: false, uncertain: true }
      if (prior) setHistory(old => [...old, conversationEntry(prior, reviewSaved)])
      // An explicit continuation owns subsequent candidates, while the current
      // pristine proposal stays visible until a verified replacement arrives.
      if (review) reviewInvocation.current = request.invocationId
      attemptRef.current = value; setAttempt(value); setReviewSaved(false)
      try {
        const ref = prior?.reference
          ? await initial.current.resume({ ...request, previous: address(prior.reference), explicit: true })
          : await initial.current.start(request)
        if (!valid()) return
        if (!sameReference(ref, request)) throw new Error('The native response belongs to a different request.')
        const accepted = { ...value, reference: ref }
        attemptRef.current = accepted; setAttempt(accepted)
        await reconcile(accepted)
      } catch (failure) {
        if (!valid()) return
        update(request.invocationId, old => ({ ...old, error: text('The response was not confirmed. Check this request before taking another action. ', '响应尚未确认，请先核对这次请求。') + message(failure), uncertain: true }))
        await reconcile(value)
      }
    } catch (failure) { if (valid()) setError(message(failure)) }
    finally { if (valid()) { busyRef.current = false; setBusy(false) } }
  }
  async function cancel() {
    const value = attemptRef.current
    if (busyRef.current || !active() || !value?.reference || !value.owned || value.uncertain || !value.observation || value.observation.terminal
      || !['queued', 'running'].includes(value.observation.status)) return
    busyRef.current = true; reads.current++; setBusy(true)
    const token = ++sequence.current
    try {
      const observed = await initial.current.cancel(address(value.reference), { expectedTurn: value.observation.turn })
      if (!active() || token !== sequence.current) return
      if (!sameRun(observed.reference, value.reference)) throw new Error('The cancellation response belongs to a different request.')
      update(value.request.invocationId, old => ({ ...old, observation: observed, uncertain: observed.status === 'unknown', error: undefined }))
    } catch (failure) { update(value.request.invocationId, old => ({ ...old, uncertain: true, owned: false, error: message(failure) })) }
    finally { if (active() && token === sequence.current) { busyRef.current = false; setBusy(false) } }
  }
  const preview: NonNullable<InstanceWorkbenchProps['renderPreview']> = (value, _adopt, options) => renderPreview
    ? renderPreview(value, () => {}, { ...options, readOnly: true })
    : <PanelSamplePreview skill={value.bundle.name} panelYaml={value.panelYaml} sample={value.sample} locale={zh ? 'zh-CN' : 'en-US'} />
  const contentMatches = (value: Editor) => {
    const record = value.record, locator = preparedLocator
    if (!record || !locator || !contentCandidate || record.id !== locator.id || record.revision !== locator.expectedRevision
      || contentCandidate.request.expectedRevision !== locator.expectedRevision || contentCandidate.candidate.digest !== locator.digest) return false
    const pin = locator.bundle
    return record.kind === 'bundle' ? record.bundle?.name === pin?.name && record.bundle?.version === pin?.version
      : pin === undefined ? contentCandidate.request.bundle === undefined
        : record.mounts.some(mount => mount.bundle.name === pin.name && mount.bundle.version === pin.version)
  }
  const openContentReview = () => {
    if (!active() || !contentCandidate || !contentMatches(editor.current) || editor.current.dirty || editor.current.busy
      || busy || !instances.saveChanges || savedRequest === preparedLocator?.requestId) return
    reviewRequest.current = preparedLocator?.requestId
    openedRequest.current = locatorKey
    setReview(structuredClone(contentCandidate)); setReviewSaved(false)
  }
  // An explicit exact candidate link is already the user's choice of proposal.
  // Open its read-only review once; Back and all saves remain explicit actions.
  useEffect(() => {
    if (!preparedLocator || openedRequest.current === locatorKey || review || attempt
      || !active() || !contentCandidate || !contentMatches(snapshot) || snapshot.dirty || snapshot.busy
      || busy || !instances.saveChanges || savedRequest === preparedLocator.requestId) return
    openedRequest.current = locatorKey
    reviewRequest.current = preparedLocator.requestId
    setReview(structuredClone(contentCandidate)); setReviewSaved(false)
  }, [presentation, locatorKey, contentCandidate, snapshot, connected, busy, review, attempt, savedRequest, active, instances])
  const latestMatches = (current: Editor) => !!attempt?.owned && !!attempt.prepared && current.record?.id === attempt.prepared.request.id
    && current.record.revision === attempt.prepared.request.expectedRevision && matchesPrepared(attempt.prepared, attempt.request)
  const newerCandidate = !reviewSaved && !!attempt?.prepared && (review
    ? reviewInvocation.current === attempt.request.invocationId && review.candidate.digest !== attempt.prepared.candidate.digest
    : snapshot.dirty)
  const reviewLatest = () => {
    const current = editor.current
    if (!active() || busyRef.current || current.busy || !instances.saveChanges || !latestMatches(current) || !attempt?.prepared) return
    if (newerCandidate ? !current.proposalReplacement?.discard() : current.dirty) return
    reviewRequest.current = undefined; reviewInvocation.current = attempt.request.invocationId
    if (fullCandidateKey) openedFullCandidates.current.add(fullCandidateKey)
    setReview(structuredClone(attempt.prepared)); setReviewSaved(false)
  }
  // Same-request progress replaces a pristine proposal. The shared editor owns
  // human drafts and the synchronous save fence; pending proposal presence is not a human edit.
  // Revert leaves the known presentation keys seen, so a poll cannot reclaim editing.
  useEffect(() => {
    if (presentation !== 'full' || !fullCandidateKey || (review
      ? review.candidate.digest === attempt?.prepared?.candidate.digest : openedFullCandidates.current.has(fullCandidateKey))
      || !active() || busyRef.current || !instances.saveChanges || !attempt?.owned || !attempt.prepared) return
    const current = editor.current, prepared = attempt.prepared
    if (current.busy || !latestMatches(current) || !current.proposalReplacement?.canReplace()
      || (review && (reviewInvocation.current !== attempt.request.invocationId || !matchesPrepared(review, attempt.request)))) return
    openedFullCandidates.current.add(fullCandidateKey)
    reviewRequest.current = undefined; reviewInvocation.current = attempt.request.invocationId
    setReview(structuredClone(prepared)); setReviewSaved(false)
  }, [presentation, fullCandidateKey, review, attempt, snapshot, busy, active, instances])
  return <main className={`ygd-studio-main${presentation === 'full' ? ' ygd-studio-authoring-layout' : ''}`}>
    {presentation === 'full' && <AuthoringControls snapshot={snapshot} zh={zh} intent={intent} setIntent={value => { intentVersion.current++; setIntent(value) }}
      attempt={attempt} history={history} busy={busy || contentLoading} connected={connected} error={error} hasSave={!!instances.saveChanges} saved={reviewSaved} reviewing={!!review}
      canReopen={!!fullCandidateKey && openedFullCandidates.current.has(fullCandidateKey)} newerCandidate={newerCandidate}
      begin={() => { void begin(editor.current) }} cancel={() => { void cancel() }} check={() => { if (attempt) void reconcile(attempt) }}
      review={reviewLatest} />}
    <div className="ygd-studio-authoring-content" aria-label={text('Working copy content', '工作副本内容')}>
    <InstanceWorkbench client={instances} id={id} locale={locale} onBack={onBack} embedded initialView="preview"
      sourceChanges={review ? { prepared: review,
        client: reviewClient as StudioInstanceClient & Required<Pick<StudioInstanceClient, 'saveChanges'>>,
        onDismiss: () => { if (fullCandidateKey) openedFullCandidates.current.add(fullCandidateKey); setReview(undefined) },
        onSaved: record => {
          const submitted = attemptRef.current
          const savedCurrentProposal = !submitted || !!submitted.prepared && matchesPrepared(review, submitted.request)
            && submitted.prepared.candidate.digest === review.candidate.digest
          setReviewSaved(savedCurrentProposal); setSavedRequest(reviewRequest.current); setReview(undefined); onChanged(record)
        },
      } : undefined}
      onChanged={record => { setReview(undefined); onChanged(record) }}
      initialSelection={initialSelection} onExport={onExport} renderPreview={preview} onDirtyChange={editorDirty} renderSupplement={value => <>
        <EditorSnapshot value={value} onChange={syncEditor} />
        {preparedLocator && !attempt && (!review || !connected || contentLoading || contentError) && <div className="ygd-studio-doc-toolbar">
          <p role="status">{savedRequest === preparedLocator.requestId ? text('Candidate saved to the working copy.', '候选已保存到工作副本。')
            : !connected ? text('The connection changed. Reopen to verify this candidate.', '连接已变化，请重新打开以核对此候选。')
            : contentLoading ? text('Checking proposed changes…', '正在核对修改建议…')
            : review ? ''
            : value.dirty || value.busy ? text('Save or discard source edits before reviewing changes.', '请先保存或放弃原始文件编辑，再审阅修改。')
            : contentCandidate && !contentMatches(value) ? text('The working copy or Bundle pin has changed. Reopen the current proposal.', '工作副本或技能包版本已变化，请重新打开当前建议。')
            : contentCandidate ? text(`${contentCandidate.candidate.diff.length} files changed. Review before saving.`, `涉及 ${contentCandidate.candidate.diff.length} 个文件，审阅后可保存。`) : ''}</p>
          {contentError && <StudioFeedback feedbackId={`content:${contentError}`} tone="error" locale={locale} title={text('Candidate could not be opened', '未能打开候选')} message={contentError} />}
          {!review && contentCandidate && openedRequest.current === locatorKey && savedRequest !== preparedLocator.requestId && <button type="button" className="ygd-studio-btn-primary"
            disabled={!connected || !contentMatches(value) || value.dirty || value.busy || busy || !instances.saveChanges}
            onClick={openContentReview}>{text('Review proposed changes', '审阅修改建议')}</button>}
        </div>}
      </>} />
    </div>
  </main>
}

function EditorSnapshot({ value, onChange }: { value: Editor; onChange: (value: Editor) => void }) {
  useLayoutEffect(() => { onChange(value) }, [value.record, value.dirty, value.busy, value.previewBundle, value.proposalReplacement, onChange])
  return null
}

function AuthoringControls({ snapshot, zh, intent, setIntent, attempt, history, busy, connected, error, hasSave, saved, reviewing, canReopen, newerCandidate, begin, cancel, check, review }: {
  snapshot: Editor; zh: boolean; intent: string; setIntent: (value: string) => void
  attempt?: Attempt; history: ConversationEntry[]; busy: boolean; connected: boolean; error: string; hasSave: boolean; saved: boolean; reviewing: boolean; canReopen: boolean; newerCandidate: boolean
  begin: () => void; cancel: () => void; check: () => void; review: () => void
}) {
  const log = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null), followTail = useRef(true)
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [attempt?.request.invocationId])
  useLayoutEffect(() => {
    if (followTail.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [JSON.stringify(attempt?.observation?.conversation), attempt?.observation?.status])
  const t = (en: string, cn: string) => zh ? cn : en
  const record = snapshot.record, count = record?.files?.filter(file => file.editable).length ?? 0
  const unavailable = !connected ? t('The connection changed. Input is retained; reopen this working copy to reconnect.', '连接已变化，输入已保留；请重新打开此副本以连接。')
    : !record ? t('Opening the working copy…', '正在打开工作副本…')
    : record.kind === 'bundle' && !(snapshot.previewBundle ?? record.bundle ?? record.source.bundle) ? t('The Bundle definition is unavailable. Reopen this working copy.', '技能包定义不可用，请重新打开此副本。')
    : !hasSave ? t('This connection cannot save reviewed candidates.', '当前连接不支持保存审阅后的候选。')
    : count === 0 ? t('This copy has no editable source files.', '此副本没有可编辑的原始文件。') : ''
  const stale = !saved && !!attempt?.prepared && attempt.prepared.request.expectedRevision !== record?.revision
  const resume = !!attempt && !!attempt.reference && !attempt.uncertain && attempt.owned && !!attempt.observation?.terminal
    && attempt.observation.consumed && !attempt.observation.pendingInput && intent !== attempt.request.prompt
  const working = connected && !!attempt?.observation && !attempt.observation.terminal
    && (attempt.observation.status === 'running' || attempt.observation.status === 'queued')
  const stoppable = working && !!attempt?.reference && attempt.owned && !attempt.uncertain
  const needsCheck = connected && !!attempt && (attempt.uncertain || !attempt.observation || !attempt.owned)
  const status = !connected ? t('Connection changed; execution status is unverified.', '连接已变化，执行状态尚未核实。')
    : !attempt ? t('Describe a change to this copy. Suggestions are reviewed before saving.', '描述对此副本的修改意图，建议将在审阅后保存。')
    : attempt.uncertain ? t('The request outcome needs checking. No automatic resend will occur.', '这次请求的结果尚需核对，不会自动重发。')
    : ({ queued: t('Queued', '等待执行'), running: t('Working', '正在处理'), completed: t('Execution finished', '执行已结束'), cancelled: t('Execution cancelled', '执行已取消'), failed: t('Execution failed', '执行失败'), unknown: t('Outcome unknown', '结果未知') })[attempt.observation?.status ?? 'unknown']
  const pristineReview = reviewing && !!snapshot.proposalReplacement?.canReplace() && !stale
  const canContinue = !unavailable && !snapshot.busy && !busy && (!snapshot.dirty || pristineReview)
  const canSend = canContinue && !!intent.trim() && (!attempt || resume)
  const continueRepair = () => {
    // The submitted prompt remains in the conversation. Offer an actionable
    // follow-up without replacing text the user has already started composing.
    if (!intent.trim() || intent === attempt?.request.prompt) {
      const issues = attempt?.prepared?.candidate.diagnostics.map(item => item.message).join('\n')
      setIntent(t('Fix the issues in the current proposed changes. Preserve the original Skill method and resources, and submit the complete corrected proposal for review.',
        '请修复当前修改建议中的问题，保留原有 Skill 方法和资源，提交完整的修正建议供我审阅。') + (issues ? '\n\n' + issues : ''))
    }
    composer.current?.focus()
  }
  const entry = attempt ? conversationEntry(attempt, saved) : undefined
  const renderEntry = (value: ConversationEntry, current: boolean) => <div className="ygd-studio-conversation-turn" key={value.id}>
    <ConversationMessage row={{ id: value.id, role: 'user', label: t('You', '你'), text: value.prompt, status: 'completed' }} renderText={text => <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>} />
    {!!value.omitted && <p className="ygd-studio-conversation-note">{t('Showing recent activity.', '显示最近的工作记录。')}</p>}
    <ConversationMessages rows={value.nativeRows ?? []} active={current && working} terminal={!current || !!attempt?.observation?.terminal} locale={zh ? 'zh' : 'en'} />
    <div className="ygd-studio-conversation-message">
      <p role={current ? 'status' : undefined}>{current && working && <span className="companion-spinner" aria-hidden="true" />}{current ? status : value.uncertain ? t('Outcome needs checking.', '结果待核对。')
        : ({ queued: t('Queued', '等待执行'), running: t('Working', '正在处理'), completed: t('Execution finished', '执行已结束'), cancelled: t('Execution cancelled', '执行已取消'), failed: t('Execution failed', '执行失败'), unknown: t('Outcome unknown', '结果未知') })[value.status ?? 'unknown']}
        {value.saved ? t(' · Changes saved to the working copy.', ' · 修改已保存到工作副本。') : value.candidateValid ? t(' · Changes available for review; not saved.', ' · 修改可审阅，尚未保存。') : ''}</p>
      {value.candidateValid && value.candidateFiles !== undefined && <p className="ygd-studio-conversation-note">{t(`${value.candidateFiles} files changed. Review their effect in the content area.`, `涉及 ${value.candidateFiles} 个文件，可在右侧审阅修改效果。`)}</p>}
      {current && <>
        {newerCandidate && <p className="ygd-studio-conversation-note">{t('Newer proposed changes are available. Your current edits are retained; review the latest to replace them.', '有更新的修改建议。当前编辑已保留；选择审阅最新建议后可替换。')}</p>}
        <div className="ygd-studio-conversation-actions">
          {newerCandidate && <button type="button" className="ygd-studio-btn-primary" disabled={!connected || busy || snapshot.busy || !attempt?.owned || stale || !hasSave || !snapshot.proposalReplacement?.canDiscard()} onClick={review}>{t('Review latest changes', '审阅最新建议')}</button>}
          {canReopen && !reviewing && !newerCandidate && attempt?.prepared && !saved && <button type="button" className="ygd-studio-btn-primary" disabled={!connected || busy || reviewing || snapshot.dirty || snapshot.busy || !attempt.owned || stale || !hasSave} onClick={review}>{t('Review proposed changes', '审阅修改建议')}</button>}
          {needsCheck && !attempt?.error && <button type="button" className="ygd-studio-btn-secondary" disabled={busy} onClick={check}>{t('Check request status', '核对请求结果')}</button>}
        </div>
        {attempt?.observation?.terminal && !attempt.prepared && <p className="ygd-studio-conversation-note">{t('No changes are available for review.', '暂无可审阅的修改。')}</p>}
        {attempt?.error && <StudioFeedback feedbackId={`run:${value.id}:${attempt.error}`} tone="error" locale={zh ? 'zh' : 'en'}
          title={t('The request needs checking', '需要核对这次请求')} message={attempt.error}
          actions={connected ? [{ label: t('Check request status', '核对请求结果'), onClick: check, disabled: busy }] : undefined} />}
        {!attempt?.error && !attempt?.uncertain && attempt?.observation?.terminal && !saved && (!attempt.prepared || !attempt.prepared.candidate.valid) && <StudioFeedback
          feedbackId={`repair:${value.id}:${attempt.prepared?.candidate.digest ?? 'none'}`} tone="error" locale={zh ? 'zh' : 'en'}
          title={attempt.prepared ? t('Changes need repair before saving', '修改仍需完善后才能保存') : t('Execution ended without a candidate', '执行结束，尚无候选')}
          message={t('Your input and available changes are retained. Describe the repair below and send it to continue this conversation.', '输入和已有修改均已保留。在下方描述修复诉求并发送，即可继续本次对话。')}
          details={attempt.prepared?.candidate.diagnostics.map(item => ({ message: item.message }))}
          actions={[{ label: t('Continue repair', '继续修复'), disabled: !canContinue || !attempt.reference || !attempt.owned || !attempt.observation.consumed || attempt.observation.pendingInput,
            onClick: continueRepair }]} />}

      </>}
    </div>
  </div>
  return <section className="ygd-studio-conversation" aria-label={t('AI changes', '智能修改')}>
    <header className="ygd-studio-conversation-header"><h2>{t('Conversation', '对话')}</h2><p>{t('Describe your intent and review the result alongside it.', '表达修改诉求，对照右侧内容逐步完善。')}</p></header>
    <div ref={log} className="ygd-studio-conversation-log" onScroll={event => { const el = event.currentTarget; followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32 }} role="log" aria-live="off" aria-label={t('Requests in this editor', '本次编辑中的对话')}>
      {!entry && <div className="ygd-studio-conversation-welcome"><strong>{record?.kind === 'kit'
        ? t('What would make this Kit work better for you?', '你希望怎样调整这个设计套件？')
        : t('What would make this Bundle work better for you?', '你希望怎样调整这个技能包？')}</strong><p>{record?.kind === 'kit'
        ? t('Describe its purpose, design method or Bundle selection. Changes will be proposed for review before saving.', '可以描述套件用途、设计方法或技能包选择。修改会先供你审阅，确认后再保存。')
        : t('Describe its method, fields or Panel. Changes will be proposed for review before saving.', '可以描述设计方法、字段或面板的调整。修改会先供你审阅，确认后再保存。')}</p></div>}
      {history.map(value => renderEntry(value, false))}
      {entry && renderEntry(entry, true)}
    </div>
    <form className="ygd-studio-conversation-composer" onSubmit={event => { event.preventDefault(); if (canSend) begin() }}>
      {reviewing && <p className="ygd-studio-conversation-note">{pristineReview
        ? t('Review the changes on the right. When execution ends, send a new intent to refine them.', '在右侧审阅修改；执行结束后，可发送新诉求继续完善。')
        : t('Your source edits are retained. Save them or revert them before asking AI to replace the proposal.', '原始文件编辑已保留；保存或还原人工修改后，可请求 AI 更新建议。')}</p>}
      {unavailable && <StudioFeedback feedbackId={`connection:${unavailable}`} tone="info" dismissible={false} locale={zh ? 'zh' : 'en'} title={!connected ? t('Connection changed; reopen this working copy to reconnect.', '连接已变化，请重新打开此副本以连接。') : t('AI connection unavailable', 'AI 连接暂不可用')} message={unavailable} />}
      {!reviewing && (snapshot.dirty || snapshot.busy) && <p className="ygd-studio-conversation-note">{t('Save or discard source edits before requesting or reviewing changes.', '请先保存或放弃原始文件编辑，再请求或审阅修改。')}</p>}
      {stale && <p className="ygd-studio-conversation-note">{t('The source has changed since this candidate. Reopen to verify the saved source, or explicitly continue with a new intent.', '此候选生成后原始文件已变化。请重新打开核对已保存内容，或明确用新意图继续。')}</p>}
      {error && <StudioFeedback feedbackId={`dispatch:${error}`} tone="error" locale={zh ? 'zh' : 'en'} title={t('Request could not be sent', '未能发送请求')} message={error} />}
      <label className="ygd-studio-field"><span>{t('What would you like to change?', '你希望修改什么？')}</span>
        <textarea ref={composer} className="ygd-studio-text-input ygd-studio-textarea" rows={3} value={intent} placeholder={t('Describe a change…', '描述希望如何修改…')} onChange={event => setIntent(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) begin() } }} />
      </label>
      <div className="ygd-studio-conversation-send"><span className="ygd-studio-conversation-note">{t('Ctrl / ⌘ + Enter to send', 'Ctrl / ⌘ + Enter 发送')}</span>{stoppable
        ? <button type="button" className="ygd-studio-btn-primary" disabled={busy} onClick={cancel}>{t('Stop', '停止')}</button>
        : <button type="submit" className="ygd-studio-btn-primary" disabled={!canSend}>{t('Send', '发送')}</button>}</div>
    </form>
  </section>
}
