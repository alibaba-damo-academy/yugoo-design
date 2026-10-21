import { receiveQoderHook } from './qoder-hook-transport.mjs'
let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 1048576) throw new Error('Hook input exceeds limit.')
}
const message = await receiveQoderHook(JSON.parse(input))
if (message) {
  process.stderr.write(message)
  process.exitCode = 2 // Official asyncRewake contract: wake the native model.
}
