import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadDesignKit } from '../src/kit-loader.ts'

const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const mindsetPath = fileURLToPath(new URL('../../skills-web-app/kits/web_app/mindset.md', import.meta.url))
const original = await readFile(mindsetPath, 'utf8')
const withoutDisplay = original.replace(/\ndisplay_description:\n[\s\S]*?(?=\n---)/, '')
const fs = source => ({
  async readText(path) {
    if (path === mindsetPath) return source
    try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
})
const load = source => loadDesignKit(fs(source), root, { sourceId: 'fixture:kit-display-copy' })

test('optional Kit display copy is bilingual while methods, routing and exact mounts remain unchanged', async () => {
  const translated = await load(original), legacy = await load(withoutDisplay)
  assert.ok(translated.pickerDescription.zh.includes('Web App'))
  assert.ok(translated.pickerDescription.en.includes('web app designs'))
  assert.equal(legacy.pickerDescription, undefined)
  assert.equal(translated.description, legacy.description)
  assert.equal(translated.mindset, legacy.mindset)
  assert.equal(translated.mindsetSource, original)
  assert.deepEqual(translated.skills, legacy.skills)
  assert.deepEqual(translated.resources, legacy.resources)
  assert.ok(Object.isFrozen(translated.pickerDescription))
})

test('present invalid Kit display copy fails actual loading rather than guessing a language', async () => {
  for (const value of ['plain text', '{zh: 中文}', '{zh: 中文, en: 12}', '{zh: " ", en: English}', '[中文, English]']) {
    const source = withoutDisplay.replace('\n---', `\ndisplay_description: ${value}\n---`)
    await assert.rejects(load(source), /display_description.*description/)
  }
})
