import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { copyOwnLicenseMaterials, OWN_LICENSE_FILES } from './release-own-license.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
// Explicit acceptance roster for this slice; not a final-release SBOM.
const packages = ['core', 'knowledge-ladybug', 'panel', 'provider-web-app', 'skills-web-app',
  'studio', 'studio-ui', 'studio-dsh', 'dsh']
const files = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']
const authority = new Map(await Promise.all(files.map(async name => [name, await readFile(join(root, name))])))
// Package inventory is independently retained; the root additionally describes
// Companion-only bundled components and is not the authority for that scope.
const packageInventory = await readFile(join(root, 'packages/panel/THIRD_PARTY_NOTICES.md'))
assert.equal(createHash('sha256').update(packageInventory).digest('hex'),
  '1d358b1a367efd6f4e0fb04436df7f814531cd6a01a0b2b752d7b8268a461c79')
// Core's source-built Git notices were added in 493ade6; other packages retain
// the prior inventory. Pin both scopes without changing either original text.
const coreInventory = await readFile(join(root, 'packages/core/THIRD_PARTY_NOTICES.md'))
assert.equal(createHash('sha256').update(coreInventory).digest('hex'),
  'a644db7d427d2bb20c71e94fad77e8989e5c0ebfd6bd8d4997eb5471012b7bec')
const knowledgeNotice = Buffer.concat([authority.get('NOTICE'), Buffer.from('\nOfficial @ladybugdb/wasm-core@0.21.1 license and source notices are included in\nlib/third-party/ladybug-wasm-core-0.21.1/. See its LICENSE, README.md, SOURCE.json,\nBUILD-SOURCE.json and source-materials/ indexes for the preserved original texts\nand source correspondence limits. These materials do not establish complete\nbinary inventory or overall release license acceptance.\n')])
const expectedOwnMaterial = (name, file) => file === 'THIRD_PARTY_NOTICES.md'
  ? name === 'core' ? coreInventory : packageInventory
  : name === 'knowledge-ladybug' && file === 'NOTICE'
    ? knowledgeNotice : authority.get(file)

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'release-own-license-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

for (const name of packages) {
  test(`${name}: own license metadata, explicit files and authority bytes in a declared-files fixture`, async t => {
    const source = join(root, 'packages', name)
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    assert.equal(manifest.license, 'Apache-2.0')
    const stage = await fixture(t)
    for (const file of files) {
      assert.ok(manifest.files.includes(file), `${name} must explicitly include ${file}`)
      assert.equal(manifest.files.filter(entry => entry === file).length, 1)
      // This is a declared-files fixture, not npm/pnpm pack acceptance.
      await copyFile(join(source, file), join(stage, file))
      assert.deepEqual(await readFile(join(stage, file)), expectedOwnMaterial(name, file))
    }
    assert.match((await readFile(join(stage, 'NOTICE'), 'utf8')), /does not relicense/u)
    assert.match((await readFile(join(stage, 'THIRD_PARTY_NOTICES.md'), 'utf8')), /not a (?:complete release|whole-product) SBOM/u)
  })
}

test('a content-only package retains its own narrower license inventory', async t => {
  const directory = await fixture(t), source = join(directory, 'content'), stage = join(directory, 'stage')
  await mkdir(source)
  await mkdir(stage)
  const manifest = { name: 'synthetic-content-kit', version: '1.0.0', license: 'Apache-2.0', files: [...files] }
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
  const narrowInventory = Buffer.from('# Third-party licensing inventory\n\nSelf-contained content fixture; no bundled application or Python runtime.\nThis fixture is not a complete release SBOM.\n')
  const materials = new Map(authority)
  materials.set('THIRD_PARTY_NOTICES.md', narrowInventory)
  for (const file of files) await writeFile(join(source, file), materials.get(file))
  const declared = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  assert.equal(declared.license, 'Apache-2.0')
  await copyOwnLicenseMaterials(source, stage)
  for (const file of files) {
    assert.equal(declared.files.filter(entry => entry === file).length, 1)
    assert.deepEqual(await readFile(join(stage, file)), materials.get(file))
  }
  assert.notDeepEqual(await readFile(join(stage, 'THIRD_PARTY_NOTICES.md')), packageInventory)
  assert.match(await readFile(join(stage, 'NOTICE'), 'utf8'), /does not relicense/u)
  assert.match(await readFile(join(stage, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /not a complete release SBOM/u)
})

test('Companion own-material helper stages exact root bytes without replacing third-party notices', async t => {
  assert.deepEqual(OWN_LICENSE_FILES, files)
  const stage = await fixture(t)
  await mkdir(join(stage, 'licenses'))
  await mkdir(join(stage, 'knowledge'))
  await mkdir(join(stage, 'kits'))
  const thirdParty = Buffer.from('Third-party fixture: preserve this original license\n')
  await writeFile(join(stage, 'licenses/DSH-LICENSE'), thirdParty)
  await writeFile(join(stage, 'knowledge/LICENSE'), thirdParty)
  const kit = join(stage, 'kits/web_app')
  await mkdir(kit)
  await copyOwnLicenseMaterials(root, stage)
  await copyOwnLicenseMaterials(join(root, 'packages/skills-web-app'), kit)
  for (const destination of [stage, kit]) for (const file of files) {
    assert.deepEqual(await readFile(join(destination, file)),
      destination === kit ? expectedOwnMaterial('skills-web-app', file) : authority.get(file))
  }
  assert.deepEqual(await readFile(join(stage, 'licenses/DSH-LICENSE')), thirdParty)
  assert.deepEqual(await readFile(join(stage, 'knowledge/LICENSE')), thirdParty)
})

test('an existing overlay license is not overwritten', async t => {
  const stage = await fixture(t)
  await writeFile(join(stage, 'LICENSE'), 'Existing separate license')
  await assert.rejects(copyOwnLicenseMaterials(root, stage), { code: 'EEXIST' })
  assert.equal(await readFile(join(stage, 'LICENSE'), 'utf8'), 'Existing separate license')
  assert.deepEqual(await readdir(stage), ['LICENSE'])
})

test('missing root authority input fails before staging any material', async t => {
  const directory = await fixture(t)
  const source = join(directory, 'source'), stage = join(directory, 'stage')
  await mkdir(source)
  await mkdir(stage)
  await writeFile(join(source, 'LICENSE'), authority.get('LICENSE'))
  await assert.rejects(copyOwnLicenseMaterials(source, stage), { code: 'ENOENT' })
  assert.deepEqual(await readdir(stage), [])
})
