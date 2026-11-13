import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDesignKit } from '../../core/lib/kit-loader.js'
import { writeContentCatalog } from '../../core/test/fixtures/content-catalog.mjs'
import { companionFs } from '../src/project.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'companion-kit-confinement-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const kit = join(root, 'kit')
  const source = await writeContentCatalog(kit, { name: 'confinement_fixture', bundles: [{ name: 'alpha' }] })
  return { root, kit, bundle: join(source.bundlesRoot, 'alpha') }
}

test('Companion Kit adapter rejects an external locale before reading its bytes', async t => {
  const { root, kit, bundle } = await fixture(t)
  const locale = join(bundle, 'locales/en-US.json')
  const outside = join(root, 'synthetic-outside-locale.json')
  await writeFile(outside, await readFile(locale))
  await unlink(locale)
  await symlink(outside, locale)
  let outsideReads = 0
  await assert.rejects(loadDesignKit({ ...companionFs, readText: async path => {
    if (path === locale) outsideReads++
    return companionFs.readText(path)
  } }, kit, { sourceId: 'fixture:companion-kit' }), /escapes (?:Kit|Bundle) root/)
  assert.equal(outsideReads, 0)
})

test('Companion Kit adapter rejects external resources but accepts normal installed content', async t => {
  const { root, kit, bundle } = await fixture(t)
  const normal = await loadDesignKit(companionFs, kit, { sourceId: 'fixture:companion-kit' })
  assert.equal(normal.name, 'confinement_fixture')
  assert.ok(normal.skills.some(skill => skill.name === 'alpha'))
  const outside = join(root, 'synthetic-outside-resource.txt')
  await writeFile(outside, 'Synthetic outside fixture, never a real credential.')
  await symlink(outside, join(bundle, 'outside-resource.txt'))
  await assert.rejects(loadDesignKit(companionFs, kit, { sourceId: 'fixture:companion-kit' }), /escapes (?:Kit|Bundle) root/)
  assert.equal(await readFile(outside, 'utf8'), 'Synthetic outside fixture, never a real credential.')
})
