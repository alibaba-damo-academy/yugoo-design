import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectPublicSnapshot } from './public-snapshot-preflight.mjs'

test('invalid UTF-8 without NUL is not silently approved as public text', t => {
  const root = mkdtempSync(join(tmpdir(), 'public-utf8-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' },
  }).trim()
  git(['init', '-q'])
  writeFileSync(join(root, 'invalid.txt'), Buffer.from([0x61, 0xc3, 0x28, 0x0a]))
  writeFileSync(join(root, 'valid.txt'), '有效 Unicode text\n')
  git(['add', '--', 'invalid.txt', 'valid.txt'])
  git(['commit', '-qm', 'UTF-8 fixture'])
  const result = inspectPublicSnapshot({ source: root, revision: git(['rev-parse', 'HEAD']),
    policy: { version: 1, rules: ['invalid.txt', 'valid.txt'].map(path => ({
      kind: 'file', path, action: 'include', reason: 'Synthetic test input',
    })) } })
  assert.deepEqual(result.entries.find(x => x.path === 'valid.txt').findings, [])
  assert.deepEqual(result.entries.find(x => x.path === 'invalid.txt').findings,
    [{ kind: 'invalid_utf8_manual_review' }])
  assert.equal(result.automatedChecksPassed, false)
  assert.equal(result.blockedFiles, 1)
  assert.equal(result.releaseApproved, false)
})
