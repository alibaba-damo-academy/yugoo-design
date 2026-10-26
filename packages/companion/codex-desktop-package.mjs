/** Mac desktop mapping for the ordinary already-built Codex plugin closure. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveNodeRuntime, verifyNodeRuntime } from './src/npm-node-runtime.mjs'

export async function configureCodexDesktopPackage(target, { nodeExecutable } = {}) {
  const nodeRuntime = await resolveNodeRuntime({ nodeExecutable })
  await verifyNodeRuntime(nodeRuntime)
  const manifestPath = join(target, '.codex-plugin/plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.name, 'yugoo-design')
  assert.equal(manifest.skills, './skills/')
  assert.equal(manifest.mcpServers, './.mcp.json')
  const mcpPath = join(target, '.mcp.json')
  const mcp = JSON.parse(await readFile(mcpPath, 'utf8'))
  assert.deepEqual(mcp, { mcpServers: { 'design-system': {
    command: 'node', args: ['scripts/design.mjs', 'mcp'], cwd: '.',
  } } }, 'Desktop mapping requires the unchanged Codex overlay')
  // The legacy .codex-plugin loader resolves a relative cwd against the installed
  // root but leaves args unchanged. PLUGIN_ROOT expansion belongs to the newer
  // Agent Plugins schema, so keep this legacy entry relative to its loaded cwd.
  mcp.mcpServers['design-system'] = { command: nodeRuntime.executable,
    args: ['scripts/design.mjs', 'mcp'], cwd: '.' }
  manifest.requires_local_executor = true
  if (manifest.interface) manifest.interface.longDescription = 'Yugoo Design desktop preview: open shared Design Project Panels in the current Mac Codex conversation, save validated files and receive the saved diff. Main execution and explicit foreground checks are available; native child agents and background reviews remain unverified.'
  await writeFile(mcpPath, JSON.stringify(mcp, null, 2) + '\n')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const mapping = { schemaVersion: 1, host: 'codex-desktop', nodeRuntime,
    bridgeRuntime: 'Selected desktop-owned bundled Node, launched directly by the host; not a shared Node prerequisite.',
    nativeRegistrationVerified: false, loaded: false }
  await writeFile(join(target, 'codex-desktop.json'), JSON.stringify(mapping, null, 2) + '\n', { flag: 'wx' })
  return mapping
}
