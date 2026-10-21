#!/usr/bin/env node
/** Read the target repository's real catalog, never a duplicated skill list. */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(process.argv[2] ?? process.cwd())
const catalogPath = resolve(repo, 'packages/core/src/panel-component-catalog.ts')
try {
  const { PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS } = await import(pathToFileURL(catalogPath).href)
  const generated = new Set(GENERATED_COMPONENT_KINDS)
  console.log(JSON.stringify({
    repository: repo,
    components: Object.entries(PANEL_COMPONENT_CATALOG).map(([name, entry]) => ({
      name, description: entry.description, sourceBound: entry.sourceBound === true,
      ownsWorkspace: entry.ownsWorkspace === true,
      generated: generated.has(name),
    })),
    bindingContract: 'packages/core/src/panel-dsl.ts',
    inspect: 'inspect-panel-component.mjs <repo> <component> [--type <local-type-name>]',
    rendererRegistry: 'packages/panel/src/interpreter.ts#PANEL_COMPONENT_RENDERERS',
  }, null, 2))
} catch (error) {
  console.error(`Cannot read component catalog at ${catalogPath}: ${error.message}`)
  process.exitCode = 1
}
