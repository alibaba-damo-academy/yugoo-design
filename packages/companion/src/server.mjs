import {createWorkBuddyChildTranscript,verifyWorkBuddyChild} from './workbuddy-native.mjs'
import {createNativeBackgroundAdapter} from './native-background-adapter.mjs'
import {createCodexDesktopExecutionAdapter} from './codex-desktop-execution.mjs'
import {createCompanionMainContext} from './main-context.mjs'
import {derivedServicesStatus} from './derived-services-status.mjs'
import {nativeCapabilityStatus} from './native-capability-status.mjs'
import {createWorkBuddyTranscript, readWorkBuddyHeader} from './workbuddy-transcript.mjs'
import { createQwenWorkPanelConnection, resolveQwenWorkInputMode } from './qwenwork-desktop-input.mjs'
import { createQwenWorkTranscript, verifyQwenWorkChild } from './qwenwork-transcript.mjs'
import { createServer } from 'node:http'
import { staticAssetRequest } from './static-asset-request.mjs'
import { resolveBrowserAccess, resolveBrowserDefaultView, browserMethods, browserRequestAllowed } from './browser-access.mjs'
import { loadPackagedCssAssets } from '../../../scripts/css-asset-manifest.mjs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openCompanionProject } from './project.mjs'
import { finishWithAutoPanel } from './auto-panel-completion.mjs'
import { createCodexConnection } from './codex-connection.mjs'
import { createCodexDesktopRelay } from './codex-desktop-relay.mjs'
import { notificationErrorResponse } from './notification-delivery.mjs'
import { createCodexTranscript } from './codex-transcript.mjs'
import { createDesignConversationObserver } from './conversation-start.mjs'
import { createQoderHookConnection } from './qoder-hook-transport.mjs'
import { createQoderTranscript, verifyQoderChild } from './qoder-transcript.mjs'
import { createClaudeHookConnection } from './claude-hook-transport.mjs'
import { createClaudeTranscript, verifyClaudeChild } from './claude-transcript.mjs'
import { createNativeRuns, verifyNativeChild } from './native-runs.mjs'
import { createCompanionReviews } from './reviews.mjs'
import { createCompanionSettings } from './settings.mjs'
import { createCompanionStudio } from './studio.mjs'
import { createStudioTrials, createStudioTrialInputGate } from './studio-trials.mjs'
import { studioTrialEvidence } from './studio-trial-evidence.mjs'
import { resolveNativeRun } from './native-run-resolution.mjs'
import { partitionReviewConversation } from './background-reviews.mjs'
import { createManagedReviewScheduler } from './managed-reviews.mjs'
import { createNativeReviewScheduler } from './native-review-scheduler.mjs'
import { createReviewExecutor } from './review-executor.mjs'
import { createCompanionKnowledge } from './knowledge.mjs'
import { workspacePollResult } from '../../core/lib/index.js'
import { ProjectContentPanelGuard } from '../../core/lib/index.js'
import { KNOWLEDGE_AGENTIC_GUIDANCE, DESIGN_EXECUTOR_EVIDENCE_GUIDANCE, DESIGN_WORKER_EVIDENCE_GUIDANCE, KnowledgeReadProgress, readDesignReviewPolicy, writeDesignReviewPolicy, designProjectRecordsRoot, commitDesignProjectRecords } from '../../core/lib/index.js'

const reviewBindingReceipt = ({ reviewId, status, nativeRun }) => ({ reviewId, status, nativeRun })

