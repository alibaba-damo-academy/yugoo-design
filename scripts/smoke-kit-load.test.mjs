import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

// Run the documented entry itself against this checkout's freshly built Core.
// Its in-memory negative probes never alter installed Bundle files.
test('documented Kit smoke uses package-resolved roots and current conditional slots', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('./smoke-kit-load.mjs', import.meta.url))],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 30_000, maxBuffer: 1_000_000 })
  assert.match(stdout, /kit name: web_app/)
  assert.match(stdout, /ai_agent_capabilities: slots complete/)
  assert.equal((stdout.match(/: slots complete \(4 files\)/g) ?? []).length, 15)
  assert.match(stdout, /KIT LOAD OK/)
})
