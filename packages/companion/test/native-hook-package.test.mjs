import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { copyNativeHookModules, copyNativeExecutionReference } from '../build-plugin.mjs'

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
      assert.deepEqual(await readFile(join(target, 'scripts', name)), await readFile(new URL('../src/' + name, import.meta.url)))
      await import(pathToFileURL(join(target, 'scripts', name)))
    }
    const prefix = host === 'qwenwork' ? 'qwenwork' : host === 'qoder' ? 'qoder' : 'claude'
    await import(pathToFileURL(join(target, 'scripts', `${prefix}-hook-transport.mjs`)))
  }
})
