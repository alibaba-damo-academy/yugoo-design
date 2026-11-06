/** Conversation presentation over the existing native observer and Studio ports. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Conversation, type RecordedConversation } from './conversation.tsx'
import { InstanceWorkbench, type InstanceWorkbenchProps, type StudioInstance } from '../../studio-ui/src/InstanceWorkbench.tsx'
import { type StudioPreparedSourceChanges } from '../../studio-ui/src/source-candidate-state.ts'
import type { StudioObjectAuthoringContext } from '../../studio-ui/src/StudioWorkspace.tsx'
import { StudioSelect } from '../../studio-ui/src/StudioSelect.tsx'
import { StudioFeedback } from '../../studio-ui/src/StudioFeedback.tsx'
import { StudioEntryFeedback } from './studio-feedback.tsx'
import { subscribeLivePoll, requestLivePoll } from '../../panel/src/client/live-poll.ts'
import { createStudioConversationClient, studioConversationTarget, studioConversationScopeMatches, studioCandidateForReview, type StudioConversationBinding, type StudioConversationTarget } from './studio-conversation.mjs'
import { requireNotificationAccepted } from './notification-result.mjs'
import { companionChromeText, companionChromeMessages, type CompanionChromeKey } from './locale.ts'

type Scope = Parameters<NonNullable<InstanceWorkbenchProps['renderSupplement']>>[0]
type Authoring = StudioObjectAuthoringContext & { epoch: number }
type ConnectionStatus = 'available' | 'unavailable' | 'unknown'
type RenderWorkbench = (props: InstanceWorkbenchProps) => ReactNode
type RenderContent = (content: ReactNode, context: StudioObjectAuthoringContext) => ReactNode
type RequestLocator = { requestId: string; studio: StudioConversationTarget }
type CandidateChoice = RequestLocator & { digest: string; changedFiles: string[] }
const samePin = (a?: { name: string; version: string }, b?: { name: string; version: string }) => a?.name === b?.name && a?.version === b?.version
const reviewIdentity = (prepared?: StudioPreparedSourceChanges) => prepared
  ? JSON.stringify([prepared.request.id, prepared.request.expectedRevision, prepared.candidate.digest]) : undefined

function BoundInstanceWorkbench({ workbench, prepared, locator, transport, rpc, onSaved, onLeave }: {
  workbench: InstanceWorkbenchProps; prepared?: StudioPreparedSourceChanges; locator?: RequestLocator
  transport: ReturnType<typeof createStudioConversationClient>; rpc: (method: string, params?: {}) => Promise<any>
  onSaved: (record: StudioInstance) => void; onLeave: (identity: string) => void
}) {
  const currentLocale = useRef(workbench.locale); currentLocale.current = workbench.locale
  const text = (key: CompanionChromeKey) => companionChromeText(key, currentLocale.current)
  const identity = reviewIdentity(prepared)
  const leave = useRef(onLeave); leave.current = onLeave
  useLayoutEffect(() => identity ? () => leave.current(identity) : undefined, [identity])
  const client = useMemo(() => ({
    read: async (input: { id: string }) => { await transport.connect(); return workbench.client.read(input) },
    readFile: async (input: { id: string; path: string }) => { await transport.connect(); return workbench.client.readFile(input) },
    saveChanges: async (input: Parameters<NonNullable<typeof workbench.client.saveChanges>>[0]) => {
      if (!locator) throw Error(text('studioProposalNotSelected'))
      await transport.connect()
      const current = await rpc('studioAuthoringCandidateRead', locator)
      if (current.requestId !== locator.requestId || JSON.stringify(current.studio) !== JSON.stringify(locator.studio)
        || !current.prepared || input.id !== locator.studio.id
        || input.expectedRevision !== locator.studio.expectedRevision) throw Error(text('studioProposalConnectionChanged'))
      if (current.prepared.candidate.digest !== input.digest) {
        // A human may refine the proposal in the same editor. Verify that exact
        // replacement through S2 again; never save the old proposal's digest or
        // turn the original native locator into authority for another target.
        if (!workbench.client.prepareChanges || JSON.stringify(input.bundle ?? null) !== JSON.stringify(current.prepared.request.bundle ?? null)) throw Error(text('studioPreviewScopeChanged'))
        const { mode: _mode, digest, ...request } = input
        const checked = await workbench.client.prepareChanges(request)
        if (checked.id !== input.id || checked.baseRevision !== input.expectedRevision || checked.digest !== digest || !checked.valid) throw Error(text('studioDraftDoesNotMatch'))
        await transport.connect()
      }
      if (!workbench.client.saveChanges) throw Error(text('studioSavingUnavailable'))
      return workbench.client.saveChanges(input)
    },
  }), [workbench.client, transport, rpc, locator])
  // The same component and DOM workplane live through proposal, save and reopen.
  return <InstanceWorkbench {...workbench} sourceChanges={prepared && locator ? {
    prepared, client, onDismiss: () => { if (identity) onLeave(identity) }, onSaved,
  } : undefined} onChanged={record => {
    if (identity) onLeave(identity)
    workbench.onChanged(record)
  }} />
}

function ObserveScope({ scope, observe }: { scope: Scope; observe: (scope?: Scope) => void }) {
  useLayoutEffect(() => { observe(scope) }, [scope.record, scope.dirty, scope.busy, scope.previewBundle?.name, scope.previewBundle?.version, scope.currentFile, scope.intent, observe])
  useLayoutEffect(() => () => observe(undefined), [observe])
  return null
}

function ObserveAuthoring({ context, observe, children }: { context: StudioObjectAuthoringContext; observe: (context?: StudioObjectAuthoringContext) => void; children: ReactNode }) {
  const current = useRef(context); current.current = context
  useLayoutEffect(() => {
    observe({ id: context.id, intent: context.intent, onDirtyChange: dirty => current.current.onDirtyChange(dirty) })
    return () => observe(undefined)
  }, [context.id, context.intent, observe])
  return children
}

export function StudioConversationLayout({ rpc, readConversation, checkConnection, presentation = 'conversation', initialRequest, children, locale = 'zh' }: {
  rpc: (method: string, params?: {}) => Promise<any>
  readConversation: () => Promise<{ conversation: RecordedConversation }>
  /** Existing bounded, non-generating host probe. Never sends a test message. */
  checkConnection?: () => Promise<ConnectionStatus>
  presentation?: 'conversation' | 'content-only'
  locale?: 'zh' | 'en'
  initialRequest?: RequestLocator
  children: (render: RenderWorkbench, initialInstance?: { id: string; expectedRevision: number; bundle?: { name: string; version: string } }, renderContent?: RenderContent) => ReactNode
}) {
  const currentLocale = useRef(locale); currentLocale.current = locale
  const t = (key: CompanionChromeKey, values?: Record<string, string | number>) => companionChromeText(key, currentLocale.current, values)
  const manualFallback = t('studioManualFallback')
  const contentOnly = presentation === 'content-only'
  const [entry] = useState(initialRequest)
  const [entryReady, setEntryReady] = useState(!entry)
  const [authoring, setAuthoring] = useState<Authoring>()
  const owner = useRef<Authoring>()
  const historyBoundary = useRef<{ owner: Authoring; ids: Set<string>; last?: string }>()
  const epoch = useRef(0)
  const entryConsumed = useRef(false)
  const [historyStatus, setHistoryStatus] = useState<'reading' | 'unavailable' | 'catching-up' | 'ready'>(contentOnly ? 'ready' : 'reading')
  const historyUsable = useRef(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | 'checking'>('checking')
  const readiness = useRef<{ owner?: Authoring; status: ConnectionStatus | 'checking' }>({ status: 'checking' })
  const connectionCheck = useRef(checkConnection); connectionCheck.current = checkConnection
  const [checkVersion, setCheckVersion] = useState(0)
  const [binding, setBinding] = useState<StudioConversationBinding>()
  const [conversation, setConversation] = useState<RecordedConversation>()
  historyUsable.current = historyStatus === 'ready'
  const [scope, setScope] = useState<Scope>()
  const [visible, setVisible] = useState(true)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'success' | 'info' | 'error'>('info')
  const [sendFailureTitle, setSendFailureTitle] = useState<CompanionChromeKey>('studioRequestFailed')
  const [draft, setDraft] = useState('')
  const [request, setRequest] = useState<RequestLocator>()
  const [prepared, setPrepared] = useState<StudioPreparedSourceChanges>()
  const [review, setReview] = useState<StudioPreparedSourceChanges>()
  const [reviewRequest, setReviewRequest] = useState<RequestLocator>()
  const [choices, setChoices] = useState<CandidateChoice[]>([])
  const [loadingCandidate, setLoadingCandidate] = useState(false)
  const shownCandidates = useRef(new Set<string>())
  const attemptedCandidates = useRef(new Set<string>())
  const candidateKey = (locator: RequestLocator, value: StudioPreparedSourceChanges) => JSON.stringify([locator.requestId, locator.studio, value.candidate.digest])
  const reviewOwner = useRef(review); reviewOwner.current = review
  const releaseReview = useCallback((identity: string) => {
    if (reviewIdentity(reviewOwner.current) !== identity) return
    reviewOwner.current = undefined
    setReview(undefined); setReviewRequest(undefined)
  }, [])
  const [candidateError, setCandidateError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const current = useRef(scope); current.current = scope
  const observe = useCallback((next?: Scope) => { current.current = next; setScope(next) }, [])
  const observeAuthoring = useCallback((context?: StudioObjectAuthoringContext) => {
    const next = context ? { ...context, epoch: ++epoch.current } : undefined
    owner.current?.onDirtyChange(false)
    owner.current = next
    historyBoundary.current = undefined
    historyUsable.current = false
    readiness.current = { owner: next, status: 'checking' }; setConnectionStatus('checking')
    setAuthoring(next); setBinding(undefined); setConversation(undefined); setHistoryStatus(contentOnly ? 'ready' : 'reading')
    setVisible(true); setDraft(''); setError(''); setNotice(''); setNoticeTone('info'); setUncertain(false)
    setPrepared(undefined); setReview(undefined); setReviewRequest(undefined); reviewOwner.current = undefined
    setChoices([]); setLoadingCandidate(false); setCandidateError('')
    shownCandidates.current.clear(); attemptedCandidates.current.clear()
    if (next && entry && !entryConsumed.current && entry.studio.id === next.id) {
      entryConsumed.current = true; setRequest(entry)
    } else setRequest(undefined)
  }, [contentOnly, entry])
  const live = () => !!authoring && owner.current === authoring
  const recheckConnection = () => {
    if (!live() || readiness.current.status === 'checking') return
    readiness.current = { owner: authoring, status: 'checking' }; setConnectionStatus('checking')
    setCheckVersion(value => value + 1)
  }
  useEffect(() => {
    if (!authoring || contentOnly) return
    let disposed = false
    readiness.current = { owner: authoring, status: 'checking' }; setConnectionStatus('checking')
    void (async () => {
      let next: ConnectionStatus
      try {
        const value = await connectionCheck.current?.()
        next = value === 'available' || value === 'unavailable' ? value : 'unknown'
      } catch { next = 'unavailable' }
      if (disposed || owner.current !== authoring) return
      readiness.current = { owner: authoring, status: next }; setConnectionStatus(next)
      requestLivePoll()
    })()
    return () => { disposed = true }
  }, [authoring, contentOnly, checkVersion])
  const boundRpc = useMemo(() => async (method: string, params?: {}) => {
      if (!authoring || owner.current !== authoring) throw Error(t('studioAuthoringClosed'))
      const result = await rpc(method, params)
      if (owner.current !== authoring) throw Error(t('studioAuthoringClosed'))
      return result
  }, [rpc, authoring])
  const transport = useMemo(() => createStudioConversationClient({
    rpc: boundRpc, requestId: () => crypto.randomUUID(),
    onRequest: (requestId, studio) => {
      if (owner.current !== authoring) return
      setRequest({ requestId, studio }); setPrepared(undefined); setCandidateError('')
    },
  }), [boundRpc, authoring])

  // An exact content handoff must validate its native binding before mounting source.
  useEffect(() => {
    if (!entry || entryReady) return
    let disposed = false
    setError('')
    const client = createStudioConversationClient({ rpc, requestId: () => crypto.randomUUID() })
    void client.connect().then(bound => {
      if (entry.studio.bindingId !== bound.bindingId || entry.studio.threadId !== bound.threadId) throw Error('Candidate belongs to a different connection.')
      if (!disposed) { setError(''); setEntryReady(true) }
    }).catch(() => { if (!disposed) setError(t('studioEntryConnectionUnavailable')) })
    return () => { disposed = true }
  }, [entry, entryReady, rpc, checkVersion])

  useEffect(() => {
    if (!authoring) return
    let disposed = false, busy = false
    const read = async () => {
      if (disposed || busy || owner.current !== authoring) return
      busy = true
      let bindingChecked = false
      try {
        const bound = await transport.connect()
        bindingChecked = true
        if (disposed || owner.current !== authoring) return
        const next = contentOnly ? undefined : (await readConversation()).conversation
        if (next?.threadId && next.threadId !== bound.threadId) throw Error(t('studioConversationChanged'))
        if (disposed || owner.current !== authoring) return
        let interval = next
        if (next) {
          if (!historyBoundary.current && next.available && !next.catchingUp) {
            historyBoundary.current = { owner: authoring, ids: new Set(next.rows.map(row => row.id)), last: next.rows.at(-1)?.id }
          }
          const boundary = historyBoundary.current?.owner === authoring ? historyBoundary.current : undefined
          const last = boundary?.last ? next.rows.findIndex(row => row.id === boundary.last) : -1
          const rows = !boundary ? [] : last >= 0 ? next.rows.slice(last + 1) : next.rows.filter(row => !boundary.ids.has(row.id))
          interval = { ...next, rows, omitted: 0, designSessionStartedAt: undefined,
            ...(rows.length === 0 ? { recordedStatus: 'unknown', backgroundActivity: false, catchingUp: false } : {}) }
        }
        if (next) setHistoryStatus(!next.available ? 'unavailable' : next.catchingUp ? 'catching-up' : 'ready')
        setBinding(bound); setConversation(interval); setError('')
      } catch (failure) {
        if (!disposed && owner.current === authoring) setError((failure as { code?: string })?.code === 'STUDIO_BINDING_CHANGED'
          ? t('studioBindingChangedWithDraft')
          : bindingChecked ? t('studioHistoryUnavailableWithDraft')
          : t('studioBindingUnavailableWithDraft'))
      } finally { busy = false }
    }
    void read()
    const unsubscribe = subscribeLivePoll(() => { void read() })
    return () => { disposed = true; unsubscribe() }
  }, [authoring, transport, readConversation, contentOnly])
  useEffect(() => { authoring?.onDirtyChange(!!draft.trim()) }, [authoring, draft])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (draft.trim()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [draft])
  const requestMatchesScope = !request || studioConversationScopeMatches(scope, request.studio)
  useEffect(() => {
    if (!authoring || !request || review || !scope?.record) return
    if (!requestMatchesScope) { setPrepared(undefined); setCandidateError(t('studioRequestScopeChanged')); return }
    let disposed = false, busy = false
    const read = async () => {
      if (disposed || busy || owner.current !== authoring) return
      busy = true
      try {
        const value = await rpc('studioAuthoringCandidateRead', request)
        if (value.requestId !== request.requestId || JSON.stringify(value.studio) !== JSON.stringify(request.studio)) throw Error(t('studioProposalWrongRequest'))
        if (value.prepared && (value.prepared.request.id !== request.studio.id || value.prepared.request.expectedRevision !== request.studio.expectedRevision
          || value.prepared.candidate.id !== request.studio.id || value.prepared.candidate.baseRevision !== request.studio.expectedRevision
          || !/^[a-f0-9]{64}$/.test(value.prepared.candidate.digest))) throw Error(t('studioProposalWrongCopy'))
        if (!disposed && owner.current === authoring) { setPrepared(value.prepared ?? undefined); setCandidateError('') }
      } catch (failure) { if (!disposed && owner.current === authoring) setCandidateError(failure instanceof Error ? failure.message : String(failure)) }
      finally { busy = false }
    }
    void read()
    const unsubscribe = subscribeLivePoll(() => { void read() })
    return () => { disposed = true; unsubscribe() }
  }, [authoring, request, rpc, review, requestMatchesScope, scope?.record])

  const selectedTarget = useMemo(() => authoring && binding && scope?.record?.id === authoring.id ? studioConversationTarget({
    bindingId: binding.bindingId, threadId: binding.threadId, id: scope.record.id, expectedRevision: scope.record.revision,
    ...(scope.previewBundle ? { bundle: scope.previewBundle } : {}),
  }) : undefined, [authoring, binding?.bindingId, binding?.threadId, scope?.record?.id, scope?.record?.revision, scope?.previewBundle?.name, scope?.previewBundle?.version])
  useEffect(() => {
    setChoices([])
    if (!authoring || !selectedTarget || review || error) return
    let disposed = false, busy = false
    const read = async () => {
      if (disposed || busy || owner.current !== authoring) return
      busy = true
      try {
        await transport.connect()
        if (disposed || owner.current !== authoring) return
        const value = await rpc('studioAuthoringCandidateList', { studio: selectedTarget })
        if (!Array.isArray(value.candidates) || value.candidates.length > 16) throw Error(t('studioProposalListUnavailable'))
        const candidates = value.candidates.map((choice: CandidateChoice) => {
          const studio = studioConversationTarget(choice.studio)
          if (!/^[\w.-]{1,128}$/.test(choice.requestId) || !/^[a-f0-9]{64}$/.test(choice.digest)
            || JSON.stringify(studio) !== JSON.stringify(selectedTarget) || !Array.isArray(choice.changedFiles)
            || choice.changedFiles.some(path => typeof path !== 'string')) throw Error(t('studioProposalOutsideCopy'))
          return { requestId: choice.requestId, studio, digest: choice.digest, changedFiles: choice.changedFiles }
        })
        if (!disposed && owner.current === authoring) setChoices(candidates)
      } catch (failure) { if (!disposed && owner.current === authoring) { setChoices([]); setCandidateError(failure instanceof Error ? failure.message : String(failure)) } }
      finally { busy = false }
    }
    void read()
    const unsubscribe = subscribeLivePoll(() => { void read() })
    return () => { disposed = true; unsubscribe() }
  }, [authoring, selectedTarget, review, rpc, transport, error])
  const openChoice = async (choice: CandidateChoice) => {
    if (!live() || loadingCandidate) return
    setLoadingCandidate(true); setCandidateError('')
    try {
      await transport.connect()
      if (!live()) return
      const locator = { requestId: choice.requestId, studio: choice.studio }
      const value = await rpc('studioAuthoringCandidateRead', locator)
      if (value.requestId !== locator.requestId || JSON.stringify(value.studio) !== JSON.stringify(locator.studio)
        || value.prepared?.candidate.digest !== choice.digest) throw Error(t('studioProposalChanged'))
      if (!live() || reviewOwner.current) return
      const candidate = studioCandidateForReview(current.current, locator, value.prepared)
      shownCandidates.current.add(candidateKey(locator, candidate))
      setRequest(locator); setPrepared(candidate); setReviewRequest(locator); setReview(candidate)
    } catch (failure) { if (live()) setCandidateError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (live()) setLoadingCandidate(false) }
  }

  // An exact current request is already the user's selection. Show its result in
  // the content area once, without a second review gate or an implicit save.
  useEffect(() => {
    if (!request || !prepared || review || error || !scope?.record || scope.dirty || scope.busy) return
    const key = candidateKey(request, prepared)
    if (shownCandidates.current.has(key)) return
    try {
      const value = studioCandidateForReview(current.current, request, prepared)
      shownCandidates.current.add(key)
      setReviewRequest(request); setReview(value)
    } catch { /* A changed selection remains in its existing editor. */ }
  }, [request, prepared, review, error, scope])

  useEffect(() => {
    if (review || error || loadingCandidate || !scope?.record || scope.dirty || scope.busy) return
    const unshown = choices.filter(choice => !shownCandidates.current.has(JSON.stringify([choice.requestId, choice.studio, choice.digest])))
    if (choices.length !== 1 || unshown.length !== 1) return
    const choice = unshown[0]!, key = JSON.stringify([choice.requestId, choice.studio, choice.digest])
    if (attemptedCandidates.current.has(key)) return
    attemptedCandidates.current.add(key)
    void openChoice(choice)
  }, [choices, review, error, loadingCandidate, scope])

  const hostLabel = ({ codex: 'Codex', 'claude-code': 'Claude Code', qoder: 'Qoder', qwenwork: 'QwenWork', workbuddy: 'WorkBuddy' } as Record<string, string>)[binding?.host ?? ''] ?? t('nativeAgent')
  const connectionReason = connectionStatus === 'checking' ? t('studioConnectionChecking')
    : connectionStatus === 'unavailable' ? t('studioConnectionUnavailable')
    : connectionStatus === 'unknown' ? t('studioConnectionUnknown') : undefined
  const historyReason = historyStatus === 'unavailable' ? t('studioHistoryUnavailable')
    : historyStatus !== 'ready' ? t('studioHistorySyncing') : undefined
  const fallbackReason = error || connectionReason || historyReason
  const disabled = !authoring ? t('studioAuthoringNotOpen') : error
    || (uncertain ? t('studioDeliveryPending') : undefined)
    || (review ? t('studioSaveProposalFirst') : undefined)
    || connectionReason || (!binding ? t('studioBindingChecking') : undefined) || historyReason
    || (!scope?.record ? t('studioOpenCopyFirst')
      : scope.dirty ? t('studioSaveSourceFirst') : scope.busy ? t('studioWorkingCopyBusy') : undefined)
  const send = async (text: string) => {
    const selected = current.current
    if (!live() || disabled || !selected?.record || selected.record.id !== authoring?.id || selected.dirty || selected.busy) throw Error(disabled || t('studioWorkingCopyUnavailable'))
    let dispatched = false
    const beforeSend = () => {
      const next = current.current
      if (!live() || !next?.record || next.dirty || next.busy || next.record.id !== selected.record!.id
        || next.record.revision !== selected.record!.revision || !samePin(next.previewBundle, selected.previewBundle)
        || next.currentFile !== selected.currentFile || next.intent !== selected.intent) throw Error(t('studioTargetChangedBeforeSend'))
      if (readiness.current.owner !== authoring || readiness.current.status !== 'available' || !historyUsable.current) throw Error(t('studioConnectionNotReady'))
      dispatched = true
    }
    setNoticeTone('info'); setNotice(t('studioSending'))
    try {
      const result = await transport.send({ text, id: selected.record.id, expectedRevision: selected.record.revision, bundle: selected.previewBundle,
        context: { intent: selected.intent ?? authoring.intent, ...(selected.currentFile ? { currentFile: selected.currentFile } : {}) }, beforeSend })
      if (!live()) return
      if (result.threadId && result.threadId !== binding?.threadId) throw Error(t('studioReceiptWrongConversation'))
      if (result.status === 'unknown') throw Object.assign(Error(t('studioDeliveryUnknown')), { delivery: 'unknown' })
      if (current.current?.record?.id !== selected.record.id || current.current?.record?.revision !== selected.record.revision
        || !samePin(current.current?.previewBundle, selected.previewBundle)) throw Error(t('studioSentToPreviousCopy'))
      try { setNotice(requireNotificationAccepted(result, hostLabel, companionChromeMessages(currentLocale.current))) }
      catch (failure) {
        if ((result as { notSubmitted?: boolean }).notSubmitted === true) Object.assign(failure as object, { notSubmitted: true })
        throw failure
      }
      requestLivePoll()
    } catch (failure) {
      if (!live()) return
      const receipt = failure as { delivery?: string; notSubmitted?: boolean }
      const notSubmitted = receipt?.notSubmitted === true && receipt.delivery !== 'unknown'
      setUncertain(dispatched && !notSubmitted)
      if (notSubmitted) {
        readiness.current = { owner: authoring, status: 'unavailable' }; setConnectionStatus('unavailable')
        setRequest(undefined); setPrepared(undefined)
      }
      setNoticeTone('error'); setSendFailureTitle(dispatched && !notSubmitted ? 'studioDeliveryUnconfirmedTitle' : 'studioNotSubmittedTitle')
      setNotice(`${notSubmitted ? t('studioNotSubmittedPrefix') : ''}${failure instanceof Error ? failure.message : String(failure)}`)
      throw failure
    }
  }
  const otherChoices = choices.filter(choice => !shownCandidates.current.has(JSON.stringify([choice.requestId, choice.studio, choice.digest])))
  const retryCandidates = () => {
    if (!live() || !requestMatchesScope) return
    attemptedCandidates.current.clear()
    setError(''); setCandidateError(''); requestLivePoll()
  }
  const render: RenderWorkbench = props => <BoundInstanceWorkbench workbench={{ ...props, initialView: 'files', renderSupplement: state => <>
    {props.renderSupplement?.(state)}<ObserveScope scope={state} observe={observe} />
    {choices.length > 1 && otherChoices.length > 0 && <div className="ygd-studio-doc-toolbar">
      {!review && choices.length > 1 && otherChoices.length > 0 && <StudioSelect value="" aria-label={t('studioProposalVersion')}
        disabled={loadingCandidate || !!error || scope?.dirty || scope?.busy}
        options={[{ value: '', label: t('studioSelectProposal', { count: otherChoices.length }) }, ...otherChoices.map((choice, index) => ({
          value: choice.requestId, label: t(choice.changedFiles.length === 1 ? 'studioProposalOneFile' : 'studioProposalManyFiles', { number: index + 1, file: choice.changedFiles[0]?.split('/').pop() ?? t('studioSourceFiles'), count: choice.changedFiles.length }),
        }))]} onValueChange={id => { const choice = otherChoices.find(item => item.requestId === id); if (choice) void openChoice(choice) }} />}
    </div>}
    {contentOnly && (error || candidateError || notice) && <StudioFeedback feedbackId={`studio-content:${props.id}:${error || candidateError || notice}`} tone={error || candidateError ? 'error' : noticeTone} autoOpen={false} locale={locale}
      title={error || candidateError ? t('studioProposalReadFailed') : noticeTone === 'error' ? t(sendFailureTitle) : notice} message={error || candidateError ? t('studioProposalInputsKept') : undefined}
      details={error || candidateError || noticeTone === 'error' ? [{ message: error || candidateError || notice }] : undefined}
      actions={(error || candidateError) && requestMatchesScope ? [{ label: t('studioRereadProposals'), onClick: retryCandidates }] : undefined} />}
  </> }} prepared={review && props.id === review.request.id ? review : undefined} locator={reviewRequest} transport={transport} rpc={boundRpc}
    onSaved={record => {
      if (!live()) return
      reviewOwner.current = undefined; setReview(undefined); setReviewRequest(undefined)
      setRequest(undefined); setPrepared(undefined); setNoticeTone('success'); setNotice(t('studioChangesSaved')); props.onChanged(record)
    }} onLeave={releaseReview} />
  const renderContent: RenderContent = (content, context) => <ObserveAuthoring context={context} observe={observeAuthoring}><div className="companion-studio-workspace-content" data-presentation={presentation}>
    {!contentOnly && !visible && <button type="button" className="ygd-studio-btn-secondary" onClick={() => setVisible(true)}>{t('studioExpandConversation')}</button>}
    {!contentOnly &&
    <Conversation locale={locale} key={`${context.id}:${authoring?.epoch ?? 0}`} hostLabel={hostLabel} value={error && conversation ? { ...conversation, available: false, recordedStatus: 'unknown', error } : conversation}
      initialDraft={context.initialPrompt} thread={binding?.threadId} visible={visible} onClose={() => setVisible(false)} send={send}
      onDraftChange={setDraft} composerDisabledReason={disabled} showDesignShortcut={false}
      renderError={(message, source) => source === 'history' || noticeTone === 'error' ? null : <StudioFeedback
        feedbackId={`studio-send:${context.id}:${message}`} tone="error" autoOpen={false} locale={locale} title={t('studioRequestFailed')}
        message={t('studioSendFailureHelp')} details={[{ message }]}
        actions={[{ label: t('studioCheckConnection'), onClick: recheckConnection, disabled: connectionStatus === 'checking' }]} />}
      beforeComposer={<div className="companion-studio-context">
        {scope?.record && <p>{t('studioCurrentCopy', { title: scope.record.title[locale], kind: scope.record.kind === 'kit' ? 'Kit' : 'Bundle' })}</p>}
        {scope?.currentFile && <p>{t('studioCurrentFile', { file: scope.currentFile })}</p>}
        <p>{t('studioConversationScope')}</p>
        {fallbackReason && <StudioFeedback feedbackId={`studio-connection:${context.id}:${fallbackReason}`} tone={error || connectionStatus === 'unavailable' || historyStatus === 'unavailable' ? 'error' : 'info'} autoOpen={false} locale={locale}
          title={fallbackReason} details={conversation?.error ? [{ message: conversation.error }] : undefined} actions={[{ label: t('studioCheckConnection'), onClick: recheckConnection, disabled: connectionStatus === 'checking' }]} />}
        {fallbackReason && <p>{manualFallback}</p>}
        {!fallbackReason && <button type="button" className="ygd-studio-btn-secondary" disabled={connectionStatus === 'checking'} onClick={recheckConnection}>{t('studioCheckConnection')}</button>}
        {notice && <StudioFeedback feedbackId={`studio-notice:${context.id}:${notice}`} tone={noticeTone} autoOpen={false} locale={locale}
          title={noticeTone === 'error' ? t(sendFailureTitle) : notice} details={noticeTone === 'error' ? [{ message: notice }] : undefined}
          message={noticeTone === 'error' ? t('studioDeliveryFailureHelp') : undefined} />}
        {candidateError && <StudioFeedback feedbackId={`studio-candidate:${context.id}:${candidateError}`} tone="error" autoOpen={false} locale={locale} title={t('studioProposalReadFailed')}
          message={t('studioProposalFailureHelp')} details={[{ message: candidateError }]}
          actions={requestMatchesScope ? [{ label: t('studioRereadProposals'), onClick: retryCandidates }] : undefined} />}
        {uncertain && <button type="button" className="ygd-studio-btn-secondary" onClick={() => setUncertain(false)}>{t('studioCheckedConversation')}</button>}
      </div>} />}
    <div className="companion-studio-content">{content}</div>
  </div></ObserveAuthoring>
  return <div className="dsh-design-root companion-studio-conversation-layout">
    <style>{`.companion-studio-conversation-layout{display:flex;height:100%;min-height:0;min-width:0}.companion-studio-conversation-layout>.ygd-studio-workspace{flex:1;min-height:0}.companion-studio-workspace-content{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}.companion-studio-workspace-content>.companion-conversation{width:clamp(300px,32vw,520px);flex-shrink:0;border-right:1px solid var(--ds-border)}.companion-studio-content{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}.companion-studio-context{padding:8px 16px;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.companion-studio-context p{margin:4px 0}@media(max-width:900px){.companion-studio-workspace-content[data-presentation=conversation]{flex-direction:column;overflow:auto}.companion-studio-workspace-content>.companion-conversation{width:100%;height:45%;min-height:250px}.companion-studio-workspace-content[data-presentation=conversation] .companion-studio-content{min-height:400px}}`}</style>
    {entryReady ? children(render, entry?.studio, renderContent) : <StudioEntryFeedback locale={locale} error={error} onRetry={() => setCheckVersion(value => value + 1)} onOpenCatalog={() => window.location.assign('?view=studio')} />}
  </div>
}
