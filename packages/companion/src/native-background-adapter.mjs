/** Composition only: native receipt formats remain owned by their Host adapter. */
import { createWorkBuddyReviewTranscript, readWorkBuddyBackgroundReadiness, verifyWorkBuddyChild } from './workbuddy-native.mjs'
import { workBuddyBackgroundProtocol } from './workbuddy-background.mjs'
import { createQwenWorkBackgroundTranscript, qwenWorkBackgroundProtocol, readQwenWorkBackgroundReadiness, verifyQwenWorkBackgroundChild } from './qwenwork-background.mjs'
import { createCodexDesktopBackgroundAdapter } from './codex-desktop-background.mjs'

// This is capability, not project policy or a promise to launch a native task.
// Both desktop adapters rely on cooperative Agent calls; neither owns a public
// programmatic detached-spawn API. Native receipt parsing stays in each adapter.
function capability(readiness) {
  const ready = readiness.state === 'ready'
  return { ...readiness, state: ready ? 'ready' : 'unverified', canDispatch: ready,
    executionMode: ready ? 'cooperative-background' : 'unavailable',
    reasonCode: readiness.reasonCode ?? (ready ? 'native-background-ready' : 'native-background-unverified'),
    observedMode: readiness.observedMode ?? (ready ? 'background' : 'unknown'),
    diagnostics: readiness.diagnostics ?? { issues: [] } }
}

export function createNativeBackgroundAdapter({ host, sessionId, projectRoot, mainTranscriptPath, readinessSince, codexDesktop = false, getConnectionPath }) {
  const context = { sessionId, projectRoot, mainTranscriptPath }
  if (host === 'codex' && codexDesktop) {
    const adapter = createCodexDesktopBackgroundAdapter({ ...context, readinessSince, getConnectionPath })
    return { ...adapter, readReadiness: async () => capability(await adapter.readReadiness()) }
  }
  if (host === 'workbuddy') return {
    readReadiness: async () => capability(await readWorkBuddyBackgroundReadiness({ ...context, readinessSince })),
    protocol: workBuddyBackgroundProtocol,
    verifyChild: input => verifyWorkBuddyChild({ ...input, ...context, requireBackground: true }),
    verifyNewChild: (input, { reviewId, notBefore }) => verifyWorkBuddyChild({ ...input, ...context,
      requireBackground: true, reviewId, notBefore: Math.max(readinessSince, notBefore) }),
    createObserver: input => createWorkBuddyReviewTranscript({ ...input, ...context }),
  }
  if (host === 'qwenwork') return {
    readReadiness: async () => capability(await readQwenWorkBackgroundReadiness({ ...context, readinessSince })),
    protocol: qwenWorkBackgroundProtocol,
    // Current-service readiness controls NEW dispatch. Already bound genuine
    // reviews retain readable native evidence after the Companion reopens;
    // exact session/parent/call/task/paths are still verified independently.
    verifyChild: input => verifyQwenWorkBackgroundChild({ ...input, ...context, readinessSince: 0 }),
    verifyNewChild: (input, { reviewId, notBefore }) => verifyQwenWorkBackgroundChild({ ...input, ...context,
      reviewId, readinessSince: Math.max(readinessSince, notBefore) }),
    createObserver: input => createQwenWorkBackgroundTranscript({ ...input, ...context, readinessSince: 0 }),
  }
  // Existing Codex/Qoder/Claude routes keep their own verified contracts.
  return undefined
}
