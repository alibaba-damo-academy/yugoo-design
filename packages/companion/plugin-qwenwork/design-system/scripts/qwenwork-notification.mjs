import { receiveQwenWorkHook } from './qwenwork-hook-transport.mjs'
import { withWindowsInspection } from './windows-native-platform.mjs'
let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (Buffer.byteLength(input) > 1048576) throw Error('Hook input exceeds limit.')
}
const message = await withWindowsInspection(() => receiveQwenWorkHook(JSON.parse(input)))
if (message) { process.stderr.write(message); process.exitCode = 2 }
