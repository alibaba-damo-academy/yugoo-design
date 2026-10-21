/** One stable suite entry for native message and external relay diagnostics. */
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { handleProbeRequest, resourceUri } from './workbuddy-message-probe.mjs'
import { readFile } from 'node:fs/promises'
import { createWorkBuddyPanelMcp } from './workbuddy-panel-mcp.mjs'
import { createRelayProbe } from './workbuddy-relay-probe.mjs'

export function createWorkBuddyUiProbes(options = {}) {
  const relay = createRelayProbe(), panel = createWorkBuddyPanelMcp(options)
  return {
    async handle(request) {
      const { id, method, params = {} } = request
      if (id === undefined) return undefined
      if (method === 'initialize') return { jsonrpc: '2.0', id, result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'design-system-workbuddy-ui', version: '0.3.0' },
      } }
      if (method === 'tools/list' || method === 'resources/list') {
        const key = method === 'tools/list' ? 'tools' : 'resources'
        const first = handleProbeRequest(request), second = await relay.handle(request), third = await panel.handle(request)
        return { jsonrpc: '2.0', id, result: { [key]: [...first.result[key], ...second.result[key], ...third.result[key]] } }
      }
      if ((method === 'tools/call' && params.name === 'yugoo_workbuddy_message_probe') ||
          (method === 'resources/read' && params.uri === resourceUri)) return handleProbeRequest(request)
      return await panel.handle(request) ?? relay.handle(request)
    },
    close: options => relay.close(options),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = JSON.parse(await readFile(new URL('./workbuddy-package-runtime.json', import.meta.url), 'utf8'))
  const probes = createWorkBuddyUiProbes(options), lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line) > 65536) { process.exitCode = 1; break }
      try { const result = await probes.handle(JSON.parse(line)); if (result) console.log(JSON.stringify(result)) }
      catch { console.log(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Probe request failed.' } })) }
    }
  } finally { await probes.close({ preserveRelay: true }) }
}
