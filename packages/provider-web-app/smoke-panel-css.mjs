#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('./src/client/generated/design.tw.css', import.meta.url), 'utf8')
assert.ok(css.includes(':where(.dsh-design-root button)'), 'scoped resets must not outrank utilities')
assert.ok(!/(^|[^)])\.dsh-design-root button\s*{/.test(css), 'bare scoped button resets are forbidden')
assert.match(
  css,
  /\.dsh-design-root h5[^}]*\.dsh-design-root h6[^}]*\{margin:0\}/,
  'nested panel headings must not inherit browser default margins',
)
assert.ok(css.includes('react-flow__node'), 'React Flow node styles must be bundled')
assert.ok(/\.react-flow__node\s*{[^}]*position:\s*absolute/.test(css))
assert.ok(css.includes('react-flow__controls-button'), 'React Flow controls must retain their base styles')

console.log('WEB APP PANEL CSS OK')
