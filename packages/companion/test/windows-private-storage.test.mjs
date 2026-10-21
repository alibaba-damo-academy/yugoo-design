import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertWindowsPrivate, ensureWindowsPrivateDirectory } from '../src/windows-private-storage.mjs'
import { windowsProcess, windowsCurrentSid, windowsSystemTool } from '../src/windows-native-platform.mjs'

test('actual Windows ACL and process facts fail closed in an owned temporary directory', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-windows-acl-'))
  t.diagnostic(`Owned evidence retained at ${root}`)
  const sid = await windowsCurrentSid()
  await promisify(execFile)(windowsSystemTool('icacls.exe'), [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`])
  const directory = join(root, 'private')
  try { await ensureWindowsPrivateDirectory(directory) } catch (error) {
    if (!/ancestor.*(?:replaceable|untrusted owner)/.test(error.message)) throw error
    await assert.rejects(lstat(directory), /ENOENT/)
    t.diagnostic('Unsafe Temp ancestry refused before creation; positive private-storage checks require a trusted Windows root and were not run.')
    return
  }
  await ensureWindowsPrivateDirectory(directory)
  const file = join(directory, 'binding.json')
  await writeFile(file, '{}')
  await assertWindowsPrivate(file)
  await promisify(execFile)(windowsSystemTool('icacls.exe'), [file, '/grant', '*S-1-1-0:R'])
  await assert.rejects(assertWindowsPrivate(file), /another principal/)
  const inherited = join(root, 'inherited')
  await mkdir(inherited)
  await assert.rejects(ensureWindowsPrivateDirectory(inherited), /inheritance mismatch/)
  await promisify(execFile)(windowsSystemTool('icacls.exe'), [inherited, '/grant', '*S-1-1-0:(OI)(CI)F'])
  await assert.rejects(ensureWindowsPrivateDirectory(join(inherited, 'new')), /replaceable/)
  await assert.rejects(readFile(join(inherited, 'new', 'binding.json')), /ENOENT/)
  const junction = join(root, 'junction')
  await symlink(directory, junction, 'junction')
  await assert.rejects(assertWindowsPrivate(join(junction, 'binding.json')), /reparse point/)
  await assert.rejects(ensureWindowsPrivateDirectory(join(junction, 'new')), /reparse point/)
  const first = await windowsProcess(process.pid), second = await windowsProcess(process.pid)
  assert.equal(first.procStart, second.procStart)
  assert.equal(first.parent, process.ppid)
  await assert.rejects(windowsProcess(2147483647), /ended/)
})
