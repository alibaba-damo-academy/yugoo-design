import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

export const PACKAGED_KNOWLEDGE_IMPORT = '../knowledge/runtime.mjs'
export const PACKAGED_CLI_LIFECYCLE_IMPORT = '../knowledge/cli-lifecycle.mjs'
export const KNOWLEDGE_SOURCE_PATH = fileURLToPath(new URL('../packages/companion/src/knowledge.mjs', import.meta.url))
export const COMPANION_CLI_SOURCE_PATH = fileURLToPath(new URL('../packages/companion/src/plugin-cli.mjs', import.meta.url))
const developmentRuntime = `export function companionKnowledgeRuntimeUrl() {
  // Published runtime is a separate asset bundle; source mode uses the same library.
  const packaged = new URL('../knowledge/runtime.mjs', import.meta.url)
  return existsSync(packaged) ? packaged : new URL('../../knowledge-ladybug/lib/index.js', import.meta.url)
}

async function runtime() { return import(companionKnowledgeRuntimeUrl().href) }`

/** Published builds load only their sibling runtime. Source development is unchanged. */
export function companionPackagedKnowledge() {
  let transformed = false
  return {
    name: 'companion-packaged-knowledge',
    transform(code, id) {
      if (id !== KNOWLEDGE_SOURCE_PATH) return null
      assert.equal(code.split(developmentRuntime).length, 2, 'Knowledge runtime source changed; review packaged-loader transform')
      transformed = true
      return { code: code.replace(developmentRuntime, `export function companionKnowledgeRuntimeUrl() { return new URL('${PACKAGED_KNOWLEDGE_IMPORT}', import.meta.url) }\nasync function runtime() {\n  return import('${PACKAGED_KNOWLEDGE_IMPORT}')\n}`), map: null }
    },
    resolveId(source, importer) {
      if (importer === COMPANION_CLI_SOURCE_PATH && source === './cli-lifecycle.mjs') return { id: PACKAGED_CLI_LIFECYCLE_IMPORT, external: true }
      if (transformed && importer === KNOWLEDGE_SOURCE_PATH && source === PACKAGED_KNOWLEDGE_IMPORT) return { id: source, external: true }
      return null
    },
  }
}
