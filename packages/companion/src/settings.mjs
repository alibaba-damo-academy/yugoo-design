import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveMaxSuggestions } from '../../core/lib/index.js'

/** Host-local persistence, using the same setting and policy as DSH. */
export async function createCompanionSettings(stateRoot) {
  const path = join(stateRoot, 'advisory-settings.json')
  let value
  try { value = JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const languages = ['auto', 'zh', 'en'], appearances = ['system', 'light', 'dark']
  let settings = { maxSuggestions: resolveMaxSuggestions(value?.maxSuggestions),
    ...(languages.includes(value?.language) ? { language: value.language } : {}),
    ...(appearances.includes(value?.appearance) ? { appearance: value.appearance } : {}),
  }
  let tail = Promise.resolve()
  return {
    read: () => ({ ...settings }),
    write(input) {
      const result = tail.then(async () => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid settings update')
        const next = { ...settings }
        if (Object.hasOwn(input, 'maxSuggestions')) next.maxSuggestions = resolveMaxSuggestions(input.maxSuggestions)
        if (Object.hasOwn(input, 'language')) {
          if (!languages.includes(input.language)) throw Error('Unsupported interface language')
          next.language = input.language
        }
        if (Object.hasOwn(input, 'appearance')) {
          if (!appearances.includes(input.appearance)) throw Error('Unsupported interface appearance')
          next.appearance = input.appearance
        }
        await mkdir(stateRoot, { recursive: true, mode: 0o700 })
        const temporary = `${path}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
        await rename(temporary, path)
        settings = next
        return { ...settings }
      })
      tail = result.catch(() => {})
      return result
    },
  }
}
