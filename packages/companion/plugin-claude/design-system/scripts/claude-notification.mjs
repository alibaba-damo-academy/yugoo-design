import { receiveClaudeHook } from './claude-hook-transport.mjs'
let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 1048576) throw new Error('Hook input exceeds limit.')
}
const message = await receiveClaudeHook(JSON.parse(input))
if (message) {
  process.stderr.write(message)
  process.exitCode = 2 // FileChanged asyncRewake wakes the native conversation.
}
