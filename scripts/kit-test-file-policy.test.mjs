import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { assertKitTestScripts, isKitRootDevelopmentFile } from './kit-test-file-policy.mjs'

test('current declared Node tests are accepted without executing any test command', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/skills-web-app/package.json', import.meta.url), 'utf8'))
  const files = assertKitTestScripts(manifest.scripts)
  assert.equal(files.size, 10)
  assert.ok(files.has('test/test-reading-order.mjs'))
  assert.ok(files.has('test/smoke-layout-production.mjs'))
})

test('build, publication, install and runtime lifecycle names stay forbidden', () => {
  for (const name of ['build', 'pretest', 'posttest', 'prepack', 'prepare', 'postinstall', 'start', 'dev']) {
    assert.throws(() => assertKitTestScripts({ test: 'node test/test-page-file-contract.mjs', [name]: 'node test/test-page-file-contract.mjs' }))
  }
})

test('Node eval, loaders, arbitrary arguments, shell commands and path escapes are forbidden', () => {
  for (const command of [
    'node -e process.exit(0)', 'node --import ./loader.mjs test/test-reading-order.mjs',
    'node test/test-reading-order.mjs --extra', 'node --test', 'node', '',
    'npm test', 'pnpm build', 'node test/test-reading-order.mjs && tsdown',
    'node test/test-reading-order.mjs; echo extra', 'node test/test-reading-order.mjs | node test/test-layout-policy.mjs',
    'node test/test-reading-order.mjs &&', 'node --test ../test/test-reading-order.mjs',
    'node --test ./test/test-reading-order.mjs', 'node --test test-unknown.mjs',
    'node --test test-*.mjs', 'node --test scripts/preview-reading-layout.mjs',
  ]) assert.throws(() => assertKitTestScripts({ test: command }), command)
  assert.throws(() => assertKitTestScripts({ 'test:extra': 'node test/test-reading-order.mjs' }))
})

test('only exact source-only development files are exempted from Bundle script location checks', () => {
  for (const file of ['test/test-reading-order.mjs', 'test/smoke-layout-production.mjs', 'scripts/compare-reading-layout.mjs', 'scripts/preview-reading-layout.mjs']) {
    assert.equal(isKitRootDevelopmentFile(file), true)
  }
  for (const file of ['index.mjs', 'runtime.js', 'test-unknown.mjs', 'smoke-unknown.mjs', 'nested/test/test-reading-order.mjs', '../test/test-reading-order.mjs', 'preview-another-tool.mjs', 'test-reading-order.mjs', 'preview-reading-layout.mjs', 'test/test-unknown.mjs']) {
    assert.equal(isKitRootDevelopmentFile(file), false, file)
  }
})

test('source-only development exemptions do not widen the published content or runtime entry contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/skills-web-app/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.main, undefined)
  assert.equal(manifest.exports, undefined)
  assert.deepEqual(manifest.files, ['README.md', 'kits', 'bundles', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'])
  assert.equal(manifest.files.some(isKitRootDevelopmentFile), false)
})
