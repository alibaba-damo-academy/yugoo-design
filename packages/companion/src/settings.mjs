import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveMaxSuggestions } from '../../core/lib/index.js'

/** Host-local persistence, using the same setting and policy as DSH. */
export async function createCompanionSettings(stateRoot) {
  const path = join(stateRoot, 'advisory-settings.json')
  let value
  try { value = JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  let settings = { maxSuggestions: resolveMaxSuggestions(value?.maxSuggestions) }
  let tail = Promise.resolve()
  return {
    read: () => ({ ...settings }),
    write(input) {
      const next = { maxSuggestions: resolveMaxSuggestions(input.maxSuggestions) }
      const result = tail.then(async () => {
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
