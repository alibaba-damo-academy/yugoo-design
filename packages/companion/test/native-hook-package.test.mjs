import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { copyNativeHookModules, copyNativeExecutionReference } from '../build-plugin.mjs'

const isolatedImport = (path, cwd) => spawnSync(process.execPath,
  ['--input-type=module', '--eval', 'await import(process.argv[1])', pathToFileURL(path).href],
  { cwd, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } })

test('shared packaging retains native execution methods and refuses conflicting existing bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-method-package-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const shared = await readFile(new URL('../plugin/design-system/skills/design-panel/native-execution.md', import.meta.url), 'utf8')
  for (const host of ['qoder', 'claude-code', 'qwenwork']) {
    const target = join(root, host), path = await copyNativeExecutionReference(target, { host })
    const method = await readFile(path, 'utf8')
    if (host === 'claude-code') assert.equal(method, shared)
    else assert.ok(method.endsWith(shared.replaceAll('Codex', host === 'qoder' ? 'Qoder CLI' : 'QwenWork').replace('`codex exec`', host === 'qoder' ? '`qodercli -p`' : 'a native QwenWork agent')))
    await copyNativeExecutionReference(target, { host })
    assert.equal(await readFile(path, 'utf8'), method)
    await writeFile(path, 'foreign method retained')
    await assert.rejects(copyNativeExecutionReference(target, { host }), /conflicts/)
    assert.equal(await readFile(path, 'utf8'), 'foreign method retained')
  }
})

test('normal builder native module output relocates with both Windows dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-hook-package-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const host of ['qoder', 'claude-code', 'qwenwork']) {
    const target = join(root, host)
    await copyNativeHookModules(target, { host })
    for (const name of ['windows-private-storage.mjs', 'windows-native-platform.mjs']) {
      assert.deepEqual(await readFile(join(target, 'scripts', name)), await readFile(new URL('../../studio/src/node/' + name, import.meta.url)))
      const result = isolatedImport(join(target, 'scripts', name), root)
      assert.equal(result.status, 0, result.stderr)
    }
    const prefix = host === 'qwenwork' ? 'qwenwork' : host === 'qoder' ? 'qoder' : 'claude'
    const result = isolatedImport(join(target, 'scripts', `${prefix}-hook-transport.mjs`), root)
    assert.equal(result.status, 0, result.stderr)
  }
})

test('independent native scripts fail without the sibling helper or with repository-only forwarding bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-hook-missing-helper-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'qoder')
  await copyNativeHookModules(target, { host: 'qoder' })
  await rm(join(target, 'scripts/windows-native-platform.mjs'))
  const missing = isolatedImport(join(target, 'scripts/windows-private-storage.mjs'), root)
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/)
  assert.match(missing.stderr, /windows-native-platform\.mjs/)

  const legacy = join(root, 'forwarding/scripts')
  await mkdir(legacy, { recursive: true })
  await cp(new URL('../src/windows-private-storage.mjs', import.meta.url), join(legacy, 'windows-private-storage.mjs'))
  const forwarded = isolatedImport(join(legacy, 'windows-private-storage.mjs'), root)
  assert.notEqual(forwarded.status, 0)
  assert.match(forwarded.stderr, /ERR_MODULE_NOT_FOUND/)
  assert.match(forwarded.stderr, /studio/)
})
