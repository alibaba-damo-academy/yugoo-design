/**
 * Research panel adapter: projects direct artifact references into the
 * original `IResearchPanel` payload and renders the strict-fidelity ported
 * ResearchPanel family. Artifact content is loaded through `readArtifact` and
 * cached per relative path.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { requestLivePoll, subscribeLivePoll } from 'dsh-design-panel/client-api'
import { isRecord, type ResearchDirection, type ResearchState } from '../types.ts'
import { useLang } from '../ported/host.ts'
import { ResearchPanel as ResearchPanelView } from '../ported/design/ResearchPanel/index.ts'
import type {
  IDirectionTraceEntry,
  IResearchDirectionItem,
  IResearchPanel,
  IResearchRound,
} from '../ported/design/ResearchPanel/researchTypes.ts'
import type { ExecutionLogRead, SkillPanelProps } from './shared.ts'
import { projectResearchPanelState, researchDirectionArtifactId } from './research-panel-projection.ts'
import { projectArtifactExecution, projectArtifactExecutionLogRunId, projectArtifactReceipt, projectRootExecution } from './artifact-status-projection.ts'
import {
  projectTextArtifactView,
  useTextArtifactContents,
  type TextArtifactEntry,
} from './artifact-text-hydration.ts'

const PANEL_ID = 'research'
const EMPTY_READ_EXECUTION_LOG = (): Promise<ExecutionLogRead> => Promise.resolve({ found: false, revision: null, reset: false, entries: [] })

type ArtifactContents = Readonly<Record<string, string | null>>

/** Trace event types the ported family renders icons for. */
const TRACE_EVENT_TYPES = new Set(['message', 'search', 'fetch', 'synthesize', 'error'])

function traceEntry(entry: ExecutionLogRead['entries'][number]): IDirectionTraceEntry {
  return {
    timestamp: entry.timestamp,
    event_type: TRACE_EVENT_TYPES.has(entry.eventType) ? entry.eventType : 'search',
    message: entry.message,
    url: entry.url ?? null,
  }
}

function directionItem(
  direction: ResearchDirection,
  findings: string | null | undefined,
  trace: readonly IDirectionTraceEntry[] = [],
  traceUnavailable = false,
): IResearchDirectionItem {
  const view = projectTextArtifactView(direction.findings_file, undefined, findings)
  return {
    direction_id: direction.direction_id,
    title: direction.title,
    source: direction.source ?? 'analysis',
    status: direction.status ?? 'pending',
    research_points: direction.research_points ?? [],
    source_urls: direction.source_urls ?? [],
    findings: view.content,
    findings_loading: view.loading,
    findings_available: view.available,
    findings_file: direction.findings_file ?? null,
    trace: [...trace],
    trace_unavailable: traceUnavailable,
  }
}

export interface ExecutionTracePollState {
  readonly traces: Readonly<Record<string, readonly IDirectionTraceEntry[]>>
  readonly unavailable: Readonly<Record<string, boolean>>
  readonly runIds: Readonly<Record<string, string>>
}

export type ExecutionTracePollResult = Readonly<{
  artifactId: string
  runId: string
  read?: ExecutionLogRead
  rejected?: boolean
  append?: boolean
}>

/** Merge independent log reads without discarding another direction's last-good trace. */
export function mergeExecutionTracePoll(
  previous: ExecutionTracePollState,
  refs: readonly (readonly [artifactId: string, runId: string])[],
  results: readonly ExecutionTracePollResult[],
): ExecutionTracePollState {
  const wanted = new Map(refs)
  const traces: Record<string, readonly IDirectionTraceEntry[]> = Object.fromEntries(
    Object.entries(previous.traces).filter(([artifactId]) => previous.runIds[artifactId] === wanted.get(artifactId)),
  )
  const unavailable: Record<string, boolean> = Object.fromEntries(
    Object.entries(previous.unavailable).filter(([artifactId, value]) => value && previous.runIds[artifactId] === wanted.get(artifactId)),
  )
  for (const result of results) {
    if (wanted.get(result.artifactId) !== result.runId) continue
    if (result.rejected) {
      unavailable[result.artifactId] = true
      continue
    }
    delete unavailable[result.artifactId]
    if (result.read?.found) {
      const next = result.read.entries.map(traceEntry)
      traces[result.artifactId] = result.append
        ? Object.freeze([...(traces[result.artifactId] ?? []), ...next])
        : next
    }
  }
  return { traces, unavailable, runIds: Object.fromEntries(refs) }
}

