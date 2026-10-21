import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { assertWebAppContentManifest, assertNativeGitManifest } from './release-physical-distribution-gate.mjs'

const gate = new URL('./release-physical-distribution-gate.mjs', import.meta.url)

test('physical gate import-safety regression is registered exactly once in the source contract suite', () => {
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const command = root.scripts['test:public-contracts'].split(/\s+/u)
  assert.deepEqual(command.slice(0, 2), ['node', '--test'])
  assert.equal(command.filter(arg => arg === 'scripts/release-physical-entry.test.mjs').length, 1)
})

test('real gate import performs no argument parsing, writes or subprocess calls', t => {
  const root = mkdtempSync(join(tmpdir(), 'physical-gate-import-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const args of [[], ['--not-a-gate-option']]) {
    const script = `
      import fs from 'node:fs';
      import fsp from 'node:fs/promises';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const forbidden = () => { throw new Error('IMPORT_SIDE_EFFECT'); };
      for (const key of ['mkdirSync', 'mkdtempSync', 'writeFileSync', 'renameSync', 'rmSync']) fs[key] = forbidden;
      for (const key of ['mkdir', 'mkdtemp', 'writeFile', 'rename', 'rm']) fsp[key] = forbidden;
      for (const key of ['spawn', 'spawnSync', 'exec', 'execFile', 'execFileSync', 'fork']) childProcess[key] = forbidden;
      syncBuiltinESMExports();
      process.argv = [process.execPath, 'unrelated-importer.mjs', ...${JSON.stringify(args)}];
      const module = await import(${JSON.stringify(gate.href)});
      if (typeof module.runPhysicalDistributionGate !== 'function') throw new Error('MISSING_ENTRY');
      console.log('IMPORT_ONLY_OK');
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH, TMPDIR: root },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'IMPORT_ONLY_OK')
    assert.equal(result.stderr, '')
    assert.deepEqual(readdirSync(root), [])
  }
})

test('explicit CLI entry still rejects invalid options before creating evidence or running commands', t => {
  const root = mkdtempSync(join(tmpdir(), 'physical-gate-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [fileURLToPath(gate), '--not-a-gate-option'], {
    cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    env: { PATH: process.env.PATH, TMPDIR: root },
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical gate|physical-gate|Unknown|unknown|Invalid|invalid/)
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/)
  assert.equal(result.stdout, '')
  assert.deepEqual(readdirSync(root), [])
})


test('physical content contract accepts the migrated package and rejects incomplete or executable content', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/skills-web-app/package.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => assertWebAppContentManifest(manifest))
  for (const invalid of [
    { ...manifest, files: ['mindset.md', 'relations.yaml', 'skills', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'] },
    { ...manifest, files: manifest.files.filter(file => file !== 'bundles') },
    { ...manifest, files: [...manifest.files, 'test'] },
    { ...manifest, files: manifest.files.filter(file => file !== 'NOTICE') },
    { ...manifest, main: 'index.js' },
    { ...manifest, exports: './index.js' },
  ]) assert.throws(() => assertWebAppContentManifest(invalid), { name: 'AssertionError' })
})

test('native Git release keeps upstream materials and rejects missing prebuilds or user install hooks', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/git-native/package.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => assertNativeGitManifest(manifest))
  for (const invalid of [
    { ...manifest, license: 'Apache-2.0' },
    ...['native/*.node', 'SOURCE.json', 'native-source/**', 'third-party/**'].map(file => ({ ...manifest, files: manifest.files.filter(entry => entry !== file) })),
    ...['preinstall', 'install', 'postinstall'].map(hook => ({ ...manifest, scripts: { ...manifest.scripts, [hook]: 'download-or-build' } })),
  ]) assert.throws(() => assertNativeGitManifest(invalid), { name: 'AssertionError' })
})
