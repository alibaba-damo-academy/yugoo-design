import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

test('public credential exclusion regression runs without excluded development originals', t => {
  const root = mkdtempSync(join(tmpdir(), 'public-preflight-portability-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // Actual source bytes, not a rewritten copy of the assertion under test.
  for (const path of ['scripts/public-snapshot-preflight.mjs',
    'scripts/public-snapshot-preflight.test.mjs', 'release/public-source-policy.json']) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    copyFileSync(new URL(`../${path}`, import.meta.url), join(root, path))
  }
  for (const path of ['.env.example', 'scripts/public-env-template.test.mjs']) {
    assert.equal(existsSync(join(root, path)), false, 'excluded originals must not be supplied by this fixture')
  }
  const childEnv = { ...process.env }
  delete childEnv.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    '--test-name-pattern=^host credential template and its development regression',
    'scripts/public-snapshot-preflight.test.mjs'], {
    cwd: root, env: childEnv, encoding: 'utf8', timeout: 30_000,
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /# pass 1\b/u)
  assert.match(result.stdout, /# fail 0\b/u)
})