/** Explicit local server lifecycle; does not launch DSH or a model. */
export async function startCompanion(options) {
  if (options.devFrontend !== undefined && typeof options.devFrontend !== 'function') throw new Error('Development frontend requires an explicit factory.')
  if (options.trialInput && !options.studioTrial) throw new Error('Trial input binding requires an owned trial service.')
  if (options.trialInput?.locale !== undefined && !['zh-CN', 'en-US'].includes(options.trialInput.locale)) throw new Error('Invalid trial locale binding.')
  const trialEmbedOrigin = options.trialEmbedOrigin
  if (trialEmbedOrigin !== undefined) {
    let parent
    try { parent = new URL(trialEmbedOrigin) } catch { throw new Error('Invalid trial embedding origin.') }
    if (!options.studioTrial || !options.trialInput || parent.protocol !== 'http:' || parent.hostname !== '127.0.0.1'
      || parent.origin !== trialEmbedOrigin) throw new Error('Trial embedding requires an owned child and an exact loopback parent origin.')
  }
  const trialInputGate = createStudioTrialInputGate(options.trialInput)
  const browserAccess = resolveBrowserAccess(options.browserAccess)
  const browserDefaultView = resolveBrowserDefaultView(options.browserDefaultView)
  const host = options.host ?? options.connection?.host ?? 'codex'
  const codexDesktop = options.codexDesktop === true
  if (codexDesktop && browserAccess !== 'local') {
    throw Error('Codex desktop requires explicit browserAccess="local" (--browser-access local); default/token browser access cannot protect its private bridge.')
  }
  if (codexDesktop && (host !== 'codex' || options.codexRemote !== undefined || options.backgroundReviews === true)) {
    throw Error('Codex desktop requires the Codex host without CLI remote or managed background reviews.')
  }
  if (!['codex', 'qoder', 'claude-code', 'qwenwork', 'workbuddy'].includes(host)) throw new Error('Unsupported native host.')
  resolveQwenWorkInputMode({ ...options, host })
  if (options.codexDesktopNativeBundles === true && !codexDesktop) throw Error('Native desktop Bundles require the explicit Codex desktop route.')
  const nativeCwd = options.nativeCwd ?? options.projectRoot
  const readinessSince = Date.now()
  let nativeRuns
  const desktopExecutionAdapter = codexDesktop && options.codexDesktopNativeBundles === true
    ? await createCodexDesktopExecutionAdapter({ sessionId: options.threadId, projectRoot: nativeCwd,
      mainTranscriptPath: options.transcriptPath, startedAt: readinessSince,
      getParentBinding: runId => nativeRuns?.getBinding(runId) }) : undefined
  const nativeAgentsAvailable = !!desktopExecutionAdapter || !codexDesktop && (host !== 'workbuddy' || options.workbuddyProducer === true)
  const nativeWorkersAvailable = !!desktopExecutionAdapter || !codexDesktop && host !== 'workbuddy'
  const nativeReviewsAvailable = !codexDesktop && (host !== 'workbuddy' || nativeAgentsAvailable)
  const nativeUnavailableHost = codexDesktop ? 'Codex desktop' : 'WorkBuddy'
  let backgroundReviewReadiness = { state: 'unverified' }, mainContext, reviewScheduler
  // Transport reception and native child identity do not prove detached execution.
  // A host's own current-connection proof gates new detached dispatch. Ordinary
  // Producer identity never proves that an Agent executed in the background.
  let nativeReviewExecutionAvailable = !codexDesktop && ['codex', 'qoder', 'claude-code'].includes(host)
  const reviewUnavailableReason = 'Native background reviewer execution is not verified for this host. Ask the user whether to turn automatic GRA off or run this review in the main conversation. Until they choose, keep requests pending and policy unchanged; never automatically substitute synchronous execution.'
  let reviewDispatchOwner = nativeReviewExecutionAvailable ? (options.backgroundReviews === true ? 'companion' : 'main') : 'unavailable'
  const presentReviews = rows => nativeReviewExecutionAvailable ? rows : rows.map(row => row.executionMode==='foreground' ? row : ({...row,
    dispatch:false, executionAvailability:'unavailable', executionUnavailableReason:reviewUnavailableReason}))
  if (host === 'workbuddy' && (!options.connection || options.connection.host !== host || options.connection.threadId !== options.threadId)) throw Error('WorkBuddy requires its exact MCP App connection; native run authority is not yet supported.')
  if (options.codexRemote !== undefined && host !== 'codex') throw new Error('Codex remote is only supported by the Codex host.')
  // Verify the published resource table before project/native/background effects.
  // Missing or corrupt delivery is a startup failure, never a directory fallback.
  const staticRoot = options.staticRoot ?? join(dirname(fileURLToPath(import.meta.url)), '../dist')
  const staticFiles = new Set(await readdir(staticRoot))
  if (!staticFiles.has('client.js')) throw new Error('Companion browser build is missing. Build packages/companion before starting it.')
  const cssAssets = loadPackagedCssAssets(staticRoot, '/design-system-assets/design-companion/')
  staticFiles.add('index.html')
  const managedEnabled=options.backgroundReviews===true
  if(managedEnabled && host!=='codex')throw new Error('Managed background reviews currently support Codex only; this host adapter has not been verified.')
  const executeReview=managedEnabled ? options.reviewExecutor ?? createReviewExecutor({host,model:options.reviewModel}) : undefined
  const connection = options.connection ?? (host === 'qwenwork'
    ? await createQwenWorkPanelConnection({ sessionId: options.threadId, nativeCwd, transcriptPath: options.transcriptPath,
      qwenworkDesktop: options.qwenworkDesktop, qwenworkEventsOnly: options.qwenworkEventsOnly })
    : host === 'qoder'
    ? await createQoderHookConnection({ sessionId: options.threadId, nativeCwd })
    : host === 'claude-code' ? await createClaudeHookConnection({ sessionId: options.threadId, nativeCwd })
      : codexDesktop ? createCodexDesktopRelay(options.threadId)
      : createCodexConnection(options.threadId, undefined, { remote: options.codexRemote }))
  if (codexDesktop && (connection.host !== 'codex' || connection.inputMode !== 'desktop' || connection.threadId !== options.threadId)) throw Error('Codex desktop requires its exact bound desktop connection.')
  let connectionPath
  const backgroundAdapter = createNativeBackgroundAdapter({ host, sessionId: connection.threadId,
    projectRoot: nativeCwd, mainTranscriptPath: options.transcriptPath, readinessSince, codexDesktop,
    getConnectionPath: () => connectionPath })
  const desktopReviewAdapter = codexDesktop && !!backgroundAdapter
  const nativeReviewProtocolAvailable = desktopReviewAdapter || !codexDesktop && (['codex', 'qoder', 'claude-code'].includes(host) || !!backgroundAdapter && nativeAgentsAvailable)
  const refreshReviewCapability = async () => {
    if (!backgroundAdapter) return
    backgroundReviewReadiness = nativeAgentsAvailable || desktopReviewAdapter
      ? await backgroundAdapter.readReadiness()
      : { state: 'unverified', reason: 'The native background adapter is unavailable.' }
    nativeReviewExecutionAvailable = backgroundReviewReadiness.state === 'ready' && backgroundReviewReadiness.canDispatch === true
    reviewDispatchOwner = nativeReviewExecutionAvailable ? 'main' : 'unavailable'
    // Pure observation. Publication, explicit recheck/policy changes and normal
    // scheduler lifecycle own dispatch; a status read must never resume a queue.
  }
  const hostCapabilities = () => ({ mainBundles: true, foregroundReviews: true, nativeSubagents: nativeAgentsAvailable, nativeWorkers: nativeWorkersAvailable, backgroundReviews: nativeReviewExecutionAvailable,
    ...(desktopExecutionAdapter ? { nativeExecutionProtocol: desktopExecutionAdapter.protocol } : {}),
    ...(backgroundAdapter ? { ...nativeCapabilityStatus(backgroundReviewReadiness), backgroundReviewProtocol: backgroundAdapter.protocol(backgroundReviewReadiness) } : {}) })
  try {
  const project = await openCompanionProject({ ...options, connection, nativeCwd, transcriptPath: options.transcriptPath,
    getConnectionPath: () => connectionPath,
    getMainAssessmentContext: async savedEntries => mainContext ? await mainContext.notification(savedEntries.at(-1)) : '',
  })
  const designConversation = ['codex','workbuddy'].includes(host) && options.transcriptPath
    ? await createDesignConversationObserver({ host, ...(host === 'workbuddy' ? {readHeader:readWorkBuddyHeader} : {}), createObserver: host === 'workbuddy' ? createWorkBuddyTranscript : createCodexTranscript, stateRoot: options.stateRoot, projectId: project.project.metadata.id,
      projectRoot: project.project.root, nativeCwd, threadId: connection.threadId, transcriptPath: options.transcriptPath })
    : undefined
  const knowledge = createCompanionKnowledge({ project, stateRoot: options.stateRoot,
    ...(options.knowledgeRuntime ? { loadRuntime: options.knowledgeRuntime } : {}),
    ...(options.embedding ? { embedding: options.embedding } : {}),
  })
  // Agentic trigger model (shared with the DSH host contract): project open
  // only samples cheap durable state; the main Agent decides from the exposed
  // status whether a bounded refresh is worth starting (design_refresh_knowledge).
  // `knowledgeAutoRefresh: true` remains an explicit host opt-in to the legacy
  // open-time indexing behavior and must never wait for the response.
  if (options.knowledgeAutoRefresh === true) {
    void knowledge.notify().catch(error => console.error('Knowledge startup refresh:', String(error.message ?? error)))
  }
  const knowledgeReads = new KnowledgeReadProgress()
  const childObserver = desktopExecutionAdapter?.createObserver ?? (!nativeAgentsAvailable ? () => { throw Error(`${nativeUnavailableHost} native subagent observation is not supported yet.`) } : host === 'workbuddy'
    ? input => createWorkBuddyChildTranscript({...input,sessionId:connection.threadId,mainTranscriptPath:options.transcriptPath})
    : host === 'qwenwork'
    ? input => createQwenWorkTranscript({ ...input, sessionId: connection.threadId, agentId: input.threadId })
    : host === 'qoder'
    ? input => createQoderTranscript({ ...input, sessionId: connection.threadId, agentId: input.threadId })
    : host === 'claude-code' ? input => createClaudeTranscript({ ...input, sessionId: connection.threadId, agentId: input.threadId }) : createCodexTranscript)
  const verifyChild = desktopExecutionAdapter?.verifyChild ?? (!nativeAgentsAvailable ? () => { throw Error(`${nativeUnavailableHost} native subagent binding is not supported yet.`) } : host === 'workbuddy'
    ? input => verifyWorkBuddyChild({...input,sessionId:connection.threadId,mainTranscriptPath:options.transcriptPath})
    : host === 'qwenwork'
    ? input => verifyQwenWorkChild({ ...input, sessionId: connection.threadId })
    : host === 'qoder'
    ? input => verifyQoderChild({ ...input, sessionId: connection.threadId })
    : host === 'claude-code' ? input => verifyClaudeChild({ ...input, sessionId: connection.threadId }) : verifyNativeChild)
  nativeRuns = await createNativeRuns({ project, stateRoot: options.stateRoot, threadId: connection.threadId, nativeCwd,
    host, createObserver: childObserver, verifyChild, readMainTranscript: () => transcript?.read() })
  const resolveExecutionRun = input => desktopExecutionAdapter ? desktopExecutionAdapter.resolveRun(input)
    : resolveNativeRun(input,{host,threadId:connection.threadId,mainTranscriptPath:options.transcriptPath,
      parentBinding:input.parentRunId && input.parentRunId!==connection.threadId ? nativeRuns.getBinding(input.parentRunId) : undefined})
  const resolveRun = input => backgroundAdapter?.resolveRun ? backgroundAdapter.resolveRun(input) : resolveExecutionRun(input)
  const settings = await createCompanionSettings(options.stateRoot)
  // Studio inspects installed resources even before the project selects a Kit.
  const studio = await createCompanionStudio(() => project.installedKit, options.kitRoot, options.stateRoot, project.contentLibrary)
  let trials
  const getTrials = () => {
    if (codexDesktop) throw new Error('Codex desktop Studio trial execution is not verified yet.')
    if (options.studioTrial) throw new Error('Nested Studio trials are disabled. Return to the originating Studio.')
    return trials ??= createStudioTrials({ stateRoot: options.stateRoot, kitRoot: options.kitRoot,
      readInstalledKit: () => project.installedKit,
      readInstalledBundle: pin => project.contentLibrary.store.resolveBundle(pin), connection, startCompanion,
      parentOrigin: origin,
      companionOptions: { host, nativeCwd, transcriptPath: options.transcriptPath, staticRoot, indexPath: options.indexPath, codexRemote: options.codexRemote, codexDesktop: options.codexDesktop, devFrontend: options.devFrontend },
    })
  }
  const reviewObservers = new Map()
  const reviewChildObserver = backgroundAdapter?.createObserver ?? childObserver
  const verifyReviewChild = backgroundAdapter?.verifyChild ?? verifyChild
  const reviews = createCompanionReviews({ project, stateRoot: options.stateRoot, threadId: connection.threadId, host,
    knowledge,
    managedExecution:managedEnabled,
    // Main Bundle execution is independent of detached-review readiness.
    // Isolated targets still require this host's native Producer capability.
    getSettings: settings.read, actionExecutionSupported: skill => skill?.execution.mode === 'main' || nativeAgentsAvailable,
    readMainInput: async () => mainContext?.input(),
    observeReviewRun(binding) {
      const key = JSON.stringify(binding)
      if (!reviewObservers.has(key)) reviewObservers.set(key, reviewChildObserver({ path: binding.transcriptPath,
        threadId: binding.runId, parentRunId: binding.parentRunId, taskPath: binding.taskPath, projectRoot: nativeCwd }))
      return reviewObservers.get(key).read()
    } })
  const verifyReviewBinding = async (reviewId, nativeRun, requireExisting = false, suppliedRequest) => {
    if (!backgroundAdapter) return verifyReviewChild({ ...nativeRun, projectRoot: nativeCwd })
    const request = suppliedRequest ?? await reviews.readReview({ reviewId })
    if (request.nativeRun) {
      const fields = ['runId', 'parentRunId', 'transcriptPath', ...(host === 'qwenwork' ? ['taskPath'] : [])]
      if (fields.some(key => request.nativeRun[key] !== nativeRun[key])) throw new Error('Review cannot be rebound to another native child')
      return backgroundAdapter.verifyChild(request.nativeRun)
    }
    if (requireExisting) throw new Error('Result must match the registered native reviewer')
    // Historical request targets remain valid. Only the NEW native launch must
    // be current and assigned this exact review, never an old child or READY probe.
    return backgroundAdapter.verifyNewChild(nativeRun, { reviewId,
      notBefore: Number.isFinite(request.createdAt) ? Math.max(readinessSince, request.createdAt) : readinessSince })
  }
  const reviewPolicyRoot=join(designProjectRecordsRoot(project.project.root),'reviews')
  const getReviewPolicy=()=>readDesignReviewPolicy(reviewPolicyRoot,project.project.root)
  const managed=executeReview ? createManagedReviewScheduler({reviews,project,knowledge,execute:executeReview,
    debounceMs:options.reviewDebounceMs ?? 30000,
    getPolicy:async()=>{const policy=await getReviewPolicy();return options.reviewDebounceMs===undefined?policy:{...policy,autoMergeWindowMs:options.reviewDebounceMs}},
    onError:error=>console.error('Background review:',String(error.message??error))}) : undefined
  const nativeReviewScheduler=managed || !nativeReviewProtocolAvailable ? undefined : createNativeReviewScheduler({reviews,project,connection,
    canDispatch:async()=>{await refreshReviewCapability();return nativeReviewExecutionAvailable},
    getConnectionPath:()=>connectionPath,getPolicy:getReviewPolicy,
    onError:error=>console.error('Native background review notice:',String(error.message??error))})
  reviewScheduler=managed??nativeReviewScheduler
  const observedWork = native => [
    ...native.executionAttempts.filter(run => ['queued', 'working'].includes(run.phase))
      .map(run => ({ skill: run.skill, artifactFile: run.artifactFile ?? null })),
    ...(native.activeMainBundles ?? []).map(run => ({ skill: run.skill, artifactFile: null })),
  ]
  const panelDrafts = new ProjectContentPanelGuard(project.project.metadata.id)
  const upgradeAdapter = options.contentUpgradeAdapter
  const requireUpgradeAdapter = () => {
    if (typeof upgradeAdapter?.assertProjectQuiescent !== 'function' || typeof upgradeAdapter?.verifyNativeConfinement !== 'function') {
      throw new Error('This native host has no verified project-wide draft/run guard and confined migration Producer adapter. Content upgrade is unavailable; current project pins and files are unchanged.')
    }
    return upgradeAdapter
  }
  const contentMigration = project.createContentMigration({
    async assertQuiescent() {
      const adapter = requireUpgradeAdapter()
      panelDrafts.assertQuiescent()
      const native = await nativeRuns.read()
      if (native.activeMainBundles.length || native.executionAttempts.some(run => ['queued', 'working'].includes(run.phase))) {
        throw new Error('Settle the running native Producer/Worker/main Bundle before upgrading.')
      }
      const states = await reviews.readReviewStatus({ workspace: await project.readWorkspace(), activeWork: observedWork(native) })
      if (states.some(review => ['running', 'unknown'].includes(review.status) || review.nativeStatus === 'unknown')) {
        throw new Error('Settle the native background review before upgrading.')
      }
      // Hosts with additional project-wide execution/draft authorities must supply their actual guard.
      await adapter.assertProjectQuiescent(project.project.metadata.id)
    },
    async verifyNativeProducer(proof, candidateRoot) {
      const adapter = requireUpgradeAdapter()
      const binding = await resolveRun(proof)
      if (binding.parentRunId !== connection.threadId) throw new Error('Content migration must belong to this exact main conversation.')
      const log = await verifyChild({ ...binding, projectRoot: nativeCwd })
      if (log.recordedStatus !== 'completed') throw new Error('Wait for the real native migration Producer to finish before adopting.')
      const instructions = log.rows.filter(row => row.role === 'user').map(row => row.text).join('\n')
      if (!instructions.includes(candidateRoot)) throw new Error('Native migration receipt does not identify the exact isolated candidate.')
      await adapter.verifyNativeConfinement(binding, candidateRoot)
    },
  })
  const reviewStatus = async (workspace, native) => {
    workspace ??= await project.readWorkspace()
    if (!workspace.access?.writable) return []
    native ??= await nativeRuns.read(workspace)
    const rows = await reviews.readReviewStatus({ workspace, activeWork: observedWork(native) })
    // Desktop review state is independent of general Bundle subagent support.
    return presentReviews(nativeReviewsAvailable || desktopReviewAdapter ? rows : rows.filter(row=>row.executionMode==='foreground'))
  }
  // A successful file save must not turn into a reported failure if review reads fail.
  // Successful Design publication maintains KAG independently of graph reads
  // or Agent initiative. Worker receipts without settlement do not trigger.
  let automaticKnowledgeHead
  const withReviewStatus = async (result, includeDerivedStatus = true) => {
    const publishedCheckpoint=result.commit ?? (result.settlement && Object.hasOwn(result.settlement,'state') ? result.settlement.commit : undefined)
    if (publishedCheckpoint) {
      void (async () => {
        const head = await project.store.head()
        if (!head || head === automaticKnowledgeHead) return
        automaticKnowledgeHead = head
        await knowledge.notify()
      })().catch(error => console.error('Knowledge publication refresh:', String(error.message ?? error)))
    }
    if(publishedCheckpoint)void reviewScheduler?.notify('',{checkpoint:publishedCheckpoint}).catch(error=>console.error('Background review trigger:',String(error.message??error)))
    // Browser save-and-continue must be able to notify the host as soon as the
    // authoritative save/handoff is durable. Database opening and derived review
    // reads run on their independent status path, never on that acknowledgement.
    // Legacy tool callers retain the enriched receipt unless they opt out.
    if (!includeDerivedStatus) return { ...result, derivedStatus:'pending', reviewDispatchOwner,
      hostCapabilities:hostCapabilities() }
    const knowledgeStatus = await knowledge.status().catch(() => undefined)
    try { return { ...result, hostCapabilities:hostCapabilities(), reviewDispatchOwner, reviews: await reviewStatus(), ...(knowledgeStatus === undefined ? {} : { knowledge: knowledgeStatus }) } }
    catch { return { ...result, reviewStatusError: 'Review status unavailable; files remain saved. Check design_status before retrying.', ...(knowledgeStatus === undefined ? {} : { knowledge: knowledgeStatus }) } }
  }
  const transcript = options.transcriptPath ? (host === 'qwenwork'
    ? createQwenWorkTranscript({ path: options.transcriptPath, sessionId: connection.threadId, projectRoot: nativeCwd })
    : host === 'qoder'
    ? createQoderTranscript({ path: options.transcriptPath, sessionId: connection.threadId, projectRoot: nativeCwd })
    : host === 'claude-code' ? createClaudeTranscript({ path: options.transcriptPath, sessionId: connection.threadId, projectRoot: nativeCwd })
      : designConversation) : undefined
  mainContext = createCompanionMainContext({ project, reviews, knowledge })
  // A resumed evaluator may settle immediately. Its current-main check must
  // have the exact live input reader before any pending work is resumed.
  await managed?.resumePending()
  const mainAssessmentContext = async () => {
    try { return { available: true, ...await mainContext.context({ includeKnowledge: false }) } }
    catch (error) { return { available: false, error: String(error.message ?? error),
      ...(typeof (error.reasonCode ?? error.code) === 'string' ? { reasonCode: error.reasonCode ?? error.code } : {}) } }
  }
  const readConversation = async native => {
    const recorded = transcript ? await transcript.read()
      : { available:false, recordedStatus:'unknown', rows:[], omitted:0, error:host === 'workbuddy' ? '未提供当前 WorkBuddy 会话的 Hook transcriptPath，无法同步对话历史。请用更新后的 yugoo Skill 重开当前项目面板；已保存文件不受影响。' : '尚未绑定原生会话日志。' }
    return partitionReviewConversation(recorded, await reviews.readPresentationBindings(), {
      connectionPath,
      ...(native ? {
        foregroundActive: native.executionAttempts.some(run => ['queued', 'working'].includes(run.phase))
          || native.activeMainBundles?.length > 0,
        foregroundRunIds: native.executionAttempts.map(run => run.runId),
      } : nativeRuns.readConversationScope()),
    })
  }
  const token = randomBytes(32).toString('hex')
  const browserGeneration = randomBytes(16).toString('hex')
  const browserBase = `/browser/${browserGeneration}/`
  let lastAuthenticatedActivityAt = Date.now()
  let origin
  const send = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(JSON.stringify(value))
  }
  let devFrontend
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) return send(response, 403, { error: 'Invalid local Host.' })
      const browserRequest = request.url === `${browserBase}api`
      const browserPage = request.url?.split('?', 1)[0] === browserBase
      if (request.url?.startsWith('/browser/') &&
        (browserAccess !== 'local' || (!browserRequest && !browserPage))) {
        return send(response, 410, { error: 'This Companion page is no longer connected. Reopen it from the original conversation.' })
      }
      if (request.url?.startsWith('/design-system-assets/')) return cssAssets.handler(request, response)
      if (request.method === 'POST' && (request.url === '/api' || browserRequest)) {
        const supplied = request.headers['x-design-token']
        if (browserRequest ? !browserRequestAllowed(request.headers, origin)
          : request.headers.origin !== origin || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token)
            || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return send(response, 403, { error: 'Unauthorized companion request.' })
        if (!request.headers['content-type']?.startsWith('application/json')) return send(response, 415, { error: 'JSON required.' })
        let size = 0
        const chunks = []
        for await (const chunk of request) {
          size += chunk.length
          if (size > 12 * 1024 * 1024) return send(response, 413, { error: 'Request exceeds 12 MiB.' })
          chunks.push(chunk)
        }
        const { method, params = {} } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        // Authenticated status/preflight only; never launch a real review as a probe.
        if (backgroundAdapter && ['readWorkspace','prepareReview','prepareReviews','recheckReviews','bindReviewRun','bindReviewRuns'].includes(method)) await refreshReviewCapability()
        if (browserRequest) {
          if (!browserMethods.has(method)) return send(response, 403, { error: 'Operation is not available to the browser.' })
          await project.refreshAccess(true)
        }
        // This is service activity, never proof that its native input bridge is
        // online. Unauthenticated/static requests cannot extend the lifetime.
        lastAuthenticatedActivityAt = Date.now()
        if (method === 'desktopBridge') {
          if (!codexDesktop || typeof connection.desktopBridge !== 'function') throw Error('Codex desktop bridge is unavailable.')
          return send(response, 200, await connection.desktopBridge(params))
        }
        if (method === 'readConversation') {
          // This bound, read-only Host projection verifies its native identity
          // and durable boundary on every read. It does not require a readable
          // Kit, project mutation queue, child logs, KAG or review execution.
          const fullPresentation = await readConversation()
          // Review-log consumers do not receive or render foreground messages.
          // This is a projection of the same native observer, not another log.
          const presentation = params.includeConversation === false
            ? { backgroundRows: fullPresentation.backgroundRows,
              available: fullPresentation.conversation.available,
              ...(fullPresentation.conversation.error ? { error: fullPresentation.conversation.error } : {}) } : fullPresentation
          return send(response, 200, Object.hasOwn(params, 'knownRevision')
            ? workspacePollResult(presentation, params.knownRevision) : presentation)
        }
        if (method === 'recoverContentUpgrade') {
          const receipt = await contentMigration.recover()
          await project.refreshAccess()
          return send(response, 200, { recovered: receipt ?? null })
        }
        // Presentation refresh already rechecks metadata and publication. Full
        // Git-open validation belongs to operations, not every visible tick.
        // Save/send/readGit own fresh full validation inside their operation (save also
        // rechecks after entering its mutation queue). Avoid duplicate Git
        // checks in the HTTP wrapper before entering the same authority.
        const ownsAccessCheck = ['savePanel', 'sendPrompt', 'readGit'].includes(method)
        const access = await project.refreshAccess(method === 'readWorkspace' || ownsAccessCheck)
        if(method==='recheckReviews' && params.executionMode!==undefined && !['background','foreground'].includes(params.executionMode))throw Error('Invalid manual GRA execution mode')
        const reviewRequest = ['readReview','submitReview'].includes(method) ? await reviews.readReview({reviewId:params.reviewId}) : undefined
        // Only the explicit manual entry mints foreground requests. A submit
        // parameter cannot turn a background request into an unbound main run.
        const foregroundOperation = method==='recheckReviews' && params.executionMode==='foreground'
          || reviewRequest?.executionMode==='foreground' && typeof reviewRequest.manualRequestId==='string'
        const reviewOperation = ['prepareReview','prepareReviews','bindReviewRun','bindReviewRuns','submitReview','readReview','recheckReviews'].includes(method)
        if (!foregroundOperation && !nativeAgentsAvailable && ['registerNativeRun','finishNativeRun','focusArtifact','readExecutionLog', ...(desktopReviewAdapter ? [] : ['prepareReview','prepareReviews','bindReviewRun','bindReviewRuns','submitReview','readReview','recheckReviews'])].includes(method)) throw Error(`${nativeUnavailableHost} native agents and background reviews are not supported by this adapter yet.`)
        if (!foregroundOperation && !nativeReviewsAvailable && !desktopReviewAdapter && reviewOperation) throw Error(`${nativeUnavailableHost} background reviews are not supported yet.`)
        if (!foregroundOperation && !nativeReviewExecutionAvailable && ['prepareReview','prepareReviews','bindReviewRun','bindReviewRuns','recheckReviews'].includes(method)) throw Error(reviewUnavailableReason)
        if (host === 'workbuddy' && method === 'registerNativeRun' && params.role !== 'producer') throw Error('WorkBuddy Workers are not verified; Producer must execute serially.')
        // No Kit means no Bundle/review execution, not a failed project startup.
        // Refresh on every request so a CLI selection or recovery is reflected live.
        const kitOperations = ['prepareBundle', 'savePanel', 'retainAutoPanel', 'prepareAutoPanel', 'submitAutoPanel', 'beginMainBundle', 'finishMainBundle',
          'registerNativeRun', 'focusArtifact', 'finishNativeRun', 'prepareReview', 'prepareReviews', 'bindReviewRuns',
          'bindReviewRun', 'submitReview', 'decideAdvisory', 'claimReviewAction', 'settleReviewAction', 'readReview', 'readReviewAction', 'selectReviewAction']
        if (kitOperations.includes(method) && !ownsAccessCheck) await project.requireWritable()
        if (method === 'info') return send(response, 200, { host, threadId: connection.threadId, projectName: project.project.metadata.name,
          ...(trialEmbedOrigin === undefined ? {} : { trialPanel: { trialId: options.trialInput.id, parentOrigin: trialEmbedOrigin,
            ...(options.trialInput.locale === undefined ? {} : { locale: options.trialInput.locale }) } }) })
        if (method === 'reloadKit') return send(response, 200, await project.reloadKit())
        if (method === 'observePanelDraft') {
          panelDrafts.observe(params)
          return send(response, 200, { observed: true })
        }
        if (method === 'prepareContentUpgrade') {
          await project.requireWritable()
          return send(response, 200, await contentMigration.prepare(params.target))
        }
        if (['readContentUpgradeDefinition', 'listContentUpgradeFiles', 'readContentUpgradeFile', 'writeContentUpgradeFile', 'validateContentUpgrade'].includes(method)) {
          requireUpgradeAdapter()
          const candidate = await contentMigration.candidate(params.id)
          if (method === 'readContentUpgradeDefinition') return send(response, 200, await candidate.readDefinition(params.side, params.offset, params.resource))
          if (method === 'listContentUpgradeFiles') return send(response, 200, { files: await candidate.list() })
          if (method === 'readContentUpgradeFile') return send(response, 200, await candidate.read(params.path, params.offset))
          if (method === 'writeContentUpgradeFile') {
            if (typeof params.content !== 'string') throw new Error('Candidate content must be UTF-8 text.')
            await candidate.write(params.path, params.content)
            return send(response, 200, { candidateUpdated: true })
          }
          candidate.assertDefinitionsRead()
          try {
            await contentMigration.validateCandidate(params.id, params.evidence)
            return send(response, 200, { accepted: true, published: false })
          } catch (error) {
            return send(response, 200, { accepted: false, diagnostics: [String(error.message ?? error)],
              next: 'Repair this candidate in the same attached native Agent. Do not change saved facts to satisfy a validator.' })
          }
        }
        if (method === 'finishContentUpgrade') {
          (await contentMigration.candidate(params.id)).assertDefinitionsRead()
          const receipt = await contentMigration.finish(params.id, params.native, params.evidence)
          await project.refreshAccess()
          return send(response, 200, await withReviewStatus({ ...receipt, commit: receipt.checkpoint }))
        }
        if (method === 'readGraph') {
          try {
            const result = await knowledgeReads.read(project.project.metadata.id, () => knowledge.readGraph(), () => knowledge.recoveryStatus())
            return send(response, 200, result.value ?? { content: JSON.stringify({ projectId: project.project.metadata.id,
              checkpoint: '', nodes: [], edges: [], warnings: [], knowledgeStatus: 'unavailable', recovery: result.recovery }) })
          }
          catch (error) { return send(response, 200, { content: JSON.stringify({ projectId: project.project.metadata.id,
            checkpoint: await project.store.head() ?? '', knowledgeStatus: 'unavailable', nodes: [], edges: [],
            coverage: { projection: 'unavailable', embedding: 'unknown', review: 'unknown' },
            recovery: knowledge.recoveryStatus(),
            warnings: ['统一 KAG 当前不可用，可继续使用设计文件。', String(error.message ?? error)],
          }) }) }
        }
        if (method === 'queryKnowledge') return send(response, 200, await knowledge.query(params))
        if (method === 'retryKnowledge') return send(response, 200, await knowledge.retryRecovery())
        if (method === 'mainContext') return send(response, 200, await mainContext.context())
        if (method === 'reportMainClarity') return send(response, 200, await mainContext.report(params))
        if (method === 'knowledgeStatus') return send(response, 200, await knowledge.status())
        if (method === 'refreshKnowledge') return send(response, 200, await knowledge.requestMaintenance())
        if (method === 'knowledgeContext') {
          try { return send(response, 200, { available: true, ...await knowledge.captureContext(await project.store.head()), method: KNOWLEDGE_AGENTIC_GUIDANCE }) }
          catch (error) { return send(response, 200, { available: false, error: String(error.message ?? error), method: KNOWLEDGE_AGENTIC_GUIDANCE }) }
        }
        if (method === 'prepareBundle') {
          const prepared = await project.prepareBundle(params)
          if (!nativeAgentsAvailable && prepared.execution.mode !== 'main') throw Error(`This Bundle requires an isolated native Producer; ${nativeUnavailableHost} support is not verified. The Bundle will not be run in main as a fallback.`)
          return send(response, 200, { ...prepared, knowledgeMethod: KNOWLEDGE_AGENTIC_GUIDANCE,
            cooperationMethod: DESIGN_EXECUTOR_EVIDENCE_GUIDANCE,
            ...(nativeWorkersAvailable ? { workerMethod: DESIGN_WORKER_EVIDENCE_GUIDANCE } : {}) })
        }
        if (method === 'readWorkspace') {
          const workspace = await project.readWorkspace({ displayOnly: true })
          const native = await nativeRuns.read(workspace)
          const activeSkills = new Set(native.executionAttempts.filter(run => run.role === 'producer' && ['queued', 'working'].includes(run.phase)).map(run => run.skill))
          for (const run of native.activeMainBundles ?? []) activeSkills.add(run.skill)
          const reviewPresentation = workspace.access?.writable
            ? await reviews.readPresentation({ workspace, activeWork: observedWork(native) })
            // Missing or unavailable project access cannot certify fresh scores.
            // Keep the existing access reason as the recovery authority; reads
            // never start an assessment merely to fill this display snapshot.
            : { reviews: [], clarity: { assessment: null, needsReassessment: true }, advisories: [] }
          const reviewStates = presentReviews(nativeReviewsAvailable || desktopReviewAdapter ? reviewPresentation.reviews
            : reviewPresentation.reviews.filter(row=>row.executionMode==='foreground'))
          // The browser reads history independently. Legacy tool readers keep
          // the full projection; conversation-only updates do not retransmit a
          // whole Panel workspace to the new browser.
          const presentation = params.includeConversation === false ? undefined : await readConversation(native)
          const snapshot = { ...workspace, ...native,
            clarity: reviewPresentation.clarity, advisories: reviewPresentation.advisories,
            reviews: reviewStates, reviewPolicy:await getReviewPolicy(), hostCapabilities:hostCapabilities(), reviewDispatchOwner,
            backgroundReviews: { reviews:reviewStates, rows:presentation?.backgroundRows ?? [] },
            continuations: workspace.continuations.filter(gate => !activeSkills.has(gate.skill)),
            ...(presentation ? { conversation: presentation.conversation } : {}) }
          // Native status explicitly asks for the complete service read models.
          // Browser workspace polling and latency-sensitive save acknowledgements
          // do not open the knowledge provider or start an evaluator/indexer here.
          if (params.includeServices === true) {
            const [main, knowledgeStatus] = await Promise.all([
              mainAssessmentContext(), knowledge.status().catch(error => ({ state: 'unavailable', error: String(error.message ?? error) })),
            ])
            snapshot.services = derivedServicesStatus({ projectId: project.project.metadata.id,
              checkpoint: workspace.checkpoint, clarity: snapshot.clarity, mainContext: main, knowledge: knowledgeStatus,
              reviewPolicy: snapshot.reviewPolicy, hostCapabilities: snapshot.hostCapabilities,
              reviewDispatchOwner, reviews: reviewStates })
          }
          // Legacy tools/internal readers retain the full response. Only the
          // browser opts into conditional transport, after all fresh reads.
          return send(response, 200, Object.hasOwn(params, 'knownRevision')
            ? workspacePollResult(snapshot, params.knownRevision) : snapshot)
        }
        if (method === 'readSettings') return send(response, 200, settings.read())
        if (method === 'readReviewPolicy') return send(response,200,await getReviewPolicy())
        if (method === 'updateReviewPolicy') {
          const policy=await project.mutateAssessment(async()=>{
            const expectedHead=await project.store.head()
            const value=await writeDesignReviewPolicy(reviewPolicyRoot,params.policy,project.project.root)
            await commitDesignProjectRecords({projectRoot:project.project.root,
              paths:['design_records/reviews/gra-policy.json'],expectedHead,message:'Record Design review policy'})
            return value
          })
          await reviewScheduler?.configure()
          return send(response,200,policy)
        }
        if (method === 'recheckReviews') {
          return send(response,200,managed && params.executionMode!=='foreground' ? await managed.requestManual(params) : await reviews.prepareManualReviews(params))
        }
        if (method === 'studioTrialAvailability') {
          // Presence in /info is not a native connection check. Never queue a
          // user message or start/resume a turn to probe this transport.
          if (options.studioTrial) return send(response, 200, { status: 'unavailable' })
          if (typeof connection.probe !== 'function') return send(response, 200, { status: 'unknown' })
          try {
            const result = await connection.probe()
            return send(response, 200, { status: ['available', 'unavailable', 'unknown'].includes(result?.status) ? result.status : 'unknown' })
          } catch { return send(response, 200, { status: 'unavailable' }) }
        }
        const trialMethods = { studioTrialStart: 'start', studioTrialRead: 'read', studioTrialList: 'list', studioTrialStop: 'stop', studioTrialRemove: 'remove' }
        if (method === 'submitTrialInput') return send(response, 200, await trialInputGate.submit(params))
        if (Object.hasOwn(trialMethods, method)) {
          const service = await getTrials()
          return send(response, 200, await service[trialMethods[method]](method === 'studioTrialStart' ? params : params.id))
        }
        const studioMethods = { studioWorkspace: 'workspace', studioKit: 'readKitWorkspace', studioBundle: 'readBundleWorkspace', studioFile: 'readBundleFile',
          studioInstanceList: 'listInstances', studioInstanceRead: 'readInstance', studioInstanceCopy: 'copyInstance',
          studioInstanceRename: 'renameInstance', studioInstanceRemove: 'removeInstance', studioInstanceFile: 'readInstanceFile',
          studioInstanceSave: 'saveInstanceFile', studioInstancePreview: 'previewInstance',
          studioInstanceMounts: 'updateInstanceMounts',
          studioKitFiles: 'readKitFiles', studioKitFile: 'readKitFile',
          studioInstalledPreview: 'previewInstalledPanel',
          studioDraftCreate: 'createPanelDraft', studioDraftList: 'listPanelDrafts', studioDraftRead: 'readPanelDraft',
          studioDraftSave: 'savePanelDraft', studioDraftPreview: 'previewPanelDraft', studioDraftConfirm: 'confirmPanelDraft', studioDraftFork: 'forkPanelDraft',
          studioKitDraftCreate: 'createKitDraft', studioKitDraftList: 'listKitDrafts', studioKitDraftRead: 'readKitDraft',
          studioKitDraftSave: 'saveKitDraft', studioKitDraftValidate: 'validateKitDraft', studioKitDraftPreview: 'previewKitDraft',
          studioKitDraftConfirm: 'confirmKitDraft', studioKitDraftFork: 'forkKitDraft',
          studioContentExport: 'exportContentArchive', studioContentImport: 'prepareContentImport',
          studioContentImportRead: 'readContentImport', studioContentImportList: 'listContentImports',
          studioContentImportAdopt: 'adoptContentImport' }
        if (Object.hasOwn(studioMethods, method)) return send(response, 200, await studio[studioMethods[method]](params))
        if (method === 'updateSettings') return send(response, 200, await settings.write(params))
        if (method === 'readReview') return send(response, 200, reviewRequest)
        if (method === 'prepareReview' || method === 'prepareReviews') {
          const policy=await getReviewPolicy()
          const includesGra=method==='prepareReview' ? params.profile!=='clarity'
            : params.profiles===undefined || !Array.isArray(params.profiles) || params.profiles.some(profile=>profile!=='clarity')
          if(policy.mode==='off' && includesGra)throw new Error('GRA is disabled by the user. An explicit human recheck is required.')
          if(managed)return send(response,200,await managed.requestDue({profiles:method==='prepareReview'?[params.profile]:params.profiles,userContext:params.userContext}))
          const workspace = await project.readWorkspace()
          const native = await nativeRuns.read(workspace)
          const activeWork = observedWork(native)
          return send(response, 200, await reviews[method]({ ...params, activeWork }))
        }
        if (method === 'bindReviewRuns') {
          if (!Array.isArray(params.bindings) || !params.bindings.length || params.bindings.length > 4
            || new Set(params.bindings.map(item=>item?.reviewId)).size !== params.bindings.length) throw new Error('Supply one to four distinct review bindings.')
          const results = []
          for (const binding of params.bindings) {
            try {
              if (binding.nativeRun?.parentRunId && binding.nativeRun.parentRunId !== connection.threadId) throw new Error('Reviewer must be a native child of the bound main conversation.')
              binding.nativeRun = await resolveRun(binding.nativeRun)
              if (binding.nativeRun?.parentRunId !== connection.threadId) throw new Error('Reviewer must be a native child of the bound main conversation.')
              await verifyReviewBinding(binding.reviewId, binding.nativeRun)
              const request = await reviews.bindReviewRun(binding)
              results.push(reviewBindingReceipt(request))
            } catch (error) {
              results.push({ reviewId: binding?.reviewId, error: String(error.message ?? error) })
            }
          }
          return send(response, 200, { results })
        }
        if (method === 'submitReview' || method === 'bindReviewRun') {
          if(method==='submitReview' && foregroundOperation)return send(response,200,await reviews.submitReview(params))
          if (params.nativeRun?.parentRunId && params.nativeRun.parentRunId !== connection.threadId) throw new Error('Reviewer must be a native child of the bound main conversation.')
          params.nativeRun = await resolveRun(params.nativeRun)
          if (params.nativeRun?.parentRunId !== connection.threadId) throw new Error('Reviewer must be a native child of the bound main conversation.')
          await verifyReviewBinding(params.reviewId, params.nativeRun, method === 'submitReview', reviewRequest)
          const result = await reviews[method](params)
          return send(response, 200, method === 'bindReviewRun' ? reviewBindingReceipt(result) : result)
        }
        if (method === 'listAdvisories') return send(response, 200, access.writable ? await reviews.listAdvisories() : [])
        if (method === 'decideAdvisory') return send(response, 200, await reviews.decideAdvisory(params))
        if (method === 'readReviewAction' || method === 'selectReviewAction') return send(response, 200, await reviews[method](params))
        if (method === 'claimReviewAction' || method === 'settleReviewAction') {
          if (!!params.runId === !!params.invocationId) throw new Error('Supply exactly one native runId or main invocationId.')
          const nativeBinding = params.invocationId ? nativeRuns.getMainInvocation(params.invocationId) : nativeRuns.getBinding(params.runId)
          if (nativeBinding.mode !== 'main') await verifyChild({ ...nativeBinding, projectRoot: nativeCwd })
          if (method === 'claimReviewAction') return send(response, 200, await reviews.claimReviewAction({ receiptId: params.receiptId, nativeBinding }))
          const observation = (await nativeRuns.read(await project.readWorkspace())).executionAttempts.find(run => run.runId === params.runId)
          if (nativeBinding.mode !== 'main' && (!observation || ['working', 'queued'].includes(observation.phase))) throw new Error('Native Producer has not ended; cannot settle its advisory action.')
          if (!nativeBinding.finished) throw new Error('Settle the Bundle files and Git audit before settling its advisory action.')
          const state = (nativeBinding.mode !== 'main' && observation.phase !== 'completed') || ['failed', 'cancelled', 'no-progress'].includes(nativeBinding.settledOutcome)
            ? 'failed' : nativeBinding.settledScope === 'state' ? 'needs-user-input' : 'completed'
          return send(response, 200, await reviews.settleReviewAction({ receiptId: params.receiptId, nativeBinding, state }))
        }
        if (method === 'finishNativeRun' || method === 'finishMainBundle') return send(response, 200,
          await withReviewStatus(await finishWithAutoPanel({ method, params, nativeRuns, project })))
        if (method === 'registerNativeRun' || method === 'beginMainBundle') {
          await trialInputGate.assertExecution(params)
          if (method === 'registerNativeRun') {
            const binding = await resolveExecutionRun(params)
            if (desktopExecutionAdapter) {
              const skill = project.kit.skills.find(skill => skill.name === params.skill)
              await desktopExecutionAdapter.verifyAssignment(binding, skill && { skill: skill.name, version: skill.version,
                kit: { name: project.kit.name, version: project.kit.version }, designFiles: project.project.designFilesRoot }, connectionPath)
            }
            return send(response, 200, await nativeRuns.registerNativeRun({ ...params, ...binding }))
          }
          return send(response, 200, await nativeRuns.beginMainBundle(params))
        }
        if (method === 'retainAutoPanel') return send(response, 200, await project.retainAutoPanel(params))
        if (method === 'prepareAutoPanel' || method === 'submitAutoPanel') return send(response, 200, await project[method](params))
        if (method === 'savePanel') return send(response, 200, await withReviewStatus(await project.savePanel(params), params.includeDerivedStatus !== false))
        if (['registerNativeRun', 'focusArtifact', 'readExecutionLog'].includes(method)) return send(response, 200, await nativeRuns[method](params))
        const methods = ['readWorkspace', 'readGit', 'reloadKit', 'savePanel', 'retainAutoPanel', 'readArtifact', 'readBinaryArtifact', 'sendPrompt', 'listSkills', 'listProjects', 'prepareBundle']
        if (!methods.includes(method)) return send(response, 400, { error: 'Unsupported companion operation.' })
        return send(response, 200, await project[method](params))
      }
      if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' })
      // Development is an explicit caller-owned presentation capability. It
      // never handles API requests or relaxes the existing Host/token checks.
      if (devFrontend && request.headers.origin && request.headers.origin !== origin) return send(response, 403, { error: 'Invalid development Origin.' })
      if (devFrontend && !browserPage && request.url.split('?', 1)[0] !== '/') {
        if (await devFrontend.handle(request, response)) return
        return send(response, 404, { error: 'Not found.' })
      }
      const asset = staticAssetRequest(browserPage ? '/' : request.url, staticFiles)
      if (!asset) return send(response, 404, { error: 'Not found.' })
      const { name, type } = asset
      // Only this owned child HTML entry may be framed, by its exact parent.
      // Query parameters cannot grant embedding authority or relax API authentication.
      const trialPanel = trialEmbedOrigin !== undefined && name === 'index.html' && request.url === '/?view=trial-panel'
      const bytes = await readFile(name === 'index.html' ? options.indexPath ?? join(staticRoot, '../index.html') : join(staticRoot, name))
      let html = devFrontend && name === 'index.html' ? await devFrontend.html(request.url, bytes.toString('utf8')) : bytes
      if (name === 'index.html') {
        const page = html.toString('utf8')
        const meta = `<meta name="design-companion-default-view" content="${browserDefaultView}">`
        // Custom API-test entries may use an implicit head; retain their doctype.
        html = /<head\b[^>]*>/i.test(page)
          ? page.replace(/<head\b[^>]*>/i, head => head + meta)
          : page.replace(/^(?:<!doctype[^>]*>)?/i, doctype => doctype + meta)
      }
      response.writeHead(200, {
        'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        ...(trialPanel ? { 'Content-Security-Policy': `frame-ancestors ${trialEmbedOrigin}` } : { 'X-Frame-Options': 'DENY' }),
      })
      response.end(html)
    } catch (error) { send(response, 400, notificationErrorResponse(error) ?? { error: String(error.message ?? error) }) }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  if (options.devFrontend) {
    try { devFrontend = await options.devFrontend({ server, origin }) }
    catch (error) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      await reviewScheduler?.close()
      await knowledge.close()
      throw error
    }
  }
  connectionPath = join(options.stateRoot, 'connections', `${token.slice(0, 24)}.json`)
  await mkdir(dirname(connectionPath), { recursive: true, mode: 0o700 })
  await writeFile(connectionPath, JSON.stringify({ origin, token, host, threadId: connection.threadId, projectRoot: project.project.root, nativeCwd, ...(codexDesktop ? { codexDesktop: true } : {}) }), { mode: 0o600, flag: 'wx' })
  await nativeReviewScheduler?.resumePending()
  return { origin, token, connectionPath, browserAccess, browserGeneration, inputMode: connection.inputMode,
    url: browserAccess === 'local' ? `${origin}${browserBase}` : `${origin}/#${token}`, project, knowledge,
    async readTrialEvidence({ id, projectId, source }) {
      if (!options.studioTrial || projectId !== project.project.metadata.id
        || source.kit.name !== project.installedKit.name || source.kit.version !== String(project.installedKit.version)
        || !project.installedKit.skills.some(skill => skill.name === source.bundle.name && String(skill.version) === source.bundle.version)) throw new Error('Trial evidence identity mismatch.')
      const native = await nativeRuns.read(await project.readWorkspace())
      return studioTrialEvidence({ id, projectId, owners: nativeRuns.getTrialBindings(source.bundle.name),
        attempts: native.executionAttempts, mainLog: await transcript?.read() })
    }, get lastAuthenticatedActivityAt() { return lastAuthenticatedActivityAt }, async close() {
    let trialCloseError
    try { if (trials) await (await trials).close() } catch (error) { trialCloseError = error }
    connection.close?.()
    await reviewScheduler?.close()
    await knowledge.close()
    await devFrontend?.close()
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(connectionPath, { force: true })
    if (trialCloseError) throw trialCloseError
  } }
  } catch (error) {
    // A verified transport may own a helper before project/server startup fails.
    connection.close?.()
    throw error
  }
}
