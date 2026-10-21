'use strict'
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const root = join(__dirname, '..')
const source = JSON.parse(readFileSync(join(root, 'SOURCE.json'), 'utf8'))
const listed = source.artifacts.map(item => item.path).sort()
const actual = readdirSync(join(root, 'native')).filter(name => name.endsWith('.node')).map(name => `native/${name}`).sort()
if (JSON.stringify(actual) !== JSON.stringify(listed)) throw Error('Native Git prebuild inventory does not match SOURCE.json')
for (const item of source.artifacts) {
  const bytes = readFileSync(join(root, item.path))
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    throw Error(`Native Git prebuild does not match its build receipt: ${item.path}`)
  }
}
for (const item of source.inputs) {
  const bytes = readFileSync(join(root, item.path))
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error(`Native Git build input changed: ${item.path}`)
}
console.log(`Verified ${listed.length} source-built Native Git artifact(s).`)
