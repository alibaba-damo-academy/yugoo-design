import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanionSettings } from '../src/settings.mjs'

test('queued interface and advisory patches survive reopening without overwriting each other', async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-ui-preferences-'))
  try {
    const settings = await createCompanionSettings(root)
    await settings.write({ maxSuggestions: 4 })
    await Promise.all([
      settings.write({ language: 'zh' }),
      settings.write({ appearance: 'dark' }),
      settings.write({ maxSuggestions: 8 }),
    ])
    assert.deepEqual(settings.read(), { maxSuggestions: 8, language: 'zh', appearance: 'dark' })
    const reopened = await createCompanionSettings(root)
    assert.deepEqual(reopened.read(), settings.read())
    await reopened.write({ language: 'auto', appearance: 'system' })
    assert.deepEqual((await createCompanionSettings(root)).read(), { maxSuggestions: 8, language: 'auto', appearance: 'system' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('invalid preferences keep the saved settings and do not poison the save queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-ui-preferences-'))
  try {
    const settings = await createCompanionSettings(root)
    await settings.write({ language: 'en', appearance: 'light', maxSuggestions: 3 })
    const before = await readFile(join(root, 'advisory-settings.json'), 'utf8')
    await assert.rejects(settings.write({ appearance: 'unsupported' }), /Unsupported interface appearance/)
    await assert.rejects(settings.write({ language: 'unsupported' }), /Unsupported interface language/)
    assert.equal(await readFile(join(root, 'advisory-settings.json'), 'utf8'), before)
    await settings.write({ appearance: 'dark' })
    assert.deepEqual(settings.read(), { maxSuggestions: 3, language: 'en', appearance: 'dark' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('actual disk failure preserves accepted state and a later retry can save', async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-ui-preferences-'))
  try {
    const settings = await createCompanionSettings(root)
    await settings.write({ maxSuggestions: 4, language: 'en' })
    await rm(root, { recursive: true })
    await writeFile(root, 'blocked directory')
    await assert.rejects(settings.write({ appearance: 'dark' }))
    assert.deepEqual(settings.read(), { maxSuggestions: 4, language: 'en' })
    await rm(root)
    await settings.write({ appearance: 'dark' })
    assert.deepEqual((await createCompanionSettings(root)).read(), { maxSuggestions: 4, language: 'en', appearance: 'dark' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
