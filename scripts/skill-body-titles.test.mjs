/** Authoring-only prose check; never a runtime Kit loading or routing gate. */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const packages = await readdir(join(root, 'packages'), { withFileTypes: true })
const roots = [
  ...packages.filter(entry => entry.isDirectory() && entry.name.startsWith('skills-')).map(entry => `packages/${entry.name}`),
  'packages/panel/fixtures', 'packages/companion/plugin',
  'packages/companion/plugin-claude', 'packages/companion/plugin-qoder',
  'scripts/fixtures', 'examples', '.agents/skills',
]
const excluded = new Set(['node_modules', '.git', 'lib', 'dist', 'dist-server'])
async function skillFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await skillFiles(path))
    else if (entry.isFile() && /^skill\.md$/i.test(entry.name)) files.push(path)
  }
  return files
}

function headings(markdown) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '')
  const result = []
  let fence
  for (const line of body.split(/\r?\n/u)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
      continue
    }
    if (fence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(line)
    if (match) result.push({ level: match[1].length, text: match[2] })
  }
  return result
}
function assertReadableTitle(markdown) {
  const titles = headings(markdown)
  assert.equal(titles[0]?.level, 1, 'Start the body with a readable H1, not a peer-level section heading')
  assert.doesNotMatch(titles[0].text.replaceAll('`', ''), /^[a-z][a-z0-9_-]*$/u, 'Do not use a bare internal identifier as the body title')
  for (const title of titles) {
    assert.doesNotMatch(title.text.replaceAll('`', ''), /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u, 'Use readable headings, not bare snake_case identifiers')
  }
}

test('readable title check rejects identifier headings without inspecting technical body references', () => {
  assert.throws(() => assertReadableTitle('## business_data\n\nMethod.'), /readable H1/)
  assert.throws(() => assertReadableTitle('# business_data\n\nMethod.'), /internal identifier/)
  assert.throws(() => assertReadableTitle('# research\n\nMethod.'), /internal identifier/)
  assert.throws(() => assertReadableTitle('# Business Objects\n\n## business_data'), /snake_case/)
  assert.doesNotThrow(() => assertReadableTitle('---\nname: business_data\n---\n\n# Business Objects\n\nRead `business_data/business_data.json`.\n```md\n## example_id\n```'))
  assert.doesNotThrow(() => assertReadableTitle('# Research\n\n## Output contract'))
  assert.doesNotThrow(() => assertReadableTitle('# 对象与关系\n\n## 使用方式'))
})

const files = (await Promise.all(roots.map(path => skillFiles(join(root, path))))).flat().sort()
assert.ok(files.length > 0, 'Current Skill source inventory must not be empty')
for (const file of files) {
  test(`readable Skill title: ${relative(root, file)}`, async () => {
    assertReadableTitle(await readFile(file, 'utf8'))
  })
}
