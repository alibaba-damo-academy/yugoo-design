/** Bind a selected Node to owned native outputs, preserving the acquired overlay. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, win32 } from 'node:path'

const encode = value => JSON.stringify(value, null, 2) + '\n'
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"

/** Discovery provenance can differ while the selected executable stays identical. */
export function nodeRuntimePin(selection) {
  return selection ? Object.fromEntries(['executable', 'sha256', 'version', 'platform', 'arch'].map(key => [key, selection[key]])) : null
}

/** Return only the registration files whose launcher changes. No input is written. */
export async function nodeRegistrationFiles(root, host, selection) {
  assert.ok(['codex', 'claude-code', 'qoder'].includes(host), 'Native Node binding host required')
  const executable = selection?.executable
  assert.ok(typeof executable === 'string' && (isAbsolute(executable) || win32.isAbsolute(executable))
    && !/[\r\n\0]/u.test(executable), 'Selected absolute Node required')
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'))
  assert.equal(mcp.mcpServers?.['design-system']?.command, 'node', 'Unexpected native MCP template')
  mcp.mcpServers['design-system'].command = executable
  const files = { '.mcp.json': encode(mcp) }
  if (host === 'codex') return files
  let hooks
  try { hooks = JSON.parse(await readFile(join(root, 'hooks/hooks.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return files; throw error }
  for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) {
    if (host === 'claude-code') {
      assert.equal(hook.command, 'node', 'Unexpected Claude Hook template')
      hook.command = executable
    } else {
      assert.ok(hook.command.startsWith('node "'), 'Unexpected Qoder Hook template')
      hook.command = shellQuote(executable.replaceAll('\\', '/')) + hook.command.slice(4)
    }
  }
  files['hooks/hooks.json'] = encode(hooks)
  return files
}

/** Write the already projected files only into a transaction-owned registration. */
export async function writeNodeRegistrationFiles(root, files) {
  for (const [path, text] of Object.entries(files)) {
    assert.ok(path === '.mcp.json' || path === 'hooks/hooks.json', 'Unexpected Node registration asset')
    await writeFile(join(root, path), text)
  }
}
