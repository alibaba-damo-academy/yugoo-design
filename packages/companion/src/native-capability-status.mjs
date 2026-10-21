/** Bounded public projection of a neutral native capability observation.
 * It neither parses a Host protocol nor grants execution authority.
 */
const safeStates = new Set(['attached', 'background', 'synchronous', 'unknown', 'running', 'completed', 'failed', 'pending', 'cancelled', 'interrupted'])
// Adapter exceptions can contain fragments of native transcripts. Public status
// explains the normalized result, never arbitrary exception/receipt text.
const publicReasons = {
  'native-connection-boundary-missing': 'The current native connection boundary is unavailable.',
  'native-background-not-observed': 'No native background execution has been verified for the current connection.',
  'native-synchronous-result': 'The native call returned synchronously, not as background execution.',
  'native-background-transport-missing': 'The native result did not provide a verifiable background transport.',
  'native-background-stale': 'The native background evidence is outside the current connection boundary.',
  'native-attached-result': 'The native result is attached, not a detached background execution.',
  'native-background-descriptor-invalid': 'The native background descriptor does not match its native parent call.',
  'native-background-launch-missing': 'The native background launch record is unavailable.',
  'native-records-unavailable': 'The native execution records could not be read.',
  'native-background-ready': 'Native background execution is verified for the current connection.',
}
const shortText = (value, max) => typeof value === 'string' ? value.slice(0, max) : undefined
const publicId = value => typeof value === 'string' && value.length <= 128 && /^(?:[a-f0-9-]{36}|(?:call|agent|task|event)[_-][\w-]{1,100})$/i.test(value) ? value : undefined
function publicActual(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return safeStates.has(value) ? value : { length: value.length }
  if (value && typeof value === 'object' && Number.isSafeInteger(value.length) && value.length >= 0) return { length: value.length }
  return undefined
}
export function nativeCapabilityStatus(observation) {
  const diagnostics = observation?.diagnostics
  const projected = { issues: (Array.isArray(diagnostics?.issues) ? diagnostics.issues : []).slice(0, 24).map(issue => ({
    field: shortText(issue.field, 120), expected: shortText(issue.expected, 200), actualType: shortText(issue.actualType, 24),
    ...(publicActual(issue.actual) === undefined ? {} : { actual: publicActual(issue.actual) }),
  })) }
  for (const field of ['callId', 'receiptId', 'taskId']) {
    const id = publicId(diagnostics?.[field]); if (id) projected[field] = id
  }
  return {
    backgroundReviewReadiness: observation?.state === 'ready' ? 'ready' : 'unverified',
    backgroundReviewExecutionMode: ['native-detached', 'cooperative-background', 'unavailable'].includes(observation?.executionMode)
      ? observation.executionMode : 'unavailable',
    ...(typeof observation?.reasonCode === 'string' && /^[a-z][a-z0-9-]{0,95}$/.test(observation.reasonCode)
      ? { backgroundReviewReasonCode: observation.reasonCode } : {}),
    backgroundReviewReason: Object.hasOwn(publicReasons, observation?.reasonCode)
      ? publicReasons[observation.reasonCode] : 'Native background execution could not be verified for the current connection.',
    backgroundReviewObservedMode: safeStates.has(observation?.observedMode) ? observation.observedMode : 'unknown',
    backgroundReviewDiagnostics: projected,
  }
}