/** Convert one projected round plus artifact load results into ported view data. */
export function researchRoundItem(
  round: NonNullable<ResearchState['rounds']>[string],
  contents: ArtifactContents,
  traces: Readonly<Record<string, readonly IDirectionTraceEntry[]>> = {},
  traceUnavailable: Readonly<Record<string, boolean>> = {},
  producer = projectRootExecution(),
): IResearchRound {
  const directions = round.directions ?? {}
  const order = round.direction_order ?? Object.keys(directions)
  const conclusionRef = round.conclusion_file ?? null
  const conclusion = projectTextArtifactView(
    conclusionRef,
    undefined,
    conclusionRef ? contents[conclusionRef] : undefined,
  )
  return {
    round_id: round.round_id,
    topic: round.topic ?? round.round_id,
    stage: round.stage ?? 'identified',
    producer_status: producer.status,
    producer_run_id: producer.runId,
    conclusion: conclusion.content,
    conclusion_loading: conclusion.loading,
    conclusion_available: conclusion.available,
    conclusion_file: conclusionRef,
    directions: order
      .map((id) => directions[id])
      .filter((direction) => direction !== undefined)
      .map((direction) => directionItem(
        direction,
        direction.findings_file ? contents[direction.findings_file] : undefined,
        traces[researchDirectionArtifactId(round.round_id, direction.direction_id)] ?? traces[direction.direction_id],
        traceUnavailable[researchDirectionArtifactId(round.round_id, direction.direction_id)] === true
          || traceUnavailable[direction.direction_id] === true,
      )),
    created_at: round.created_at,
    updated_at: round.updated_at,
  }
}

/** Poll native child logs independently from Design Files state polling. */
function useExecutionTraces(
  attempts: NonNullable<SkillPanelProps['executionAttempts']>,
  readExecutionLog: NonNullable<SkillPanelProps['readExecutionLog']>,
): ExecutionTracePollState {
  const refs = useMemo(() => {
    const ids = [...new Set(attempts
      .filter(attempt => attempt.artifactKind === 'research_direction')
      .map(attempt => attempt.artifactId))]
    return ids.flatMap(artifactId => {
      const runId = projectArtifactExecutionLogRunId(artifactId, attempts, 'research_direction')
      return runId === undefined ? [] : [[artifactId, runId] as const]
    }).sort(([left], [right]) => left.localeCompare(right))
  }, [attempts])
  const activeRunIds = useMemo(() => new Set(refs.flatMap(([artifactId, runId]) => {
    const execution = projectArtifactExecution(artifactId, attempts, 'research_direction')
    return execution.runId === runId && (execution.status === 'queued' || execution.status === 'working') ? [runId] : []
  })), [attempts, refs])
  const key = refs.map(([artifactId, runId]) => `${artifactId}:${runId}:${activeRunIds.has(runId) ? 'active' : 'terminal'}`).join('\0')
  const [state, setState] = useState<ExecutionTracePollState>({ traces: {}, unavailable: {}, runIds: {} })
  const observedRevisions = useRef(new Map<string, string>())
  const cursors = useRef(new Map<string, number>())
  const visibleState = useMemo(
    () => mergeExecutionTracePoll(state, refs, []),
    [state, key],
  )
  useEffect(() => {
    if (refs.length === 0) {
      setState({ traces: {}, unavailable: {}, runIds: {} })
      return
    }
    setState(previous => mergeExecutionTracePoll(previous, refs, []))
    const wantedRevisions = new Set(refs.map(([artifactId, runId]) => `${artifactId}\0${runId}`))
    for (const identity of observedRevisions.current.keys()) {
      if (!wantedRevisions.has(identity)) observedRevisions.current.delete(identity)
    }
    for (const identity of cursors.current.keys()) {
      if (!wantedRevisions.has(identity)) cursors.current.delete(identity)
    }
    let disposed = false
    let running = false
    let unsubscribe: (() => void) | undefined
    const terminalFailures = new Map<string, number>()
    const poll = async (): Promise<void> => {
      if (disposed || running) return
      const selected = refs.filter(([artifactId, runId]) => (
        activeRunIds.has(runId) || (terminalFailures.get(`${artifactId}\0${runId}`) ?? 0) < 8
      ))
      if (selected.length === 0) return
      running = true
      try {
        const results = await Promise.all(selected.map(async ([artifactId, runId]): Promise<ExecutionTracePollResult> => {
          const identity = `${artifactId}\0${runId}`
          const afterSeq = cursors.current.get(identity)
          try {
            const read = await readExecutionLog(runId, afterSeq)
            return { artifactId, runId, read, append: afterSeq !== undefined && !read.reset }
          } catch {
            return { artifactId, runId, rejected: true }
          }
        }))
        if (!disposed) {
          let changed = false
          for (const result of results) {
            const identity = `${result.artifactId}\0${result.runId}`
            if (result.read?.found) {
              const lastSeq = result.read.entries.at(-1)?.seq
              if (lastSeq !== undefined) cursors.current.set(identity, lastSeq)
              terminalFailures.set(identity, 8)
            } else if (!activeRunIds.has(result.runId)) {
              terminalFailures.set(identity, (terminalFailures.get(identity) ?? 0) + 1)
            }
            const marker = result.rejected
              ? 'rejected'
              : result.read?.found ? `revision:${result.read.revision ?? 'none'}` : 'missing'
            const prior = observedRevisions.current.get(identity)
            if (prior !== marker) {
              observedRevisions.current.set(identity, marker)
              changed = true
            }
          }
          if (changed) setState(previous => mergeExecutionTracePoll(previous, refs, results))
          if (activeRunIds.size === 0 && refs.every(([artifactId, runId]) => (
            (terminalFailures.get(`${artifactId}\0${runId}`) ?? 0) >= 8
          ))) unsubscribe?.()
        }
      } finally {
        running = false
      }
    }
    void poll()
    unsubscribe = subscribeLivePoll(() => { void poll() })
    requestLivePoll()
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [activeRunIds, key, readExecutionLog, refs])
  return visibleState
}

/** Every artifact path referenced by the state, stable across renders. */
function artifactEntries(
  state: ResearchState,
  attempts: NonNullable<SkillPanelProps['executionAttempts']> = [],
): TextArtifactEntry[] {
  const rounds = state.rounds ?? {}
  const entries = new Map<string, TextArtifactEntry>()
  for (const id of state.round_order ?? Object.keys(rounds)) {
    const round = rounds[id]
    if (round === undefined) continue
    if (round.conclusion_file) entries.set(round.conclusion_file, {
      id: round.conclusion_file,
      path: round.conclusion_file,
      cacheKey: `path:${round.conclusion_file}`,
    })
    const directions = round.directions ?? {}
    for (const directionId of round.direction_order ?? Object.keys(directions)) {
      const file = directions[directionId]?.findings_file
      if (file) {
        const artifactId = researchDirectionArtifactId(round.round_id, directionId)
        const receipt = projectArtifactReceipt(artifactId, attempts, 'research_direction', file)
        entries.set(file, {
          id: file,
          path: file,
          cacheKey: receipt === undefined ? `path:${file}` : `receipt:${receipt.sha256}`,
        })
      }
    }
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))
}

