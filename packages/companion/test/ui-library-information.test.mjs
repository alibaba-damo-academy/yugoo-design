import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { studioUiLibraries } from '../src/ui-library-information.ts'

test('UI library display versions come from the dependencies this browser build resolves, not copied ranges', async () => {
  const names = new Set()
  for (const library of studioUiLibraries) {
    assert.ok(!names.has(library.packageName), `duplicate ${library.packageName}`)
    names.add(library.packageName)
    const owner = library.packageName === 'react' || library.packageName === 'react-dom' ? 'panel' : 'provider-web-app'
    const metadata = JSON.parse(await readFile(new URL(`../../${owner}/node_modules/${library.packageName}/package.json`, import.meta.url), 'utf8'))
    assert.equal(library.packageName, metadata.name)
    assert.equal(library.version, metadata.version)
    assert.match(library.version, /^\d+\.\d+\.\d+/)
    assert.ok(library.purpose.zh.length > 0 && library.purpose.en.length > 0)
    assert.ok(['foundation', 'controls', 'visualization'].includes(library.group))
  }
  assert.ok(names.has('@xyflow/react') && names.has('@radix-ui/react-dialog') && names.has('react'))
  assert.equal(names.size, studioUiLibraries.length)
})
