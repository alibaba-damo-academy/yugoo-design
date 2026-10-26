'use strict'
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const root = join(__dirname, '..')
const source = JSON.parse(readFileSync(join(root, 'SOURCE.json'), 'utf8'))
const args = process.argv.slice(2)
const target = args.length === 2 && args[0] === '--target' ? args[1] : undefined
if (args.length && (!target || !source.artifacts.some(item => item.target === target))) throw Error('Use --target <declared-target> for a local-only check, or no arguments for the full package inventory')
const listed = source.artifacts.map(item => item.path).sort()
const actual = readdirSync(join(root, 'native')).filter(name => name.endsWith('.node')).map(name => `native/${name}`).sort()
if (actual.some(item => !listed.includes(item)) || (!target && JSON.stringify(actual) !== JSON.stringify(listed))) throw Error('Native Git prebuild inventory does not match SOURCE.json')
const selected = source.artifacts.filter(item => !target || item.target === target)
for (const item of selected) {
  const bytes = readFileSync(join(root, item.path))
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    throw Error(`Native Git prebuild does not match its build receipt: ${item.path}`)
  }
}
for (const item of source.inputs) {
  const bytes = readFileSync(join(root, item.path))
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error(`Native Git build input changed: ${item.path}`)
}
console.log(`Verified ${selected.length} source-built Native Git artifact(s)${target ? ` for ${target} only; full package inventory not verified` : ' (full package inventory)'}.`)
