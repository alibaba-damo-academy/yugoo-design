/** Reject legacy model-visible U/S/T XML from current Design surfaces. */
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const legacyTag = new RegExp(`</?(?:${['u', 's', 't'].join('|')})_clarity\\b`)
const files = [
  join(root, 'README.md'),
  join(root, 'packages', 'skills-web-app', 'kits', 'web_app', 'mindset.md'),
  join(root, 'scripts', 'mock-design-server.mjs'),
  join(root, 'scripts', 'mock-gra-server.mjs'),
]

async function collect(directory, accept) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path, accept)
    else if (accept(path)) files.push(path)
  }
}

await collect(join(root, 'packages', 'core', 'src'), path => extname(path) === '.ts')
await collect(join(root, 'packages', 'skills-web-app', 'bundles'), path => path.endsWith('SKILL.md'))
await collect(join(root, 'docs'), path => path.endsWith('.md') && !path.endsWith('migration-notes.md'))

const violations = []
for (const path of files) {
  const lines = (await readFile(path, 'utf8')).split('\n')
  for (const [index, line] of lines.entries()) {
    if (legacyTag.test(line)) violations.push(`${relative(root, path)}:${index + 1}`)
  }
}
if (violations.length > 0) {
  throw new Error(`legacy clarity XML remains on current surfaces:\n${violations.join('\n')}`)
}
console.log('NO LEGACY CLARITY XML OK')
