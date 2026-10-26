/** Attached native Bundle execution. Never starts a model or grants GRA readiness. */
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute } from 'node:path'
import { readCodexHeader } from './conversation-start.mjs'
import { createCodexTranscript } from './codex-transcript.mjs'
import { resolveNativeRun } from './native-run-resolution.mjs'
import { readCodexDesktopEvents, codexDesktopLaunches, validCodexDesktopLaunch } from './codex-desktop-background.mjs'

async function header(path, expected) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!(await file.stat()).isFile()) throw Error('Native Bundle transcript must be a regular file.')
    await readCodexHeader(file, expected)
  } finally { await file.close() }
}

export async function createCodexDesktopExecutionAdapter(context) {
  const { sessionId, projectRoot, mainTranscriptPath, startedAt, getParentBinding } = context
  if (!isAbsolute(mainTranscriptPath ?? '') || !isAbsolute(projectRoot ?? '') || !Number.isFinite(startedAt)) {
    throw Error('Codex desktop native Bundles require the exact main transcript, cwd and connection boundary.')
  }
  await header(mainTranscriptPath, { threadId: sessionId, projectRoot })

  const parent = input => {
    const parentRunId = input.parentRunId ?? sessionId
    if (parentRunId === sessionId) return { parentRunId, path: mainTranscriptPath }
    const binding = getParentBinding?.(parentRunId)
    if (!binding || binding.runId !== parentRunId || binding.role !== 'producer'
      || binding.parentRunId !== sessionId || !isAbsolute(binding.transcriptPath ?? '')) {
      throw Error('Nested Worker requires its exact registered Producer parent.')
    }
    return { parentRunId, path: binding.transcriptPath, binding }
  }

  return {
    protocol: { mode: 'native-attached', launch: { tool: 'collaboration.spawn_agent', fork_turns: 'none' },
      roles: ['producer', 'worker'],
      instruction: 'Use the declared Bundle placement and native-execution reference. Each child must consume its exact Bundle method and registered target before editing. Register its actual launch; a nested Worker belongs to its real Producer, a main Worker to the exact main invocation. Native completion, artifact receipt and file publication are separate.',
      limitation: 'This route does not establish detached GRA readiness, Studio trial support, or successful execution.' },
    async resolveRun(input) {
      const p = parent(input)
      const rows = await readCodexDesktopEvents(p.path,
        { sessionId, projectRoot, ...(p.binding ? { runId: p.parentRunId } : {}) }, p.binding?.parentRunId)
      const now = Date.now()
      const matches = codexDesktopLaunches(rows, startedAt, now).filter(launch =>
        validCodexDesktopLaunch(launch, startedAt, now)
        && (!input.runId || input.runId === launch.runId)
        && (!input.launchCallId || input.launchCallId === launch.callId)
        && (!input.agentPath || input.agentPath === launch.agentPath))
      if (!input.runId && !input.launchCallId && !input.agentPath) throw Error('Exact native Bundle launch reference required.')
      const ids = new Set(matches.map(launch => launch.runId))
      if (ids.size !== 1) throw Error('Current native Bundle launch is missing, foreign or ambiguous.')
      const [runId] = ids
      // Lookup by the observed UUID avoids the generic whole-parent launch scan.
      return resolveNativeRun({ runId, parentRunId: p.parentRunId, transcriptPath: input.transcriptPath },
        { host: 'codex', threadId: sessionId, mainTranscriptPath, parentBinding: p.binding })
    },
    async verifyChild(input) {
      const p = parent(input)
      await header(input.transcriptPath, { threadId: input.runId, parentRunId: p.parentRunId, projectRoot })
      const observed = await createCodexTranscript({ path: input.transcriptPath, threadId: input.runId,
        parentRunId: p.parentRunId, projectRoot }).read()
      if (!observed.available) throw Error(observed.error ?? 'Native Bundle child evidence is unavailable.')
      return observed
    },
    async verifyAssignment(input, expected, connectionPath) {
      if (!expected || !isAbsolute(connectionPath ?? '')) throw Error('Exact native Bundle method authority is unavailable.')
      const rows = await readCodexDesktopEvents(input.transcriptPath,
        { sessionId, runId: input.runId, projectRoot }, input.parentRunId, true)
      const meta = rows.find(row => row.type === 'session_meta')
      const start = rows.find(row => row.type === 'event_msg' && row.payload?.type === 'task_started')
      const turn = start?.payload?.turn_id, created = Date.parse(meta?.payload?.timestamp ?? meta?.timestamp)
      const began = Date.parse(start?.timestamp), now = Date.now()
      const terminal = rows.find(row => row.type === 'event_msg' && row.payload?.turn_id === turn
        && ['task_complete', 'task_completed', 'turn_aborted', 'task_failed', 'error'].includes(row.payload.type))
      const ended = terminal ? Date.parse(terminal.timestamp) : now
      if (!turn || ![created, began, ended].every(Number.isFinite) || created < startedAt || began < created || ended < began || ended > now) {
        throw Error('Native Bundle first-turn consumption boundary is unavailable.')
      }
      const reads = rows.flatMap(row => {
        const q = row.payload, item = q?.item, at = Date.parse(row.timestamp)
        if (row.type !== 'event_msg' || q?.type !== 'item_completed' || q.turn_id !== turn
          || item?.type !== 'McpToolCall' || item.server !== 'design-system' || item.tool !== 'design_prepare_bundle'
          || item.status !== 'completed' || item.error !== undefined || item.arguments?.connection !== connectionPath
          || item.result?.isError !== undefined && item.result.isError !== false || item.result?.error !== undefined
          || ![at, q.started_at_ms, q.completed_at_ms].every(Number.isFinite)
          || q.started_at_ms < Math.max(startedAt, created, began) || q.completed_at_ms < q.started_at_ms
          || q.completed_at_ms > at || at >= ended || at > now) return []
        const content = item.result?.content
        if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text') return []
        try { return [{ args: item.arguments, value: JSON.parse(content[0].text) }] } catch { return [] }
      })
      if (reads.some(read => read.args.skill !== expected.skill || read.value?.skill !== expected.skill)) {
        throw Error('Native child consumed a conflicting Bundle assignment.')
      }
      if (!reads.some(({ value }) => value?.skill === expected.skill && value.version === expected.version
        && value.kit?.name === expected.kit.name && value.kit?.version === expected.kit.version
        && value.designFiles === expected.designFiles && typeof value.method === 'string' && value.method.length > 0)) {
        throw Error('Native child must consume the exact version-pinned Bundle method before registration.')
      }
    },
    createObserver: input => createCodexTranscript(input),
  }
}
