import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dshClientStyles } from '../../../scripts/tsdown-client-styles.ts'

test('same-basename sheets coexist, same source remains deduplicated and HMR-owned', () => {
  const loader = dshClientStyles('design-companion', new URL('../tsdown.config.ts', import.meta.url).href)
  const code = name => {
    const id = loader.resolveId(name, new URL('../src/client.tsx', import.meta.url).pathname)
    return loader.load.call({ addWatchFile() {} }, id).code
  }
  const a = code('../../panel/src/client/generated/design.tw.css')
  const b = code('../../provider-web-app/src/client/generated/design.tw.css')
  const id = source => source.match(/const tagId = (.*);/)[1]
  assert.notEqual(id(a), id(b))
  assert.equal(id(a), id(code('../../panel/src/client/generated/design.tw.css')))
  assert.ok(a.includes('tag.dataset.plugin = "design-companion"'))
  const tags = new Map()
  const document = {
    querySelector(selector) { return tags.get(selector) ?? null },
    createElement() { return { dataset: {} } },
    head: { appendChild(tag) { tags.set(`style[data-plugin-css=${JSON.stringify(tag.dataset.pluginCss)}]`, tag) } },
  }
  for (const source of [a, b, a]) new Function('document', source.replace('export {};', ''))(document)
  assert.equal(tags.size, 2)
})
