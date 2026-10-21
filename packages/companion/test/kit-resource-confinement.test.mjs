import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDesignKit } from '../../core/lib/kit-loader.js'
import { companionFs } from '../src/project.mjs'

const source = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'companion-kit-confinement-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const kit = join(root, 'kit')
  await cp(source, kit, { recursive: true })
  return { root, kit }
}

test('Companion Kit adapter rejects an external locale before reading its bytes', async t => {
  const { root, kit } = await fixture(t)
  const locale = join(kit, 'skills/business_rules/locales/en-US.json')
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
  const { root, kit } = await fixture(t)
  const normal = await loadDesignKit(companionFs, kit, { sourceId: 'fixture:companion-kit' })
  assert.equal(normal.name, 'web_app')
  assert.ok(normal.skills.some(skill => skill.name === 'business_rules'))
  const outside = join(root, 'synthetic-outside-resource.txt')
  await writeFile(outside, 'Synthetic outside fixture, never a real credential.')
  await symlink(outside, join(kit, 'skills/business_rules/outside-resource.txt'))
  await assert.rejects(loadDesignKit(companionFs, kit, { sourceId: 'fixture:companion-kit' }), /escapes (?:Kit|Bundle) root/)
  assert.equal(await readFile(outside, 'utf8'), 'Synthetic outside fixture, never a real credential.')
})
