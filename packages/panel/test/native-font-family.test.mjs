import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('generic declarative panels retain native font precedence and standalone fallback without changing text metrics', async () => {
  const css = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  const declaration = css.match(/\.dsh-design-panel\s*\{([^}]+)\}/)?.[1]
  assert.ok(declaration, 'check the actual shared panel root rule')
  assert.match(declaration, /font:\s*14px\/1\.6\s+var\(--font-main,\s*var\(--ds-font-main,\s*system-ui,\s*sans-serif\)\)/)
  assert.doesNotMatch(declaration, /font-family:\s*system-ui|!important/)
  const tokens = await readFile(new URL('../src/client/ported/token.css', import.meta.url), 'utf8')
  const native = tokens.match(/--ds-font-main:\s*([^;]+);/)?.[1]
  assert.ok(native?.includes("'Microsoft YaHei'"), 'use the existing Windows CJK fallback')
  assert.ok(native?.includes("'Noto Sans CJK SC'"), 'retain the existing Linux CJK fallback')
})

test('Companion document root uses the existing native token and preserves a fallback outside scoped font-main', async () => {
  const source = await readFile(new URL('../../companion/src/client.tsx', import.meta.url), 'utf8')
  const declaration = source.match(/html,body,#root\s*\{([^}]+)\}/)?.[1]
  assert.ok(declaration)
  assert.match(declaration, /font-family:\s*var\(--ds-font-main,\s*system-ui,\s*sans-serif\)/)
  assert.doesNotMatch(declaration, /--font-main|font-size|font-weight|@font-face/)
  assert.match(declaration, /height:100%;margin:0/)
})
