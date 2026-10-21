import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_OFFICIAL_DSH_JSON_ROOT, OFFICIAL_DSH_JSON_AUTHORITY, readOfficialDshJsonInput } from './official-dsh-json-input.mjs'

async function external(t) {
  const parent = await mkdtemp(join(await realpath(tmpdir()), 'official json input '))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'explicit input with spaces')
  await cp(DEFAULT_OFFICIAL_DSH_JSON_ROOT, root, { recursive: true })
  return { parent, root }
}

test('default retained input validates authority and both unchanged upstream files offline', async () => {
  const input = await readOfficialDshJsonInput()
  assert.equal(input.authority, OFFICIAL_DSH_JSON_AUTHORITY)
  assert.deepEqual(input.jsonBytes, await readFile(input.jsonPath))
  assert.deepEqual(input.licenseBytes, await readFile(input.licensePath))
  assert.equal(input.resolveId('@deepseek-ai/dsh-session'), input.jsonPath)
  assert.equal(input.resolveId('yaml'), null)
  for (const name of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-session/internal', '@deepseek-ai/dsh-host-webserver']) {
    assert.throws(() => input.resolveId(name), /must not load DSH runtime/u)
  }
  assert.throws(() => { OFFICIAL_DSH_JSON_AUTHORITY.files.LICENSE = 'caller supplied hash' }, TypeError)
})

test('explicit external root with spaces yields identical content without changing files', async t => {
  const { root } = await external(t)
  const before = await readFile(join(root, 'provenance.json'))
  const input = await readOfficialDshJsonInput({ inputRoot: root })
  const retained = await readOfficialDshJsonInput()
  assert.equal(input.root, root)
  assert.deepEqual(input.jsonBytes, retained.jsonBytes)
  assert.deepEqual(input.licenseBytes, retained.licenseBytes)
  assert.deepEqual(await readFile(join(root, 'provenance.json')), before)
})

test('wrong helper or license bytes fail even if the other file is correct', async t => {
  for (const path of Object.keys(OFFICIAL_DSH_JSON_AUTHORITY.files)) {
    const { root } = await external(t)
    await writeFile(join(root, path), 'tampered upstream input')
    await assert.rejects(readOfficialDshJsonInput({ inputRoot: root }), /Official input hash mismatch/u)
  }
})

test('wrong provenance repository, commit, license, hashes, URLs or file set fail', async t => {
  const { root } = await external(t)
  const path = join(root, 'provenance.json')
  const original = JSON.parse(await readFile(path))
  const changes = [
    p => { p.repository = 'https://example.invalid/fork' },
    p => { p.commit = '6a59c23bd96c9bdf72f94e9962294c4f4eb3a322' },
    p => { p.license = 'Apache-2.0' },
    p => { p.files.LICENSE.sha256 = '0'.repeat(64) },
    p => { p.files.LICENSE.url = 'https://example.invalid/LICENSE' },
    p => { delete p.files.LICENSE },
    p => { p.files.EXTRA = { sha256: '0'.repeat(64) } },
  ]
  for (const change of changes) {
    const mutated = structuredClone(original); change(mutated)
    await writeFile(path, JSON.stringify(mutated))
    await assert.rejects(readOfficialDshJsonInput({ inputRoot: root }))
  }
  await writeFile(path, '{invalid JSON')
  await assert.rejects(readOfficialDshJsonInput({ inputRoot: root }), SyntaxError)
})

test('missing metadata or either input never falls back or silently skips', async t => {
  for (const path of ['provenance.json', ...Object.keys(OFFICIAL_DSH_JSON_AUTHORITY.files)]) {
    const { root } = await external(t)
    await rm(join(root, path))
    await assert.rejects(readOfficialDshJsonInput({ inputRoot: root }), { code: 'ENOENT' })
  }
})

test('root, intermediate directory and file symlinks are rejected', async t => {
  const { root, parent } = await external(t)
  const alias = join(parent, 'root alias')
  await symlink(root, alias)
  await assert.rejects(readOfficialDshJsonInput({ inputRoot: alias }), /root must be a regular directory/u)
  await rm(join(root, 'LICENSE'))
  await symlink(join(DEFAULT_OFFICIAL_DSH_JSON_ROOT, 'LICENSE'), join(root, 'LICENSE'))
  await assert.rejects(readOfficialDshJsonInput({ inputRoot: root }), /symlink rejected/u)
  await rm(join(root, 'LICENSE'))
  await cp(join(DEFAULT_OFFICIAL_DSH_JSON_ROOT, 'LICENSE'), join(root, 'LICENSE'))
  await rm(join(root, 'packages'), { recursive: true })
  await symlink(join(DEFAULT_OFFICIAL_DSH_JSON_ROOT, 'packages'), join(root, 'packages'))
  await assert.rejects(readOfficialDshJsonInput({ inputRoot: root }), /symlink rejected/u)
})
