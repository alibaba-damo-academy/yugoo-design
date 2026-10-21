/** Place native Producers beside their exact spawn activity, never by completion time. */
export function conversationHistory(rows = [], attempts = []) {
  const producers = attempts.filter(attempt => attempt.role === 'producer')
  const anchors = new Map()
  for (const row of rows) for (const id of row.childRunIds ?? []) if (!anchors.has(id)) anchors.set(id, row.id)
  const result = producers.filter(attempt => !anchors.has(attempt.runId)).map(attempt => ({ kind: 'producer', attempt, earlier: true }))
  for (const row of rows) {
    result.push({ kind: 'message', row })
    for (const attempt of producers) if (anchors.get(attempt.runId) === row.id) result.push({ kind: 'producer', attempt })
  }
  return result
}

/** Presentation only: never group across a message or a bound Producer. */
export function compactConversationHistory(rows = [], attempts = []) {
  const result = []
  for (const entry of conversationHistory(rows, attempts)) {
    if (entry.kind === 'message' && entry.row.role === 'tool' && !entry.row.questions?.length) {
      const previous = result.at(-1)
      if (previous?.kind === 'activity') previous.rows.push(entry.row)
      else result.push({ kind: 'activity', rows: [entry.row] })
    } else result.push(entry)
  }
  return result
}

/** Main-session state only: reviewer/Producer activity never makes the parent busy. */
export function conversationWork(value, attempts = []) {
  if(!value?.available || value.catchingUp)return {status:'unknown',activeId:null}
  if(value.rows?.some(row=>row.questions?.length && row.status==='running'))return {status:'waiting',activeId:null}
  if(value.recordedStatus!=='running')return {status:value.recordedStatus ?? 'unknown',activeId:null}
  if(value.backgroundActivity)return {status:'background',activeId:null}
  const rows=value.rows ?? [], lastUser=rows.findLastIndex(row=>row.role==='user')
  const currentRows=rows.slice(lastUser+1).filter(row=>value.activityEpoch===undefined || row.activityEpoch===value.activityEpoch)
  const activities=compactConversationHistory(currentRows, attempts).filter(entry=>entry.kind==='activity')
  return {status:'running',activeId:activities.at(-1)?.rows[0].id ?? null}
}
