import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { packagePlugin } from '../build-plugin.mjs'
import { BROWSER_LICENSE_NOTICE, BUNDLED_JS_LICENSE_NOTICE } from '../../../scripts/companion-bundled-license.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const run = promisify(execFile)

test('Claude package relocates shared operations and hook modules without repo imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-claude-package-'))
  try {
    const packaged = await packagePlugin(join(root, 'design-system'), { host: 'claude-code' })
    for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
      for (const directory of [packaged, join(packaged, 'kits/web_app')]) {
        const source = directory === packaged ? `../../../${name}` : `../../skills-web-app/${name}`
        const expected = await readFile(new URL(source, import.meta.url))
        // The executable package carries the browser dependencies' notices in
        // addition to ours. Pure Kit content retains the original own material.
        const complete = directory === packaged && name === 'NOTICE'
          ? Buffer.concat([expected, Buffer.from(BROWSER_LICENSE_NOTICE + BUNDLED_JS_LICENSE_NOTICE)]) : expected
        assert.deepEqual(await readFile(join(directory, name)), complete, `missing or stale license material: ${name}`)
      }
    }
    const files = await readdir(packaged)
    assert.ok(files.includes('.claude-plugin'))
    assert.ok(!files.includes('.codex-plugin') && !files.includes('.qoder-plugin') && !files.includes('node_modules'))
    const manifest = JSON.parse(await readFile(join(packaged, '.claude-plugin/plugin.json'), 'utf8'))
    assert.equal(manifest.name, 'yugoo-design')
    assert.match(manifest.version, /^0\.1\.0\+claude-code\./)
    assert.equal(await readFile(join(packaged, 'skills/yugoo/native-execution.md'), 'utf8'),
      await readFile(new URL('../plugin/design-system/skills/design-panel/native-execution.md', import.meta.url), 'utf8'))
    const transport = await import(pathToFileURL(join(packaged, 'scripts/claude-hook-transport.mjs')))
    assert.equal(typeof transport.registerClaudeHook, 'function')
    assert.equal(typeof transport.receiveClaudeHook, 'function')
    const hooks = JSON.parse(await readFile(join(packaged, 'hooks/hooks.json'), 'utf8')).hooks
    assert.deepEqual(Object.keys(hooks), ['SessionStart', 'CwdChanged', 'SubagentStart', 'FileChanged'])
    assert.equal(hooks.FileChanged[0].matcher, undefined, 'dynamic absolute watch paths, not wildcard filenames')
    assert.equal(hooks.FileChanged[0].hooks[0].asyncRewake, true)
    for (const definitions of Object.values(hooks)) {
      for (const definition of definitions) for (const hook of definition.hooks) {
        assert.equal(hook.command, 'node')
        const script = hook.args[0].replace('${CLAUDE_PLUGIN_ROOT}', packaged)
        await run(process.execPath, ['--check', script])
      }
    }
    const declaration = JSON.parse(await readFile(join(packaged, '.mcp.json'), 'utf8')).mcpServers['design-system']
    const client = new Client({ name: 'claude-package-test', version: '1' })
    const mcp = new StdioClientTransport({ ...declaration,
      args: declaration.args.map(arg => arg.replace('${CLAUDE_PLUGIN_ROOT}', packaged)),
      cwd: root, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, stderr: 'pipe' })
    try {
      await client.connect(mcp)
      const names = new Set((await client.listTools()).tools.map(tool => tool.name))
      for (const name of ['design_prepare_bundle', 'design_register_run', 'design_prepare_reviews', 'design_bind_reviews']) assert.ok(names.has(name))
    } finally { await client.close(); await mcp.close() }
    // Optional native manifest validation; no model, account, or installed config changes.
    try {
      const validated = await run('claude', ['plugin', 'validate', packaged], { timeout: 60000 })
      assert.match(validated.stdout, /Validation passed/)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