/** Adapter props for the hydrated research view. */
export interface IResearchPanelAdapterProps extends SkillPanelProps {
  /** Prevent interaction while the host is saving the current draft set. */
  running?: boolean
}

/** The panel body. */
export function ResearchPanel(props: IResearchPanelAdapterProps): ReactElement {
  const t = useLang()
  const authored = (isRecord(props.draft) ? props.draft : {}) as ResearchState
  const state = useMemo(
    () => projectResearchPanelState(authored, props.executionAttempts, props.artifactFiles),
    [authored, props.executionAttempts, props.artifactFiles],
  )
  const entries = useMemo(
    () => artifactEntries(state, props.executionAttempts ?? []),
    [props.executionAttempts, state],
  )
  const contents = useTextArtifactContents(entries, props.readArtifact, props.originalState, props.artifactFiles)
  const traceState = useExecutionTraces(
    props.executionAttempts ?? [],
    props.readExecutionLog ?? EMPTY_READ_EXECUTION_LOG,
  )
  const data = useMemo<IResearchPanel>(() => {
    const rounds = state.rounds ?? {}
    const order = state.round_order ?? Object.keys(rounds)
    return {
      panel_id: PANEL_ID,
      title: String(t.research_analysis),
      type: 'research',
      rounds: order
        .map((id) => rounds[id])
        .filter((round) => round !== undefined)
        .map((round) => {
          const current = round.round_id === state.current_round_id
          const producer = projectRootExecution(current ? (props.executionAttempts ?? []) : [])
          return researchRoundItem(
            round,
            contents,
            current ? traceState.traces : {},
            current ? traceState.unavailable : {},
            producer,
          )
        }),
      current_round_id: state.current_round_id ?? null,
    }
  }, [state, contents, traceState, t])
  return <ResearchPanelView data={data} />
}

export default ResearchPanel
