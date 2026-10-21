import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { validateCanonicalDocumentLinks } from './public-document-projection.mjs'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { inspectPublicSnapshot } from './public-snapshot-preflight.mjs'
import { runPublicExport } from './public-export.mjs'

const roots = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md']
const digest = value => createHash('sha256').update(value).digest('hex')
async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'canonical-public-docs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const files = {
    'README.md': '# Shared product\r\n[![Host](https://example.org/badge.svg)](docs/wiki/guide.md#安装)\r\n[Contribute](CONTRIBUTING.md)\r\n',
    'CONTRIBUTING.md': '# Contributing\n[Home](README.md)\n',
    'SECURITY.md': '# Security\n[Home](README.md)\n',
    'docs/wiki/guide.md': '# 使用指南\n## 安装\n[Home](../../README.md)\n',
    'release/README.public.md': 'Superseded draft\n',
    'docs/internal/history.md': 'Internal original\n',
    ...extra,
  }
  for (const [path, value] of Object.entries(files)) {
    await mkdir(dirname(join(source, path)), { recursive: true })
    await writeFile(join(source, path), value)
  }
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
  git(['init', '-q']); git(['add', '.'])
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'canonical source'])
  const policy = { version: 1, rules: Object.keys(files).map(path => ({ kind: 'file', path,
    action: path.startsWith('release/') || path.startsWith('docs/internal/') ? 'exclude' : 'include', reason: 'synthetic explicit classification' })) }
  return { root, source, files, policy, revision: git(['rev-parse', 'HEAD']), git }
}

test('canonical root and Wiki export exact committed bytes, preserving dirty inputs and excluding historical sources', async t => {
  const f = await fixture(t, { 'README.en.md': '# Shared design\r\n[简体中文](README.md)\r\n' })
  for (const path of ['README.md', 'README.en.md', 'docs/wiki/guide.md']) await writeFile(join(f.source, path), 'Uncommitted user edits\n')
  const result = await stagePublicSnapshot({ ...f, publicDocuments: true, destination: join(f.root, 'stage') })
  for (const path of [...roots, 'README.en.md', 'docs/wiki/guide.md']) {
    assert.equal(await readFile(join(result.target, path), 'utf8'), f.files[path])
    assert.equal(result.manifest.files[path].sha256, digest(f.files[path]))
  }
  assert.equal(await readFile(join(f.source, 'README.md'), 'utf8'), 'Uncommitted user edits\n')
  assert.equal(await readFile(join(f.source, 'README.en.md'), 'utf8'), 'Uncommitted user edits\n')
  for (const path of ['release/README.public.md', 'docs/internal/history.md']) await assert.rejects(access(join(result.target, path)))
  assert.deepEqual(result.manifest.transforms, [])
  assert.equal(result.manifest.releaseApproved, false)
  assert.equal(result.targetCheckoutUpdated, false)
})

test('missing canonical roots, outer badge anchors and unselected Wiki references refuse staging before directory creation', async t => {
  const cases = [
    { extra: { 'README.md': '[![Host](https://example.org/badge.svg)](docs/wiki/guide.md#missing)\n' }, reason: /links are not closed.*anchor_not_found/ },
    { extra: { 'docs/wiki/guide.md': '# 使用指南\n## 安装\n[Internal](../internal/history.md)\n' }, reason: /links are not closed.*file_not_selected/ },
    { extra: { 'README.en.md': '# English\n[Internal](docs/internal/history.md)\n' }, reason: /links are not closed.*file_not_selected/ },
    { extra: { 'README.en.md': '# English\n[Chinese](README.md#missing)\n' }, reason: /links are not closed.*anchor_not_found/ },
    { exclude: 'SECURITY.md', reason: /canonical root documents/ },
    { exclude: 'docs/wiki/guide.md', reason: /links are not closed/ },
    { extra: { 'README.md': Buffer.from([0xff, 0xfe]) }, reason: /source review is incomplete/ },
  ]
  for (const item of cases) {
    const f = await fixture(t, item.extra)
    if (item.exclude) f.policy.rules.find(rule => rule.path === item.exclude).action = 'exclude'
    const destination = join(f.root, 'blocked')
    await assert.rejects(stagePublicSnapshot({ ...f, publicDocuments: true, destination }), item.reason)
    await assert.rejects(access(destination))
  }
})

