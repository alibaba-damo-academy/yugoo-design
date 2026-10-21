#!/usr/bin/env node
/** Verify the shipped Web client contains the effectful browser splitter. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('./lib/client.js', import.meta.url), 'utf8')

assert.doesNotMatch(
  client,
  /react-resizable-panels\.edge-light\.js/,
  'the Web client must not bundle the effect-stripped server/worker entry',
)
assert.match(client, /react-resizable-panels\.browser\.js/)
assert.match(client, /registerPanel\(panelData\)/)
assert.match(client, /committedValuesRef\.current\.dragState = dragState/)
assert.match(client, /committedValuesRef\.current\.state = state/)

console.log('RESIZABLE BROWSER BUILD OK')
