import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEmitted } from './emitted-loader-check.mjs'
import { NODE_REQUIRE_INITIALIZER } from './known-node-loader-proof.mjs'

const runtime = `import {createRequire} from 'node:module'; var __require=${NODE_REQUIRE_INITIALIZER}; const other=1; export {__require as n,other as r};`
const consumer = "import {n as __require} from './runtime.mjs'; __require('process');__require('buffer');__require('process');__require('process');"
async function fixture(t, changes = {}) {
  const root = await mkdtemp(join(tmpdir(), 'node-loader-proof-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = { 'runtime.mjs': runtime, 'consumer.mjs': consumer, 'other.mjs': "import {r} from './runtime.mjs';export {r}", ...changes }
  for (const [name, code] of Object.entries(files)) await writeFile(join(root, name), code)
  return root
}

test('Node export/import forwarding is explicit; default checking stays strict', async t => {
  const root = await fixture(t)
  await assert.rejects(checkEmitted(root, new Set()), /Unverified/)
  const result = await checkEmitted(root, new Set(), { knownNodeRuntime: true })
  const r = result.find(x => x.file === 'runtime.mjs'), c = result.find(x => x.file === 'consumer.mjs')
  assert.equal(r.knownNodeProofs.length, 1); assert.equal(c.knownNodeProofs.length, 1)
  assert.deepEqual(c.loads.filter(x => x.kind === 'require').map(x => x.source), ['process', 'buffer', 'process', 'process'])
  assert.equal(r.dynamicClosureVerified, false); assert.equal(r.knownNodeProofs[0].runtimeExecuted, false)
  assert.equal(r.knownBrowserProofs.length, 0)
})

test('bundler-selected loader export is proved alongside unrelated helper exports', async t => {
  const root = await fixture(t, {
    'runtime.mjs': runtime.replace('__require as n,other as r', 'other as n,__require as r'),
    'consumer.mjs': consumer.replace('n as __require', 'r as __require'),
    'other.mjs': "import {n} from './runtime.mjs';export {n}",
  })
  await assert.rejects(checkEmitted(root, new Set()), /Unverified/)
  const result = await checkEmitted(root, new Set(), { knownNodeRuntime: true })
  const forwarded = result.find(x => x.file === 'consumer.mjs')
  assert.equal(forwarded.knownNodeProofs.length, 1)
  assert.deepEqual(forwarded.loads.filter(x => x.kind === 'require').map(x => x.source), ['process', 'buffer', 'process', 'process'])
  assert.equal(result.find(x => x.file === 'other.mjs').knownNodeProofs.length, 0)
  assert.equal(forwarded.dynamicClosureVerified, false)
})

test('changed initializer/export, createRequire binding and duplicate/shadow bindings reject', async t => {
  for (const code of [
    runtime.replace('createRequire(import.meta.url)', 'createRequire(otherURL)'),
    runtime.replace('__require as n', '__require as renamed'),
    runtime + ';__require=other', runtime + ';sink(__require)', runtime + ';const alias=__require',
    runtime + ';export {__require as extra}', runtime + ';function nested(__require){}',
    runtime + ';createRequire=other', runtime + ';function nested(createRequire){}',
    runtime.replace("from 'node:module'", "from './fake.mjs'"),
  ]) {
    const root = await fixture(t, { 'runtime.mjs': code })
    await assert.rejects(checkEmitted(root, new Set(), { knownNodeRuntime: true }))
  }
})

test('all consumers must call literal builtins; aliasing and additional escapes reject', async t => {
  for (const suffix of [
    '__require(name)', "__require('external-package')", "__require('sqlite')", "__require('node:not-a-real-builtin')", "__require('./runtime.mjs')", "__require.resolve('process')",
    'const alias=__require', 'sink(__require)', '__require=other', 'export {__require}',
    'function nested(__require){}', "__require('process', extra)",
  ]) {
    const root = await fixture(t, { 'consumer.mjs': consumer + suffix })
    await assert.rejects(checkEmitted(root, new Set(['external-package']), { knownNodeRuntime: true }))
  }
  for (const code of ["import {n as alias} from './runtime.mjs'; alias('process')", "import {n as __require} from './runtime.mjs';"]) {
    const root = await fixture(t, { 'consumer.mjs': code })
    await assert.rejects(checkEmitted(root, new Set(), { knownNodeRuntime: true }))
  }
})

test('known forwarding accepts a literal prefix-only builtin without widening package access', async t => {
  const root = await fixture(t, { 'consumer.mjs': consumer + "__require('node:sqlite')" })
  const result = await checkEmitted(root, new Set(), { knownNodeRuntime: true })
  const forwarded = result.find(x => x.file === 'consumer.mjs')
  assert.equal(forwarded.knownNodeProofs[0].builtinCalls.at(-1).source, 'node:sqlite')
  assert.equal(forwarded.dynamicClosureVerified, false)
})

test('namespace, re-export and non-static module entry paths cannot acquire the loader', async t => {
  for (const code of [
    "import * as all from './runtime.mjs';all.n('process')",
    "import all from './runtime.mjs';all.n('process')",
    "export * from './runtime.mjs'", "export {n as proxy} from './runtime.mjs'",
    "import('./runtime.mjs').then(m=>m.n('process'))",
    "const m=require('./runtime.mjs');m.n('process')",
    "import {createRequire} from 'node:module'; const m=createRequire(import.meta.url)('./runtime.mjs');m.n('process')",
    "const m=loader.require('./runtime.mjs');m.n('process')",
    "const p=require.resolve('./runtime.mjs');const m=acquire(p);m.n('process')",
  ]) {
    const root = await fixture(t, { 'escape.mjs': code })
    await assert.rejects(checkEmitted(root, new Set(), { knownNodeRuntime: true }))
  }
})

test('known forwarding never exempts unrelated calls or missing emitted targets', async t => {
  for (const code of ["const alias=require;alias('unknown')", 'require(dynamicName)', "import './missing.mjs'"]) {
    const root = await fixture(t, { 'unknown.mjs': code })
    await assert.rejects(checkEmitted(root, new Set(), { knownNodeRuntime: true }))
  }
})
