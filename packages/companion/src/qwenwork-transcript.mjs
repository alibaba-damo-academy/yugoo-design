/** Same SDK record grammar; QwenWork remains a separate host authority. */
import { createClaudeStyleTranscript, verifyQoderChild } from './qoder-transcript.mjs'
export const createQwenWorkTranscript = options => createClaudeStyleTranscript({ ...options,
  label: 'QwenWork', source: 'qwenwork-native-transcript', classifyTurn(event) {
    if (event.type !== 'user') return undefined
    if (event.isMeta === true && event.origin?.kind === 'task-notification') return true
    if (event.origin?.kind === 'human' && !event.isMeta) return false
    return undefined
  } })
// Requires native task descriptor AND exact parent dispatch, not supplied IDs alone.
export const verifyQwenWorkChild = verifyQoderChild