test('canonical links resolve directories to selected READMEs, Unicode/duplicate heading anchors and skip fenced examples', () => {
  const documents = { 'README.md': '[目录](docs/) [第二标题](docs/README.md#使用-1)\n```md\n[x](private.md)\n```\n',
    'docs/README.md': '# 使用\n# 使用\n' }
  const result = validateCanonicalDocumentLinks({ documents, includedPaths: Object.keys(documents) })
  assert.equal(result.localFileLinksClosed, true)
  assert.equal(result.anchorsValidated, true)
  assert.equal(result.links.length, 2)
  assert.equal(validateCanonicalDocumentLinks({ documents: { 'README.md': '[Source](src/)' },
    includedPaths: ['README.md', 'src/index.ts'] }).localFileLinksClosed, true)
  assert.equal(validateCanonicalDocumentLinks({ documents: { 'README.md': '[Source](private/)' },
    includedPaths: ['README.md', 'src/index.ts'] }).localFileLinksClosed, false)
  for (const href of ['../escape.md', '/absolute.md', 'javascript:alert', 'file:///secret', '//remote/x', 'docs/%2e%2e/private.md']) {
    assert.throws(() => validateCanonicalDocumentLinks({ documents: { 'README.md': `[x](${href})` }, includedPaths: ['README.md'] }))
  }
  for (const source of ['<img src="private.png">', '[x]: private.md']) {
    assert.throws(() => validateCanonicalDocumentLinks({ documents: { 'README.md': source }, includedPaths: ['README.md'] }), /separate review/)
  }
})

test('complete historical draft selection remains readable while partial draft selection cannot change document authority', async t => {
  const f = await fixture(t, {
    'release/README.public.md': '# Previous public\n[Contribute](CONTRIBUTING.public.md)\n',
    'release/CONTRIBUTING.public.md': '[Home](README.public.md)\n',
    'release/SECURITY.public.md': '[Home](README.public.md)\n',
  })
  for (const rule of f.policy.rules) if (rule.path.startsWith('release/')) rule.action = 'include'
  const old = await stagePublicSnapshot({ ...f, publicDocuments: true, destination: join(f.root, 'legacy') })
  assert.equal(old.manifest.transforms.length, 3)
  assert.equal(await readFile(join(old.target, 'README.md'), 'utf8'), '# Previous public\n[Contribute](CONTRIBUTING.md)\n')
  const plan = await inspectPublicSync({ stageRoot: old.target, targetRoot: join(f.root, 'untouched') })
  assert.equal(plan.applicable, true)
  const policy = structuredClone(f.policy)
  policy.rules.find(rule => rule.path === 'release/SECURITY.public.md').action = 'exclude'
  await assert.rejects(stagePublicSnapshot({ ...f, policy, publicDocuments: true, destination: join(f.root, 'partial') }), /drafts must be reviewed/)
  await assert.rejects(access(join(f.root, 'partial')))
})

