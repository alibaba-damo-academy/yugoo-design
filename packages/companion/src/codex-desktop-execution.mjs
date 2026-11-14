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
    createObserver: input => createCodexTranscript(input),
  }
}
