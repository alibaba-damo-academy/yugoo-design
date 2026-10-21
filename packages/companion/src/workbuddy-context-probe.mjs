/** No registration or authority: observe the actual desktop's Hook input shape. */
import { pathToFileURL } from 'node:url'

export function workBuddyProbeContext(event) {
  if (!event || !['SessionStart', 'PostToolUse'].includes(event.hook_event_name)) return undefined
  if (typeof event.session_id !== 'string' || !/^[a-zA-Z0-9][\w:-]{0,127}$/.test(event.session_id)) throw Error('Missing bounded native session identity')
  for (const field of ['cwd', 'transcript_path']) {
    if (typeof event[field] !== 'string' || !event[field] || event[field].length > 4096 || /[\r\n\0]/.test(event[field])) throw Error(`Missing bounded native ${field}`)
  }
  const identity = { host: 'workbuddy', sessionId: event.session_id, nativeCwd: event.cwd, transcriptPath: event.transcript_path }
  return { hookSpecificOutput: { hookEventName: event.hook_event_name,
    additionalContext: `YUGOO_WORKBUDDY_IDENTITY_PROBE ${JSON.stringify(identity)}. Diagnostic routing evidence only; not authorization, a verified runtime binding, or a request to act.` } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let text = ''
    for await (const chunk of process.stdin) {
      text += chunk
      if (Buffer.byteLength(text) > 65536) throw Error('Hook input limit exceeded')
    }
    const result = workBuddyProbeContext(JSON.parse(text))
    if (result) console.log(JSON.stringify(result))
  } catch {
    // Exit 1 reports a failed probe; never use the host's blocking/rewake exit code.
    console.error('WorkBuddy identity probe unavailable: missing or incompatible native Hook input.')
    process.exitCode = 1
  }
}
