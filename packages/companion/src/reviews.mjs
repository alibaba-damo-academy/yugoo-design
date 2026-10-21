/** Host-neutral review preparation/result persistence. Never starts or polls an Agent. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { join, resolve, isAbsolute } from 'node:path'
import * as core from '../../core/lib/index.js'
import { bindNativeProject } from './native-project-binding.mjs'
import { requireNativeId, nativeScope, nativeInvocationId } from './native-identity.mjs'

const queues = new Map()
const canonical = value => {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || !['string','number','boolean'].includes(typeof value) && value !== null) throw new Error('Review data must be JSON')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const clone = value => JSON.parse(JSON.stringify(value))
const latestRequest = (requests, profile) => requests.filter(item=>item.profile===profile).sort((a,b)=>b.sequence-a.sequence)[0]
const normalizeWork = work => [...new Map(work.map(item => {
  if (!item || typeof item.skill !== 'string' || (item.artifactFile != null && typeof item.artifactFile !== 'string')) throw new Error('Invalid observed work target')
  const target = { skill: item.skill, artifactFile: item.artifactFile ?? null }
  return [canonical(target), target]
})).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)
function serial(key, operation) {
  const next = (queues.get(key) ?? Promise.resolve()).then(operation)
  const settled = next.then(()=>{},()=>{})
  queues.set(key, settled)
  void settled.then(()=>{if(queues.get(key)===settled)queues.delete(key)})
  return next
}
const PROFILE_IDS = {
  grounding: core.OFFICIAL_GROUNDING_PROFILE,
  reflection: core.OFFICIAL_REFLECTION_PROFILE,
  alignment: core.OFFICIAL_ALIGNMENT_PROFILE,
}
// Review-specific reading guidance; generation/delegation protocols stay at
// their existing Main/Producer/Worker entry points, not in reviewer requests.
const NATIVE_REVIEW_KNOWLEDGE_GUIDANCE = [
  'KAG is an optional read-only discovery aid, not a review prerequisite or Design authority. Investigate the profile-specific question, not every graph node or possible relationship. Sufficient source evidence needs no graph query.',
  'Start with relevant sourceFiles, text or exact record IDs. Keep the supplied project, checkpoint and graph revision on every query and page, with unchanged filters. Expand incidentTo one-hop neighborhoods only as needed, deduplicate, and stop when the question is supported or the bounded search cannot resolve it.',
  'Use ontologyTypes for schema-derived kinds, recordKinds for records/content/artifacts and identityQualities for stable/structural/anonymous anchors; these are projection facts, not assigned business roles. relationMeanings and relationOrigins filter before pagination; relationTypes matches exact stored types. direction is STORAGE incoming/outgoing, including symmetric similar/contradicts; use both for both sides. Unknown types retain unknown semantics: do not infer meaning from producer, labels or visual proximity. A heavily cited shared style is not necessarily a central business capability; do not infer mandatory node layers from schema names or visual positions.',
  'Verify findings against Design Files at the request\'s pinned source checkpoint. Schema-derived shapes describe allowed structure, not confirmed business truth. Contains/reference edges locate evidence, similarity only recalls candidates, and prior Agent relations are interpretations rather than self-proving facts.',
  'Distinguish source containers, design units and their field evidence. Keep properties such as size, color and states on their unit with exact pointers; equal values alone do not establish a relationship. Use the most specific evidenced unit/field rather than a container as a substitute endpoint.',
  'An unloaded endpoint, partial page, unfinished index or isolated node is not proof of missing design. Consider the current design stage and disclose checked scope and unknowns. If KAG is unavailable or stale, continue scoped source-file investigation without claiming complete graph coverage; do not refresh the index or repeatedly retry. Design changes remain with the owning Bundle; optional graph observations use only this review\'s existing result path.',
].join('\n')
const NATIVE_REVIEW_COMPLETION_GUIDANCE = [
  'Submit the requested result with design_submit_review using this reviewId and the registered nativeRun from design_read_review. Use that existing binding, not log scans or repeated permission checks. If the initial request was unbound, read it once when ready to submit; if still unbound, report pending binding and yield without polling or claiming success.',
  'Follow the returned result schema with native JSON types: numbers remain numbers, booleans remain booleans, and arrays remain arrays, including empty arrays. Do not encode arrays as {item: ...} objects or stringify typed values.',
  'After an explicit field validation rejection, correct the identified field against the returned schema and retry the same review at most once. If that correction fails, or submission delivery/acceptance is uncertain, stop and return the concrete diagnostic and known submission status to the main conversation. Do not restart the review, blindly replay a submission, or investigate Companion/Host implementation, internal state or sibling transcripts through shell commands to repair the transport.',
  'An accepted advisory with knowledgeError is already submitted: report the optional graph warning without resubmitting the advice. Do not edit Design Files or execute advice. Return a brief submission status or unresolved diagnostic; claim completion only after a successful submission receipt.',
].join('\n')
const FOREGROUND_REVIEW_COMPLETION_GUIDANCE = [
  'This is the explicit human-requested foreground review in the bound main conversation. Read this profile and its pinned Design evidence, then call design_submit_review with this reviewId and result, omitting nativeRun. Do not create a reviewer binding or wait for a background agent. This request does not enable automatic GRA or change the user policy.',
  ...NATIVE_REVIEW_COMPLETION_GUIDANCE.split('\n').slice(1),
].join('\n')

/** Caller owns one local service; native-child identity is verified before submit/claim. */
export function createCompanionReviews({ project, stateRoot, threadId, host = 'codex', managedExecution = false, getSettings = () => ({}), actionExecutionSupported = false, observeReviewRun, knowledge, readMainInput }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) throw new Error('Explicit native thread UUID required')
  const projectId = project.project.metadata.id
  const root = join(resolve(stateRoot), projectId)
  const recordsRoot = core.designProjectRecordsRoot(project.project.root)
  const storageThread = managedExecution ? 'managed' : threadId
  const file = join(root, `reviews-${managedExecution ? 'managed' : nativeScope(host, threadId)}.json`)
  const storage = new core.DesignJournalStorage(join(recordsRoot, 'reviews'), {}, { projectRoot: project.project.root })
  const journal = new core.DesignAdvisoryJournal(storage)
  // Suggestions and human decisions belong to the project across Hosts. Native
  // requests, notifications and execution bindings remain in this machine's file.
  const conversation = `project:${projectId}`
  const advisoryPath = `design_records/reviews/${Buffer.from(conversation).toString('base64url')}.jsonl`
  const persistRecords = (message, operation, paths = [advisoryPath]) => project.mutateAssessment(async () => {
    for (const path of paths) await core.resolveConfinedFilePath(project.project.root, path)
    const expectedHead = await project.store.head()
    const result = await operation()
    await core.commitDesignProjectRecords({ projectRoot: project.project.root,
      paths, expectedHead, message })
    return result
  })
  const locked = operation => serial(root, async () => {
    await mkdir(root, { recursive: true })
    const lock = join(root, 'review.lock')
    const deadline = Date.now() + 5000
    for (;;) {
      try { await mkdir(lock); break } catch (error) {
        if (error.code !== 'EEXIST') throw error
        if (Date.now() >= deadline) throw new Error(`Review storage is locked: ${lock}. If a service crashed, stop all companion services for this project before removing this empty lock directory.`)
        await delay(50)
      }
    }
    try {
      for (const path of [advisoryPath, 'design_records/clarity.json']) await core.resolveConfinedFilePath(project.project.root, path)
      return await operation()
    } finally { await rmdir(lock) }
  })
  const supported = skill => typeof actionExecutionSupported === 'function' ? actionExecutionSupported(skill) : actionExecutionSupported
  const foreground = request => request.executionMode === 'foreground' && typeof request.manualRequestId === 'string'
  const requireForegroundOwner = request => {
    if (!foreground(request) || request.host !== host || request.threadId !== threadId) throw new Error('Foreground review belongs to its exact main conversation')
  }
  const read = async () => {
    let bytes
    try { bytes = await readFile(file, 'utf8') } catch(error) { if(error.code==='ENOENT')return {schemaVersion:1,projectId,threadId:storageThread,sequence:0,requests:{},notifications:{}};throw error }
    const data = JSON.parse(bytes)
    if(data.schemaVersion!==1 || data.projectId!==projectId || data.threadId!==storageThread || !Number.isSafeInteger(data.sequence) || !data.requests || !data.notifications)throw new Error('Invalid review state identity')
    return data
  }
  const write = async data => {
    await mkdir(root,{recursive:true})
    const temporary = `${file}.${randomUUID()}.tmp`
    try { await writeFile(temporary,JSON.stringify(data),'utf8');await rename(temporary,file) }
    finally { await rm(temporary,{force:true}) }
  }
  // Authority is project-wide, so request ordering must also span native threads.
  const projectRequests = async () => {
    let files
    try { files = await readdir(root) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const requests = []
    for (const name of files) {
      if (!/^reviews-(?:managed|(?:(?:qoder|claude-code|qwenwork|workbuddy)-)?[0-9a-f-]{36})\.json$/i.test(name)) continue
      const data = JSON.parse(await readFile(join(root, name), 'utf8'))
      if (data.projectId !== projectId || data.schemaVersion !== 1) throw new Error('Invalid project review registry')
      requests.push(...Object.values(data.requests))
    }
    return requests
  }
  // Pass the original project read, not a UI wrapper that calls readClarity.
  const currency = async (suppliedWorkspace) => {
    const workspace = suppliedWorkspace ?? await project.readWorkspace()
    // Older hosts retain their full worktree fingerprint (conservative). A
    // missing fingerprint is not proof that two native worktrees are equal.
    const live = workspace.evidenceWorktreeRevision ?? workspace.worktreeRevision
    if (!managedExecution && (typeof live !== 'string' || !live)) throw new Error('Native review requires a worktree revision')
    return { checkpoint:workspace.checkpoint ?? '', worktreeRevision:managedExecution ? `checkpoint:${workspace.checkpoint ?? ''}` : live,
      kit:project.kit.name, version:project.kit.version,
      relationVocabularyRevision:project.kit.relationVocabulary?.revision ?? 'legacy-unavailable' }
  }
  // Keep real checkpoint pins for snapshots/audit. Equivalence is based on the
  // committed tree, not commit messages or newly written authority metadata.
  const evidenceIdentity = async revision => {
    const checkpoint = revision.checkpoint ? await project.store.designEvidenceRevisionAt(revision.checkpoint) : ''
    return {...revision,checkpoint,worktreeRevision:revision.worktreeRevision.startsWith('checkpoint:') ? `checkpoint:${checkpoint}` : revision.worktreeRevision}
  }
  const sameRevision = async (a,b) => {
    if(canonical(a)===canonical(b))return true
    try{return canonical(await evidenceIdentity(a))===canonical(await evidenceIdentity(b))}catch{return false}
  }
  const samePublishedRevision = async (a,b) => a.kit===b.kit && a.version===b.version
    && a.relationVocabularyRevision===b.relationVocabularyRevision
    && await project.store.sameDesignEvidenceAt(a.checkpoint,b.checkpoint)
  const actionsFor = advisory => {
    const spec=advisory.actionSpec
    if(!spec || spec.kind==='none' || spec.kind==='review-choice')return []
    const kit=project.kit
    const target = (skill,entityRefs)=>({kitName:kit.name,kitVersion:kit.version,skillName:skill.name,bundleVersion:skill.version,entityRefs})
    if(spec.kind==='semantic-capability') {
      const skill=core.resolveSemanticCapability(kit,spec.capability)
      return skill ? [{actionId:`capability:${spec.capability}`,target:target(skill,spec.entityRefs)}] : []
    }
    return spec.targets.map(item=>{
      const skill=kit.skills.find(skill=>skill.name===item.skillName)
      if(!skill)throw new Error(`Advisory target not in pinned Kit: ${item.skillName}`)
      return {actionId:`bundle:${skill.name}`,target:target(skill,item.entityRefs)}
    })
  }
  const requireTarget = action => {
    const target=action.target, skill=project.kit.skills.find(skill=>skill.name===target.skillName)
    if(!skill || project.kit.name!==target.kitName || project.kit.version!==target.kitVersion || skill.version!==target.bundleVersion)throw new Error('Action target no longer matches pinned Kit')
    return skill
  }
  const prepare = async ({profile, userContext='', activeWork=[], exactPublication=host==='workbuddy', manualRequestId}, suppliedRevision, inForeground = false) => {
      if(profile!=='clarity' && !Object.hasOwn(PROFILE_IDS,profile))throw new Error('Unknown review profile')
      if(inForeground && (!manualRequestId || !Object.hasOwn(PROFILE_IDS,profile)))throw new Error('Foreground GRA requires an explicit manual request')
      const serviceManaged = managedExecution && !inForeground
      if(typeof userContext!=='string' || userContext.length>8192 || !Array.isArray(activeWork) || canonical(activeWork).length>16384)throw new Error('Invalid review context')
      activeWork=normalizeWork(activeWork)
      const state=await read(), revision=suppliedRevision ?? await currency()
      if(manualRequestId!==undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(manualRequestId))throw new Error('Invalid manual review request ID')
      const relationVocabulary = project.kit.relationVocabulary === undefined ? undefined : clone(project.kit.relationVocabulary)
      if ((relationVocabulary?.revision ?? 'legacy-unavailable') !== revision.relationVocabularyRevision) {
        throw new Error('Kit relation vocabulary changed during review preparation')
      }
      // Old requests instructed reviewers to exclude active Bundles entirely.
      // Do not reuse that obsolete instruction for the new scope semantics.
      const requestKey=digest({method:knowledge?'observed-work-kag-v1':'observed-work',profile,revision:await evidenceIdentity(revision),userContext,activeWork,
        ...(inForeground?{executionMode:'foreground',host,threadId}:{}),
        ...(exactPublication?{publicationCheckpoint:revision.checkpoint}:{})})
      const allRequests=await projectRequests()
      if(manualRequestId!==undefined) {
        const prior=latestRequest(allRequests.filter(item=>item.manualRequestId===manualRequestId),profile)
        if(prior) {
          if((prior.executionMode ?? 'background') !== (inForeground ? 'foreground' : 'background'))throw new Error('Manual request ID cannot change execution mode')
          if(inForeground)requireForegroundOwner(prior)
          if(!await samePublishedRevision(prior.revision,revision))throw new Error('Manual request ID cannot change target')
          if(['prepared','running','completed','stale'].includes(prior.status))return {request:clone(prior),created:false}
        }
      }
      const managed=latestRequest(allRequests.filter(item=>item.execution?.kind==='managed'),profile)
      if(!inForeground && managed && !managedExecution && await samePublishedRevision(managed.revision,revision))throw new Error('This revision uses service-owned reviews. Reopen Companion with --background-reviews; mixed review dispatch modes are unsupported.')
      if(!inForeground && !manualRequestId && managed && (!exactPublication || managed.revision.checkpoint===revision.checkpoint)
        && await samePublishedRevision(managed.revision,revision))return {request:clone(managed),created:false}
      const existing=latestRequest(Object.values(state.requests),profile)
      if(!manualRequestId && existing?.requestKey===requestKey && existing.sequence===latestRequest(allRequests,profile)?.sequence)return {request:clone(existing),created:false}
      const reviewId=randomUUID(), sequence=Math.max(state.sequence, ...allRequests.map(item=>item.sequence), 0)+1
      state.sequence=sequence
      const contract=profile==='clarity' ? undefined : core.officialAdvisoryProfile(PROFILE_IDS[profile])
      const input={schemaVersion:1,runId:reviewId,resultId:'result',pins:[
        {source:'design-worktree',revision:digest(await evidenceIdentity(revision))},
        {source:'relation-vocabulary',revision:revision.relationVocabularyRevision},
      ],facetRefs:project.kit.skills.map(skill=>skill.name),...(userContext?{userContextSummary:userContext}:{})}
      let graphContext, knowledgeError
      if (knowledge && revision.checkpoint) {
        try { graphContext = await knowledge.captureReview(revision.checkpoint) }
        catch (error) { knowledgeError = String(error.message ?? error) }
      }
      const request={reviewId,profile,sequence,requestKey,revision,status:'prepared',createdAt:Date.now(),input,activeWork,
        ...(inForeground?{executionMode:'foreground',host,threadId}:{}),
        ...(exactPublication?{exactPublication:true}:{}),
        ...(manualRequestId?{manualRequestId}:{}),
        ...(relationVocabulary ? {relationVocabulary} : {}),
        ...(graphContext ? { knowledge: { project:graphContext.project, checkpoint:graphContext.checkpoint,
          sourceCheckpoint:graphContext.sourceCheckpoint,
          knowledgeRevision:graphContext.knowledgeRevision, graph:graphContext.graph } } : {}),
        ...(knowledgeError ? { knowledgeError } : {}),
        schema:graphContext && contract ? core.knowledgeReviewSchema(contract.outputSchema, relationVocabulary) : contract?.outputSchema ?? core.DESIGN_CLARITY_OUTPUT_SCHEMA,
        prompt:[contract?.prompt ?? core.DESIGN_CORE_CLARITY_RUBRIC_PROMPT,
          ...(profile==='clarity' ? [core.renderDesignClarityKitContext(project.kit)] : []),
          `Design Project: ${project.project.root}\nDesign Files: ${project.project.designFilesRoot}`,
          `Bound review: ${reviewId}; revision: ${canonical(revision)}.`,
          serviceManaged ? 'Read the supplied immutable Design Files snapshot. It represents the pinned published checkpoint; do not read the live project or seek another revision.' : exactPublication
            ? [
              `Read only Design Files committed at ${revision.checkpoint} in this project. Use design_git_read through the exact private Companion connection supplied for this review, with project=${JSON.stringify(projectId)} and checkpoint=${JSON.stringify(revision.checkpoint)} on every call.`,
              'Start with action=list and path="design_files" to locate evidence; choose relevant regular files for action=read and follow references as needed, rather than reading every file or all history by default. Use action=diff only when changes help resolve the review question, at the same checkpoint; supply from only when an exact comparison baseline is already known, and use a path-filtered diff only with that from pin. Disclose coverage limitations instead of requiring a full-project scan before submission.',
              'For every paged list, read or diff, pass page.nextOffset as offset until page.complete=true and page.nextOffset=null. Preserve project, checkpoint, path and any from pin on every continuation; verify the returned pins match. A partial page is not a complete file, diff or listing.',
              'Do not omit or replace the checkpoint, use live status for a historical checkpoint, invoke system Git commands, or substitute live worktree files or the newest HEAD. If the tool, connection or historical checkpoint is unavailable, a byte limit refuses the read, or a binary response contains metadata only, report the concrete coverage limitation; do not invent contents or change the review target.',
              'A historical publication is intentional; stale results are retained for audit but cannot become current advice or KAG updates.',
            ].join('\n')
            : 'Read current Design Files yourself, explore related evidence as needed. Git and file contents are authoritative; no KAG or design-state prerequisite.',
          `Observed running targets (not an exclusion list): ${canonical(activeWork)}. Native execution may continue after file settlement or resume after a previous pause. Review existing saved evidence; do not skip an entire Bundle just because its agent is alive. Do not diagnose unfinished artifacts as missing completed output. If current editing prevents a reliable check, report the coverage limitation to the parent separately from the structured findings; do not claim full coverage.`,
          userContext ? `Current user context: ${userContext}` : '',
          profile === 'clarity' ? '' : core.renderAdvisoryReviewMemory((await storage.read(conversation)).snapshot.advisories),
          graphContext ? serviceManaged ? core.KNOWLEDGE_AGENTIC_GUIDANCE : NATIVE_REVIEW_KNOWLEDGE_GUIDANCE : '',
          graphContext ? serviceManaged
            ? `Stored KAG bounded context: ${graphContext.context}`
            : `Stored KAG query pins: ${canonical({project:graphContext.project,checkpoint:graphContext.checkpoint,revision:graphContext.knowledgeRevision})}. Read relevant graph evidence through design_query_knowledge when useful; this request does not preload graph contents.`
            : '',
          graphContext && contract ? core.knowledgeReviewGuidance(relationVocabulary) : '',
          graphContext && !serviceManaged ? 'Use design_query_knowledge with these exact project/checkpoint/revision pins for more pages or one-hop neighborhoods. Report knowledgeRelations through the existing review result only.' : '',
          graphContext && serviceManaged ? 'This initial context is bounded. If the service supplies a full pinned read replica and query helper, use it for additional pages or neighborhoods. Otherwise use the supplied source files and endpoint IDs and disclose the limited graph scope.' : '',
          inForeground ? FOREGROUND_REVIEW_COMPLETION_GUIDANCE : serviceManaged ? 'Return only the requested JSON result directly. The service collects your output. Do not bind, submit, notify, spawn agents, edit Design Files, or execute advice.' : NATIVE_REVIEW_COMPLETION_GUIDANCE,
          inForeground ? 'The user chose to occupy this main turn for this review only. Do not describe it as detached or background execution.' : profile==='clarity' ? 'Do not claim a fresh score before this assessment completes. Do not block explicit user work while assessment runs.' : serviceManaged ? 'This is an independent service-owned evaluation, not a child of the main conversation.' : 'Run as a native background reviewer; the main conversation must not wait for this review to continue its independent work.',
        ].filter(Boolean).join('\n\n')}
      if(!request.schema || !request.prompt)throw new Error('Shared review contracts are unavailable')
      state.requests[reviewId]=request;await write(state);return {request:clone(request),created:true}
  }
  // Both execution adapters enter the same schema/freshness/publication boundary.
  // Managed execution is never exposed through the native-child HTTP methods.
  const settleResult = (state, request, result) => project.mutateAssessment(async () => {
      const {reviewId}=request
      if(canonical(result).length>262144)throw new Error('Review result is too large')
      let advisoryResult = result, observations = [], retractions = [], graphError
      if (request.knowledge && request.profile !== 'clarity' && result && typeof result === 'object' && !Array.isArray(result)) {
        const { knowledgeRelations, knowledgeRetractions, ...advisory } = result
        advisoryResult = advisory
        try { const split = core.splitKnowledgeReviewResult({knowledgeRelations,knowledgeRetractions}); observations=split.observations; retractions=split.retractions??[] }
        catch (error) { graphError = String(error.message ?? error) }
      }
      const parsed=request.profile==='clarity' ? core.parseDesignClarityInput(advisoryResult) : core.officialAdvisoryProfile(PROFILE_IDS[request.profile]).parseOutput(advisoryResult)
      const resultDigest=digest(parsed)
      if(request.resultDigest) {
        if(request.resultDigest!==resultDigest)throw new Error('Review ID reused with different result')
        return clone(request.outcome)
      }
      const current=await currency()
      const newer=(await projectRequests()).some(item=>item.profile===request.profile && item.sequence>request.sequence)
      let outcome
      if(newer || !(await sameRevision(request.revision,current))) {
        // Retain the reviewed historical result for audit; never promote it
        // as current advice, current Clarity, or observations in a newer KAG.
        if(request.exactPublication)request.historicalResult=parsed
        outcome={reviewId,status:'stale'}
      }
      else if(request.profile==='clarity') {
        if(!current.checkpoint)throw new Error('Clarity promotion requires a committed checkpoint')
        const report=core.parseDesignClarityReported({...parsed,kit:current.kit,version:current.version,origin:'evaluator',kitContentHash:core.projectKitContentHash(project.kit),digest:core.designClarityDigest(parsed,current.kit,current.version)})
        const mainInput=readMainInput ? await Promise.resolve().then(readMainInput).catch(()=>undefined) : undefined
        const existing=readMainInput ? await core.readDesignClarityAuthority(recordsRoot,projectId) : undefined
        const currentMain=existing?.report.origin==='main-agent'
          && (!mainInput || core.designClarityInputMatches(existing.report,{kit:current.kit,version:current.version,...mainInput})
            && await project.store.sameDesignEvidenceAt(existing.assessedCheckpoint,current.checkpoint))
        // Retain the independent evaluator result without replacing a verified
        // current main-turn assessment with a report lacking its scope pins.
        if(currentMain)request.historicalResult=parsed
        else await persistRecords('Record Design clarity evaluation', () => core.writeDesignClarityAuthority(recordsRoot,{schemaVersion:1,projectId,assessedCheckpoint:request.revision.checkpoint,report}), ['design_records/clarity.json'])
        outcome={reviewId,status:'completed'}
      } else {
        const advisory=core.officialAdvisoryProfile(PROFILE_IDS[request.profile]).project(request.input,parsed)
        const published = await persistRecords('Record Design advisory', () => journal.publish(conversation,advisory))
        outcome={reviewId,status:'completed',...(published.some(entry=>entry.advisory.id===advisory.id) ? {advisoryId:advisory.id} : {duplicateSuppressed:true})}
        if (request.knowledge && (observations.length || retractions.length) && !graphError) {
          try { await knowledge.publishReview({ checkpoint:request.revision.checkpoint,
            sourceCheckpoint:request.knowledge.sourceCheckpoint,
            reviewed:request.knowledge.graph, producer:request.profile, observations, retractions,
            relationVocabulary:request.relationVocabulary }) }
          catch (error) { graphError = String(error.message ?? error) }
        }
        if (graphError) outcome.knowledgeError = graphError
      }
      request.resultDigest=resultDigest;request.outcome=outcome;request.status=outcome.status
      await write(state);return clone(outcome)
  })
  const readReviewStatus = async ({ workspace, activeWork=[] }={}) => {
      const state=await read(), revision=await currency(workspace), work=normalizeWork(activeWork)
      const registry=await projectRequests()
      const observations=new Map()
      return Promise.all([...Object.keys(PROFILE_IDS),'clarity'].map(async profile=>{
        const latest=latestRequest(registry,profile)
        if(latest && !foreground(latest) && await samePublishedRevision(latest.revision,revision) && (latest.execution?.kind==='managed')!==managedExecution)return {
          profile,status:'unavailable',needsReview:false,
          error:'This published revision already has a review in the other dispatch mode. Use the original mode to inspect it, or publish a new design revision before switching. No duplicate review was launched.',
        }
        const request=latestRequest(Object.values(state.requests),profile)
        if(!request)return {profile,status:'due',needsReview:true}
        const changed=!(await sameRevision(request.revision,revision))
        const scopeChanged=request.execution?.kind==='managed' || foreground(request) ? false : canonical(request.activeWork ?? null)!==canonical(work)
        let nativeStatus
        if(request.status==='running' && request.nativeRun && observeReviewRun) {
          const key=canonical(request.nativeRun)
          if(!observations.has(key))observations.set(key,Promise.resolve().then(()=>observeReviewRun(request.nativeRun)).catch(()=>({available:false})))
          const observation=await observations.get(key)
          nativeStatus=observation.available ? observation.recordedStatus : 'unknown'
        }
        const status=request.status==='running' && request.execution?.expiresAt<Date.now() ? 'unknown' : request.status==='running'
          ? nativeStatus==='completed' ? 'unsubmitted'
            : ['failed','interrupted'].includes(nativeStatus) ? nativeStatus
              : nativeStatus==='unknown' ? 'unavailable' : 'running'
          : request.status
        return {profile,reviewId:request.reviewId,status,nativeStatus,executionMode:request.executionMode ?? request.execution?.kind ?? 'native',error:request.error,
          needsReview:changed || scopeChanged || status!=='completed',
          revisionChanged:changed,scopeChanged,
          // Any existing request requires inspection/reuse, not automatic respawn.
          ...(status==='completed' && (changed || scopeChanged) ? {status:'due'} : {})}
      }))
  }
  const listAdvisories = async (workspace) => {
      const entries=await journal.list(conversation), current=await currency(workspace)
      const limit=core.resolveMaxSuggestions((await getSettings()).maxSuggestions)
      const validPins=new Set([digest(await evidenceIdentity(current)),digest(current)])
      // Legacy persisted requests retain their original pins. Prove their
      // evidence still matches; never rewrite history just to keep a card fresh.
      for(const request of await projectRequests()) if(await sameRevision(request.revision,current)) {
        for(const pin of request.input.pins) if(pin.source==='design-worktree')validPins.add(pin.revision)
      }
      return core.currentAdvisoryEntries(entries,limit).map(entry=>({...entry,
        stale:entry.advisory.inputs.some(pin=>pin.source==='design-worktree' && !validPins.has(pin.revision))}))
  }
  const readClarity = async (workspace) => {
      const authority=await core.readDesignClarityAuthority(recordsRoot,projectId)
      // Missing authority means unassessed, never a current score. Keep the
      // display summary consistent with the main-conversation context.
      if(!authority)return {assessment:null,needsReassessment:true}
      const current=await currency(workspace), report=authority.report
      const mainInput=readMainInput ? await Promise.resolve().then(readMainInput).catch(()=>undefined) : undefined
      const request=(await projectRequests()).find(item=>item.reviewId===report.callId)
      return {assessment:{kit:report.kit,version:report.version,u:report.u.score,s:report.s.score,t:report.t.score},
        explanation:{summary:report.summary,u:report.u.evidence,s:report.s.evidence,t:report.t.evidence,
          ...(report.nextGap===undefined?{}:{nextGap:report.nextGap}),assessedCheckpoint:authority.assessedCheckpoint},
        needsReassessment:!(await project.store.sameDesignEvidenceAt(authority.assessedCheckpoint,current.checkpoint)) || report.kit!==current.kit || report.version!==current.version
          || !!request && !(await sameRevision(request.revision,current))
          || !!readMainInput && (!mainInput || !core.designClarityInputMatches(report,{kit:current.kit,version:current.version,...mainInput}))}
  }
  const api = {
    mutateAssessment(operation) { return locked(operation) },
    // One consistent display snapshot under the existing project lock. Mutation
    // and scheduler APIs keep their own authoritative checks; no UI cache is
    // reused as an execution decision.
    readPresentation({ workspace, activeWork = [], includeReviews = true }) { return locked(async () => {
      const reviews = includeReviews ? await readReviewStatus({ workspace, activeWork }) : []
      const clarity = await readClarity(workspace)
      const advisories = await listAdvisories(workspace)
      return { reviews, clarity, advisories }
    }) },
    reviewRevision(workspace) { return currency(workspace) },
    async publishedRevision(checkpoint) {
      if(!/^[a-f0-9]{40,64}$/i.test(checkpoint) || !await project.store.isAncestor(checkpoint,await project.store.head()))throw new Error('Review publication must belong to this project history')
      const revision=await currency()
      const paths=await project.store.listPathsAt(checkpoint)
      // Reuse the exact shared projection algorithm rather than assuming that
      // live bytes still match the just-published checkpoint.
      const projection=await core.projectWorktreeDesign({
        listWorktreeFiles:async()=>paths.map(path=>({path,size:0,mtimeMs:0,ctimeMs:0,ino:0})),
        readWorktreeText:path=>project.store.readTextAt(checkpoint,path),
        readWorktreeBytes:path=>project.store.readBytesAt(checkpoint,path),
      },{},project.kit.skills,checkpoint)
      return {...revision,checkpoint,worktreeRevision:projection.evidenceRevision}
    },
    preparePublicationReviews({revision,context='',cycleId}) { return locked(async()=>{
      const current=await currency()
      if(revision.kit!==current.kit || revision.version!==current.version
        || revision.relationVocabularyRevision!==current.relationVocabularyRevision)throw new Error('Published review Kit pin changed')
      const requests=[]
      for(const profile of Object.keys(PROFILE_IDS)) {
        // Agent initiative may already have admitted this publication before
        // the rule's quiet window expires. Do not create a second evaluator.
        const prior=latestRequest((await projectRequests()).filter(item=>item.revision.checkpoint===revision.checkpoint),profile)
        if(!cycleId && prior && await sameRevision(prior.revision,revision)) {
          requests.push({reviewId:prior.reviewId,profile,status:prior.status,dispatch:false})
          continue
        }
        const {request,created}=await prepare({profile,userContext:context,exactPublication:true,...(cycleId?{manualRequestId:cycleId}:{})},revision)
        requests.push({reviewId:request.reviewId,profile,status:request.status,dispatch:created})
      }
      return {revision,requests,dispatchOwner:'main'}
    }) },
    /** Internal reducer under the existing project-wide review lock. No HTTP mutation surface. */
    publicationQueue(operation) { return locked(async()=>{
      const state=await read()
      const validateTarget=value=>{
        if(!value || typeof value!=='object' || Array.isArray(value) || !/^[a-f0-9]{40,64}$/i.test(value.checkpoint)
          || value.revision?.checkpoint!==value.checkpoint || typeof value.context!=='string'
          || value.context.length>8192 || typeof value.exactPublication!=='boolean'
          || ['worktreeRevision','kit','version','relationVocabularyRevision'].some(key=>typeof value.revision?.[key]!=='string'||!value.revision[key]))throw new Error('Invalid pending review publication')
        for(const key of ['profiles','remainingProfiles'])if(value[key]!==undefined
          && (!Array.isArray(value[key]) || value[key].length>3 || new Set(value[key]).size!==value[key].length
            || value[key].some(profile=>!Object.hasOwn(PROFILE_IDS,profile))))throw new Error('Invalid pending review profiles')
        if(value.manualRequestId!==undefined&&!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(value.manualRequestId))throw new Error('Invalid pending manual request')
        if(value.periodic!==undefined && (typeof value.periodic!=='boolean' || !value.manualRequestId))throw new Error('Invalid periodic review publication')
        return value
      }
      if(state.activePublication) {
        validateTarget(state.activePublication)
        if(!Array.isArray(state.activePublication.remainingProfiles))throw new Error('Invalid active review publication')
      }
      for(const key of ['manualPublications','agentPublications'])if(state[key]!==undefined) {
        if(!Array.isArray(state[key])||state[key].length>10000)throw new Error('Invalid pending review list')
        state[key].forEach(validateTarget)
      }
      const queue=state.publicationQueue===undefined ? new core.DesignReviewPublicationQueue()
        : core.DesignReviewPublicationQueue.restore(state.publicationQueue,validateTarget)
      const result=await operation(queue,state)
      state.publicationQueue=queue.snapshot()
      await write(state)
      return result
    }) },
    // Atomic project-wide claim precedes process launch. A completed/failed/unknown
    // attempt is not silently relaunched for the same revision, even in another UI.
    claimManagedReview({profile,ownerId,userContext='',activeWork=[],revision:targetRevision,exactPublication=false,manualRequestId}) { return locked(async()=>{
      if(!managedExecution)throw new Error('Managed reviews are not enabled')
      if(typeof ownerId!=='string'||!ownerId)throw new Error('Managed execution owner required')
      const saved=await read()
      for(const request of Object.values(saved.requests)) {
        if(request.execution?.kind==='managed' && request.status==='running' && request.execution.expiresAt<Date.now()) {
          request.status='unknown';request.error='Background owner heartbeat expired; no automatic retry.'
        }
      }
      await write(saved)
      const revision=targetRevision ?? await currency()
      if (revision.kit!==project.kit.name || revision.version!==project.kit.version
        || revision.relationVocabularyRevision!==(project.kit.relationVocabulary?.revision ?? 'legacy-unavailable')) throw new Error('Review target Kit changed')
      if(!revision.checkpoint)return null
      const candidates=(await projectRequests()).filter(item=>item.profile===profile)
      const prior=exactPublication ? candidates.find(item=>item.revision.checkpoint===revision.checkpoint) : latestRequest(candidates,profile)
      if(!manualRequestId && prior && await samePublishedRevision(prior.revision,revision))return null
      const {request}=await prepare({profile,userContext,activeWork,exactPublication,manualRequestId},revision)
      const state=await read(), stored=state.requests[request.reviewId]
      if(!stored || stored.status!=='prepared')return null
      stored.execution={kind:'managed',ownerId,attemptId:randomUUID(),expiresAt:Date.now()+60000}
      stored.status='running'
      await write(state)
      return clone(stored)
    }) },
    renewManagedOwner(ownerId) { return locked(async()=>{
      const state=await read()
      for(const request of Object.values(state.requests))if(request.status==='running' && request.execution?.ownerId===ownerId && request.execution.expiresAt>=Date.now())request.execution.expiresAt=Date.now()+60000
      await write(state)
    }) },
    finishManagedReview({reviewId,ownerId,attemptId,result,status,error,nativeRunId}) { return locked(async()=>{
      const state=await read(), request=state.requests[reviewId]
      if(!request || request.execution?.kind!=='managed' || request.execution.ownerId!==ownerId
        || request.execution.attemptId!==attemptId)throw new Error('Managed execution ownership mismatch')
      if(request.resultDigest)return settleResult(state,request,result)
      if(request.status!=='running')throw new Error('Managed review already ended')
      if(request.execution.expiresAt<Date.now()) {
        request.status='unknown';await write(state)
        throw new Error('Managed execution owner expired')
      }
      if(nativeRunId!==undefined) {
        requireNativeId(host,nativeRunId)
        request.execution.nativeRunId=nativeRunId
      }
      if(status) {
        if(!['failed','interrupted','unknown'].includes(status))throw new Error('Invalid managed terminal status')
        request.status=status;request.error=String(error??status).slice(0,1000)
        await write(state);return {reviewId,status}
      }
      return settleResult(state,request,result)
    }) },
    prepareReview(params) { return locked(async()=> (await prepare(params)).request) },
    prepareManualReviews({requestId,profiles=['grounding','reflection','alignment'],userContext='',executionMode='background'}) { return locked(async()=>{
      if(!['background','foreground'].includes(executionMode))throw new Error('Invalid manual GRA execution mode')
      if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(requestId)
        ||!Array.isArray(profiles)||!profiles.length||profiles.length>3||new Set(profiles).size!==profiles.length
        ||profiles.some(profile=>!Object.hasOwn(PROFILE_IDS,profile)))throw new Error('Invalid manual GRA profiles')
      const current=await currency()
      const revision=await api.publishedRevision(current.checkpoint),requests=[]
      // Managed services use published evidence currency, not live-worktree
      // currency. A main-conversation review retains that same boundary.
      if(executionMode==='foreground' && managedExecution)revision.worktreeRevision=current.worktreeRevision
      for(const profile of profiles) {
        const latest=latestRequest(await projectRequests(),profile)
        const active=latest?.status==='running' && (latest.executionMode ?? 'background')===executionMode ? latest : undefined
        let reuseActive=active && await sameRevision(active.revision,revision)
        if(reuseActive && observeReviewRun) {
          const state=await read(), local=state.requests[active.reviewId]
          if(local?.status==='running' && local.nativeRun && local.execution?.kind!=='managed') {
            const observation=await Promise.resolve().then(()=>observeReviewRun(local.nativeRun)).catch(()=>({available:false}))
            // Only an explicit recheck retires a confirmed local failure; status reads stay pure.
            if(observation?.available && ['failed','interrupted'].includes(observation.recordedStatus)) {
              local.status=observation.recordedStatus
              await write(state)
              reuseActive=false
            }
          }
        }
        if(reuseActive) {
          requests.push({reviewId:active.reviewId,profile,status:active.status,dispatch:false,created:false})
          continue
        }
        const item=await prepare({profile,userContext,manualRequestId:requestId,exactPublication:true},revision,executionMode==='foreground')
        requests.push({reviewId:item.request.reviewId,profile,status:item.request.status,dispatch:item.created,created:item.created,executionMode})
      }
      return {revision,requests,dispatchOwner:'main',executionMode}
    }) },
    prepareReviews({profiles, userContext='', activeWork=[]}) { return locked(async()=>{
      if(typeof userContext!=='string' || userContext.length>8192 || !Array.isArray(activeWork) || canonical(activeWork).length>16384)throw new Error('Invalid review context')
      const automatic=profiles===undefined
      if(automatic)profiles=Object.keys(PROFILE_IDS)
      if(!Array.isArray(profiles) || !profiles.length || profiles.length>4 || new Set(profiles).size!==profiles.length
        || profiles.some(profile=>profile!=='clarity' && !Object.hasOwn(PROFILE_IDS,profile)))throw new Error('Select one to four distinct review profiles')
      const revision=await currency(), requests=[], work=normalizeWork(activeWork)
      for(const profile of profiles) {
        if(automatic) {
          const prior=latestRequest(Object.values((await read()).requests),profile)
          if(prior && prior.sequence===latestRequest(await projectRequests(),profile)?.sequence
            && await sameRevision(prior.revision,revision) && canonical(prior.activeWork ?? null)===canonical(work)) {
            requests.push({reviewId:prior.reviewId,profile,status:prior.status,created:false,nativeRun:prior.nativeRun ?? null})
            continue
          }
        }
        const {request,created}=await prepare({profile,userContext,activeWork},revision)
        requests.push({reviewId:request.reviewId,profile,status:request.status,created,nativeRun:request.nativeRun ?? null})
      }
      // Registry locking does not lock Design Files. Never describe this as a file snapshot.
      const revisionChanged=!(await sameRevision(revision,await currency()))
      return {revision,revisionChanged,requests:requests.map(request=>({...request,dispatch:request.created && !revisionChanged}))}
    }) },
    readReview({reviewId}) { return locked(async()=>{
      const state=await read(), request=Object.hasOwn(state.requests,reviewId)?state.requests[reviewId]:undefined
      if(!request)throw new Error('Unknown review ID')
      if(foreground(request))requireForegroundOwner(request)
      const revisionChanged=!(await sameRevision(request.revision,await currency()))
      const superseded=(await projectRequests()).some(item=>item.profile===request.profile && item.sequence>request.sequence)
      const result=clone(request)
      // Keep the captured graph in service storage for result validation, not
      // as a second model-facing copy. Reviewers query evidence with its pins.
      if(result.knowledge)delete result.knowledge.graph
      return {...result,revisionChanged,superseded}
    }) },
    // Atomic registry writes make this read-only snapshot safe without waiting
    // behind review execution/currency work. A later binding reprojects on the
    // next poll; an absent binding never grants role or execution authority.
    readPresentationBindings() { return read().then(state => Object.values(state.requests).map(request=>({
      reviewId:request.reviewId, profile:request.profile, runId:request.nativeRun?.runId,
    }))) },
    readReviewStatus({ workspace, activeWork=[] }={}) { return locked(() => readReviewStatus({ workspace, activeWork })) },
    bindReviewRun({reviewId,nativeRun}) { return locked(async()=>{
      const state=await read(), request=Object.hasOwn(state.requests,reviewId)?state.requests[reviewId]:undefined
      if(!request)throw new Error('Unknown review ID')
      if(foreground(request))throw new Error('Foreground review is submitted by its main conversation without a child binding')
      if(request.execution?.kind==='managed')throw new Error('Review is owned by the background service')
      if(!nativeRun || typeof nativeRun.runId!=='string'
        || nativeRun.parentRunId!==threadId || typeof nativeRun.transcriptPath!=='string' || !isAbsolute(nativeRun.transcriptPath))throw new Error('Exact native review child binding required')
      requireNativeId(host,nativeRun.runId)
      if(['qoder','qwenwork'].includes(host) && (typeof nativeRun.taskPath!=='string'||!isAbsolute(nativeRun.taskPath)))throw new Error('Exact native task file required')
      const binding={runId:nativeRun.runId,parentRunId:nativeRun.parentRunId,transcriptPath:nativeRun.transcriptPath,...(['qoder','qwenwork'].includes(host)?{taskPath:nativeRun.taskPath}:{})}
      if(request.nativeRun && canonical(request.nativeRun)!==canonical(binding))throw new Error('Review cannot be rebound to another native child')
      if(!request.nativeRun && request.status!=='prepared')throw new Error('Review already settled')
      await bindNativeProject({ stateRoot, runId: binding.runId, projectId, host, sessionId:threadId })
      if(!request.nativeRun) {
        request.nativeRun=binding;request.status='running';await write(state)
      }
      return clone(request)
    }) },
    submitReview({reviewId,result,nativeRun}) { return locked(async()=>{
      const state=await read(), request=Object.hasOwn(state.requests,reviewId)?state.requests[reviewId]:undefined
      if(!request)throw new Error('Unknown review ID')
      if(foreground(request)) {
        requireForegroundOwner(request)
        if(nativeRun!==undefined)throw new Error('Foreground main review must omit nativeRun')
        return settleResult(state,request,result)
      }
      if(!request.nativeRun || canonical(request.nativeRun)!==canonical(nativeRun))throw new Error('Result must match the registered native reviewer')
      await bindNativeProject({ stateRoot, runId: nativeRun.runId, projectId, host, sessionId:threadId })
      return settleResult(state,request,result)
    }) },
    listAdvisories(workspace) { return locked(() => listAdvisories(workspace)) },
    decideAdvisory(params) { return locked(async()=>{
      const before=(await journal.list(conversation)).find(entry=>entry.advisory.id===params.advisoryId)
      if(!before)throw new Error('Unknown advisory')
      const resolved=params.decision==='accepted'?actionsFor(before.advisory):[]
      if(resolved.some(action=>!supported(requireTarget(action))))throw new Error('Native advisory action execution is unsupported; no acceptance recorded')
      const entries=await persistRecords('Record Design advisory decision', () => journal.decide(conversation,params,resolved))
      const entry=entries.find(entry=>entry.advisory.id===params.advisoryId)
      if(params.decision!=='accepted')return entry
      const state=await read(), receipt=entry.acceptanceReceiptId
      if(state.notifications[receipt])return {...entry,notification:'sent'}
      try {
        const response=await project.sendPrompt({text:[
          'The user explicitly accepted this Design advisory. Revalidate against current files before acting.',
          entry.advisory.acceptanceInstruction ?? entry.advisory.summary,
          `Acceptance receipt (selection evidence only): ${receipt}`,
          `Exact action receipts (acceptance receipt is NOT execution authority): ${canonical(entry.actionReceipts ?? [])}`,
          'Use the native action binding path to claim each exact receipt. Notification delivery is not execution. No unrelated work is authorized.',
        ].join('\n\n')})
        if(response?.accepted!==true)throw new Error('Native notification was not acknowledged')
        state.notifications[receipt]=true;await write(state)
        return {...entry,notification:'sent'}
      } catch(error) {return {...entry,notification:'failed',notificationError:String(error.message ?? error)}}
    }) },
    readReviewAction({advisoryId}) { return locked(async()=>{
      const snapshot=await storage.read(conversation)
      const entry=snapshot.snapshot.advisories.find(item=>item.advisory.id===advisoryId)
      if(entry?.advisory.actionSpec?.kind!=='review-choice')throw new Error('No agentic choice for this advisory')
      return {entry,revision:snapshot.revision,currency:await currency(),
        candidates:project.kit.skills.map(skill=>({skillName:skill.name,bundleVersion:skill.version,
          description:skill.description,review_support:core.reviewSupportOf(skill)}))}
    }) },
    selectReviewAction(params) { return locked(async()=>{
      if(canonical(params.currency)!==canonical(await currency()))throw new Error('Selection context changed; read options and revalidate again')
      const entry=(await journal.list(conversation)).find(item=>item.advisory.id===params.advisoryId)
      if(entry?.advisory.actionSpec?.kind!=='review-choice')throw new Error('No agentic choice for this advisory')
      const skill=params.kind==='bundle'?project.kit.skills.find(item=>item.name===params.skillName):undefined
      if(params.kind==='bundle' && (!skill || !supported(skill)))throw new Error('Selected Bundle execution is unavailable')
      if(params.kind!=='bundle' && params.skillName!==undefined)throw new Error('Host choice cannot carry a Bundle target')
      return persistRecords('Record Design advisory follow-up', () => journal.selectReviewAction(conversation,{
        advisoryId:params.advisoryId,acceptanceReceiptId:params.acceptanceReceiptId,
        kind:params.kind,reason:params.reason,expectedJournalRevision:params.revision,
      },skill?{actionId:`bundle:${skill.name}`,target:{kitName:project.kit.name,kitVersion:project.kit.version,
        skillName:skill.name,bundleVersion:skill.version,entityRefs:entry.advisory.actionSpec.entityRefs}}:undefined))
    }) },
    claimReviewAction({receiptId,nativeBinding}) { return locked(async()=>{
      const entry=(await journal.list(conversation)).flatMap(entry=>entry.actionReceipts ?? []).find(action=>action.receiptId===receiptId)
      if(!entry)throw new Error('Unknown action receipt')
      if(!supported(requireTarget(entry)))throw new Error('Native advisory action execution is unsupported')
      const main = nativeBinding?.mode === 'main' && nativeBinding.mainThreadId === threadId && !nativeBinding.finished
        && project.kit.skills.find(skill=>skill.name===nativeBinding.skill)?.execution.mode==='main'
      const child = nativeBinding?.role === 'producer' && nativeBinding.parentRunId===threadId
        && nativeInvocationId(host,threadId,nativeBinding.runId)===nativeBinding.invocationId
      if(!nativeBinding || nativeBinding.projectId!==projectId || (!main && !child)
        || nativeBinding.skill!==entry.target.skillName)throw new Error('Bundle invocation must match the exact advisory target')
      const bindingKey = nativeBinding.runId ?? nativeBinding.invocationId
      const state=await read()
      state.claims ??= {}
      const prior=state.claims[receiptId]
      if(prior && prior.runId!==bindingKey && !['failed','needs-user-input'].includes(entry.state))throw new Error('Action is bound to another Bundle invocation')
      if(prior?.runId===bindingKey) {
        if(entry.state==='running' && entry.attemptId===prior.claim.attemptId)return clone(prior.claim)
        throw new Error('Native Producer attempt already settled; retry requires a new native Producer')
      }
      const claim=await persistRecords('Record Design advisory action attempt', () => journal.claimActionExecution(conversation,{receiptId,proposedInvocationId:nativeBinding.invocationId}))
      if(!claim.claimed && (claim.action.state!=='running' || claim.effectiveInvocationId!==nativeBinding.invocationId))throw new Error('Action already claimed or completed')
      state.claims[receiptId]={runId:bindingKey,claim};await write(state)
      return claim
    }) },
    settleReviewAction({receiptId,state:outcome,nativeBinding}) { return locked(async()=>{
      if(!supported(project.kit.skills.find(skill=>skill.name===nativeBinding?.skill)))throw new Error('Native advisory action execution is unsupported')
      const data=await read(), bound=data.claims?.[receiptId]
      if(!bound || bound.runId!==(nativeBinding?.runId ?? nativeBinding?.invocationId))throw new Error('Action settlement must belong to its Bundle invocation')
      return persistRecords('Record Design advisory action outcome', () => journal.settleActionExecution(conversation,{receiptId,attemptId:bound.claim.attemptId,state:outcome}))
    }) },
    readClarity(workspace) { return locked(() => readClarity(workspace)) },
  }
  return api
}
