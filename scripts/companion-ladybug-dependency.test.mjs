import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateLadybugDependency, selectCandidateLadybug, parseLadybugBuildArgs } from './companion-ladybug-dependency.mjs'

test('selection requires exact explicit input and rejects ambiguous or local substitutions', () => {
  assert.equal(selectCandidateLadybug({ ladybugDependency: '0.21.1' }), '0.21.1')
  assert.equal(selectCandidateLadybug({ scope: '@fixture-design-release', ladybugVersion: '0.19.1-walfix.1' }), 'npm:@fixture-design-release/ladybug-wasm-core@0.19.1-walfix.1')
  assert.throws(() => selectCandidateLadybug({ scope: '@fixture-design-release' }), /Explicit Ladybug/u)
  assert.throws(() => selectCandidateLadybug({ ladybugDependency: '0.21.1', ladybugVersion: '0.19.1-walfix.1' }), /Conflicting/u)
  for (const bad of [undefined, 'latest', '^0.21.1', '0.21.0', 'file:/tmp/engine', 'npm:@fixture/engine@^0.19.1', 'npm:engine@0.21.1', ' 0.21.1', '0.21.1 ']) {
    assert.throws(() => validateLadybugDependency(bad), /Explicit Ladybug/u)
  }
  assert.deepEqual(parseLadybugBuildArgs(['--ladybug-dependency', '0.21.1']), { ladybugDependency: '0.21.1' })
  for (const bad of [[], ['--ladybug-dependency'], ['--unknown', '0.21.1'], ['--ladybug-dependency', '0.21.1', '--override']]) assert.throws(() => parseLadybugBuildArgs(bad), /explicit exact/u)
})

test('same-source CLI with no selector fails before allocating a build directory', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'ladybug selector cli '))
  t.after(() => rm(root, { recursive: true }))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build-companion-npm-candidate.mjs', import.meta.url))], {
    env: { ...process.env, TMPDIR: root, NODE_PATH: '', NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 15_000,
  })
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Use --ladybug-dependency/u)
  assert.deepEqual(await readdir(root), [])
})
