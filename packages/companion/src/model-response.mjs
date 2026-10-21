/** Model-facing transport views only. Never feed these back into service logic. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))

export function modelRequest(request) {
  return request.method === 'readWorkspace'
    ? { ...request, params: { ...request.params, includeServices: true, includeConversation: false } }
    : request
}

function capabilities(value) {
  if (!object(value?.backgroundReviewProtocol)) return value
  return { ...value, backgroundReviewProtocol: {
    ...pick(value.backgroundReviewProtocol, ['mode', 'executionMode', 'state', 'canAttemptReadiness', 'launch', 'bootstrap']),
    details: 'Use design_status with details=true for the complete host-specific background protocol. Unverified capability never permits background dispatch.',
  } }
}

function workspace(value) {
  const result = pick(value, ['projectId', 'projectName', 'projectPath', 'checkpoint', 'access', 'kitReload',
    'publicationError', 'executionAttempts', 'artifactActivities', 'activeMainBundles', 'continuations',
    'savedContinuations', 'savedNotificationError', 'reviews', 'reviewPolicy', 'reviewDispatchOwner', 'autoPanelDefinitions', 'autoPanelStates'])
  if (value.clarity) result.clarity = without(value.clarity, ['assessment', 'explanation'])
  if (value.hostCapabilities) result.hostCapabilities = capabilities(value.hostCapabilities)
  if (value.services) result.services = { ...value.services,
    ...(value.services.ust ? { ust: without(value.services.ust, ['explanation']) } : {}),
    ...(value.services.gra ? { gra: without(value.services.gra, ['reviews']) } : {}),
  }
  return result
}

export function modelResponse(method, value, { details = false } = {}) {
  if (details || !object(value)) return value
  if (method === 'readWorkspace') return workspace(value)
  if (method === 'prepareBundle') {
    // The complete version-pinned method already starts with these instructions.
    // Retain that text once, plus structured paths, placement and validation argv.
    const result = without(value, ['mainAssessmentContext'])
    if (object(value.executionContract) && typeof value.method === 'string'
      && typeof value.executionContract.instructions === 'string'
      && value.method.startsWith(value.executionContract.instructions)) {
      result.executionContract = without(value.executionContract, ['instructions'])
    }
    return result
  }
  if (['finishNativeRun', 'finishMainBundle', 'submitReview', 'bindReviewRun', 'bindReviewRuns'].includes(method)) {
    // Keep recovery, diagnostics, declared handoffs, Worker receipts and autoTask
    // prompts verbatim. A committed receipt is not necessarily accepted/complete.
    const result = without(value, ['hostCapabilities', 'reviews'])
    if (object(value.settlement)) result.settlement = without(value.settlement, ['state', 'diff', 'note'])
    return result
  }
  return value
}
