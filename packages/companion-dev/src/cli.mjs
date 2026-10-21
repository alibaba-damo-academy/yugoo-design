import { resolve } from 'node:path'
import { startCompanion } from '../../companion/src/server.mjs'
import { createCompanionDevFrontend } from './frontend.ts'

const args = process.argv.slice(2)
if (!args.length || args.includes('--help')) {
  console.log('Usage: pnpm dev:companion -- --project <design-project> --state <isolated-state> --kit <installed-kit-root> --host <codex|claude-code|qoder> --thread <exact-session-id> [--cwd <native-cwd>] [--transcript <native-transcript>] [--port 41593]')
  process.exit(args.includes('--help') ? 0 : 1)
}
const values = new Map()
const allowed = new Set(['--project', '--state', '--kit', '--host', '--thread', '--cwd', '--transcript', '--port'])
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--') continue
  const flag = args[i], value = args[++i]
  if (!allowed.has(flag) || !value || value.startsWith('--') || values.has(flag)) throw new Error(`Invalid development option: ${flag}`)
  values.set(flag, value)
}
for (const flag of ['--project', '--state', '--kit', '--host', '--thread']) if (!values.has(flag)) throw new Error(`Required: ${flag}`)
const port = values.get('--port') ?? '41593'
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid development port')
const server = await startCompanion({
  projectRoot: resolve(values.get('--project')), stateRoot: resolve(values.get('--state')), kitRoot: resolve(values.get('--kit')),
  host: values.get('--host'), threadId: values.get('--thread'), nativeCwd: resolve(values.get('--cwd') ?? values.get('--project')),
  transcriptPath: values.get('--transcript'), port: +port, devFrontend: createCompanionDevFrontend,
  knowledgeAutoRefresh: false,
})
console.log(`HMR Studio: ${server.origin}/?view=studio`)
console.log(`Connection file: ${server.connectionPath} (contains the private startup token; do not share it)`)
console.log('Use the connection token once in the URL fragment. Backend/Kit changes require restart; component and CSS changes use HMR. No model is started by this command.')
let closing = false
async function close() { if (closing) return; closing = true; await server.close() }
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