test('the existing export CLI applies canonical docs to an isolated target and then protects local edits', async t => {
  const f = await fixture(t)
  const policy = join(f.root, 'policy.json'); await writeFile(policy, JSON.stringify(f.policy))
  const stage = join(f.root, 'stage'), target = join(f.root, 'target'), preparation = join(f.root, 'prepare')
  await mkdir(target); await mkdir(join(target, '.git'))
  await writeFile(join(target, '.git/config'), 'Owned fixture Git metadata\n')
  await writeFile(join(target, 'user-note.txt'), 'Unmanaged user content\n')
  await runPublicExport(['stage', '--source', f.source, '--revision', f.revision, '--policy', policy,
    '--destination', stage, '--public-documents', 'true'])
  const plan = await runPublicExport(['inspect', '--stage', stage, '--target', target])
  assert.equal(plan.applicable, true)
  const prepared = await runPublicExport(['prepare', '--stage', stage, '--target', target, '--preparation', preparation,
    '--stage-sha256', plan.stageManifestSha256, '--target-sha256', plan.targetStateSha256])
  await runPublicExport(['verify', '--preparation', preparation, '--receipt-sha256', prepared.preparedSha256])
  const applied = await runPublicExport(['apply', '--preparation', preparation, '--receipt-sha256', prepared.preparedSha256,
    '--stage-sha256', plan.stageManifestSha256, '--target-sha256', plan.targetStateSha256])
  assert.equal(applied.publicationReady, false)
  assert.equal(await readFile(join(target, 'README.md'), 'utf8'), f.files['README.md'])
  assert.equal(await readFile(join(target, '.git/config'), 'utf8'), 'Owned fixture Git metadata\n')
  assert.equal(await readFile(join(target, 'user-note.txt'), 'utf8'), 'Unmanaged user content\n')
  assert.deepEqual((await runPublicExport(['inspect', '--stage', stage, '--target', target])).writes, [])
  await writeFile(join(target, 'README.md'), 'Local human edit\n')
  assert.equal((await runPublicExport(['inspect', '--stage', stage, '--target', target])).applicable, false)
  assert.equal(await readFile(join(target, 'README.md'), 'utf8'), 'Local human edit\n')
})

const repo = fileURLToPath(new URL('../', import.meta.url))
const actualPolicy = () => JSON.parse(readFileSync(join(repo, 'release/public-source-policy.json'), 'utf8'))
const classify = (policy, path) => policy.rules.find(rule => rule.kind === 'file' ? rule.path === path : path.startsWith(rule.path))?.action ?? 'review'
test('actual classification keeps canonical docs public, excludes retained originals and limits companion-dev to its directory', async t => {
  const p = actualPolicy()
  for (const path of [...roots, 'README.en.md', 'docs/wiki/README.md', 'docs/wiki/hosts.md', 'docs/public-document-sync.md']) assert.equal(classify(p, path), 'include', path)
  for (const path of ['docs/documentation-todo.md', 'release/README.public.md', 'docs/internal/documentation-first-pass/README.md']) assert.equal(classify(p, path), 'exclude', path)
  const f = await fixture(t, { 'packages/companion-dev/example.mjs': '// synthetic developer helper\n',
    'packages/companion-dev-tools/example.mjs': '// unknown neighboring directory\n' })
  const result = inspectPublicSnapshot({ source: f.source, revision: f.revision, policy: { version: p.version, rules: p.rules } })
  assert.equal(result.entries.find(entry => entry.path === 'packages/companion-dev/example.mjs').action, 'include')
  // The existing packages/ fallback remains authoritative; the corrected narrow
  // prefix must not claim this sibling even if that later rule includes it.
  assert.equal(p.rules.find(rule => rule.kind === 'file' ? rule.path === 'packages/companion-dev-tools/example.mjs' : 'packages/companion-dev-tools/example.mjs'.startsWith(rule.path)).path, 'packages/')
  assert.equal(result.releaseApproved, false)
})

test('actual canonical README/Wiki links close against the reviewed file selection', async () => {
  const p = actualPolicy()
  const wiki = (await readdir(join(repo, 'docs/wiki'))).filter(path => path.endsWith('.md')).map(path => `docs/wiki/${path}`)
  const publicRoots = [...roots, 'README.en.md', 'AGENTS.md', 'docs/public-document-sync.md']
  const tracked = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).trim().split('\n')
  const selected = [...new Set([...tracked, ...publicRoots, ...wiki])].filter(path => classify(p, path) === 'include')
  const documents = Object.fromEntries([...publicRoots, ...wiki].map(path => [path, readFileSync(join(repo, path), 'utf8')]))
  const result = validateCanonicalDocumentLinks({ documents, includedPaths: selected,
    readTarget: path => readFileSync(join(repo, path), 'utf8') })
  assert.deepEqual(result.missing, [])
  assert.equal(result.localFileLinksClosed, true)
})
