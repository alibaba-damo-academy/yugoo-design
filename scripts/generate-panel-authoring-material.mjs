#!/usr/bin/env node
/** One build-time invocation owns its TypeScript loader and fresh module graph. */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

try {
  assert.equal(process.argv.length, 3, 'Usage: generate-panel-authoring-material.mjs <workspace>')
  const workspace = resolve(process.argv[2])
  const { exportPanelAuthoringReference } = await import(pathToFileURL(join(workspace,
    '.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs')).href)
  const { queryPanelAuthoringReference } = await import(pathToFileURL(join(workspace,
    'packages/core/src/panel-authoring-reference.ts')).href)
  const material = await exportPanelAuthoringReference(workspace)
  for (const name of Object.keys(material.components)) {
    for (const reference of ['contract', 'docs', 'examples']) queryPanelAuthoringReference(material, name, reference)
  }
  const bytes = Buffer.from(JSON.stringify(material, null, 2) + '\n')
  assert.ok(bytes.length <= 4_000_000, 'Packaged authoring reference exceeds its bounded size')
  // Check the representation that ships, not just the in-memory source objects.
  const serialized = JSON.parse(bytes.toString('utf8'))
  for (const name of Object.keys(serialized.components)) {
    for (const reference of ['contract', 'docs', 'examples']) queryPanelAuthoringReference(serialized, name, reference)
  }
  process.stdout.write(bytes)
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
}
