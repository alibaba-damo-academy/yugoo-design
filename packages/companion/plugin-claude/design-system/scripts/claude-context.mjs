// Native identity is notification routing evidence, never task authorization.
import { registerClaudeHook } from './claude-hook-transport.mjs'
let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 1048576) throw new Error('Hook input exceeds limit.')
}
const event = JSON.parse(input)
if (!['SessionStart', 'CwdChanged', 'SubagentStart'].includes(event.hook_event_name)) process.exit(0)
const watchPaths = await registerClaudeHook(event)
if (event.hook_event_name === 'CwdChanged') {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'CwdChanged', watchPaths } }))
  process.exit(0)
}
if (typeof event.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(event.session_id)) process.exit(0)
const identity = { host: 'claude-code', sessionId: event.session_id, nativeCwd: event.cwd,
  transcriptPath: event.transcript_path, ...(event.agent_id ? { agentId: event.agent_id } : {}) }
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event.hook_event_name,
  ...(event.hook_event_name === 'SessionStart' ? { watchPaths } : {}),
  additionalContext: `Yugoo Design native identity (only for Yugoo Design work): ${JSON.stringify(identity)}. This is not task authorization. Use the yugoo skill for project commands. Child bindings must still verify native parent/child evidence; transcriptPath is the main session transcript, not proof of a child transcript.` } }))
