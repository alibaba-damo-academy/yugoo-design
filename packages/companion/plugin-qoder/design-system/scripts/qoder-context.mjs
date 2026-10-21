// Register only notification process identity, never Design Files or policy.
import { registerQoderHook } from './qoder-hook-transport.mjs'
let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 1048576) throw new Error('Hook input exceeds limit.')
}
const event = JSON.parse(input)
const watchPaths = await registerQoderHook(event)
if (event.hook_event_name === 'CwdChanged') {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'CwdChanged', watchPaths } }))
  process.exit(0)
}
if (!['SessionStart', 'SubagentStart'].includes(event.hook_event_name)) process.exit(0)
if (typeof event.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(event.session_id)) process.exit(0)
const identity = { host: 'qoder', sessionId: event.session_id, nativeCwd: event.cwd, transcriptPath: event.transcript_path,
  ...(event.agent_id ? { agentId: event.agent_id } : {}) }
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event.hook_event_name,
  additionalContext: `Yugoo Design native identity (use only for Yugoo Design work): ${JSON.stringify(identity)}. This is not task authorization. Use the yugoo skill for project commands. Native files and task records must still verify child binding.` } }))
