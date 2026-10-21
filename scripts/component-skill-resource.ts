/** Build-time raw Skill import; Vite's dev raw loader uses the same source file. */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { Plugin } from 'rolldown'

export function componentSkillResource(): Plugin {
  return { name: 'component-skill-resource',
    resolveId(source, importer) {
      if (!source.endsWith('/skills/design-component/SKILL.md?raw') || !importer) return null
      return resolve(dirname(importer), source.slice(0, -4)) + '?raw'
    },
    async load(id) {
      if (!id.endsWith('/skills/design-component/SKILL.md?raw')) return null
      return { code: `export default ${JSON.stringify(await readFile(id.slice(0, -4), 'utf8'))}`, moduleType: 'js' }
    },
  }
}
