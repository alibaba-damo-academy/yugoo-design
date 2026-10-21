/** Host-neutral presentation only. Never schedule work or infer roles from names. */
const methods = new Set(['design_prepare_review', 'design_prepare_reviews', 'design_read_review', 'design_bind_review', 'design_bind_reviews', 'design_submit_review'])

export function reviewOperation(tool, args) {
  if (!methods.has(tool)) return undefined
  if (typeof args === 'string') {
    if (args.length > 65536) return undefined
    try { args = JSON.parse(args) } catch { return undefined }
  }
  if (typeof args?.connection !== 'string') return undefined
  if (args.bindings !== undefined && !Array.isArray(args.bindings)) return undefined
  const ids = args.bindings ? args.bindings.map(x => x?.reviewId) : args.reviewId ? [args.reviewId] : []
  if (!ids.every(x => typeof x === 'string')) return undefined
  return { tool, connection: args.connection, reviewIds: ids }
}

export function partitionReviewConversation(conversation, bindings, { connectionPath, foregroundActive = false, foregroundRunIds = [] }) {
  const foreground = new Set(foregroundRunIds)
  const runs = new Set(bindings.map(x => x.runId).filter(id => id && !foreground.has(id)))
  const ids = new Set(bindings.map(x => x.reviewId))
  const rows = [], backgroundRows = []
  for (const row of conversation.rows ?? []) {
    const targets = row.targetRunIds ?? []
    const op = row.reviewOperation
    const background = row.nativeBackground === true || row.role === 'tool' && !row.questions?.length && (
      targets.length > 0 ? targets.every(id => runs.has(id)) :
      op && methods.has(op.tool) && op.connection === connectionPath && op.reviewIds.every(id => ids.has(id)))
    const { reviewOperation: _privateOperation, mainReportOperation: _privateMainReport, nativeTurn: _nativeTurn, nativeBackground: _nativeBackground, ...publicRow } = row
    ;(background ? backgroundRows : rows).push(publicRow)
  }
  // Do not derive idle from running children. This only describes the latest
  // confirmed main-session activity, preserving the original native status.
  const last = conversation.rows?.at(-1)
  const backgroundActivity = conversation.available && !conversation.catchingUp && conversation.recordedStatus === 'running'
    && !foregroundActive && last && backgroundRows.at(-1)?.id === last.id
    && conversation.activityEpoch !== undefined && last.activityEpoch === conversation.activityEpoch
    && !rows.some(row => row.role === 'tool' && ['running', 'in_progress'].includes(row.status))
  return { conversation: { ...conversation, rows, backgroundActivity: !!backgroundActivity }, backgroundRows }
}
