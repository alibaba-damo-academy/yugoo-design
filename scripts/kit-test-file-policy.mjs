/** Current Web App Kit architecture assertions, not a trust sandbox or safe executor.
 * These source-only development files do not belong in the package files list. */
import assert from 'node:assert/strict'

const testFiles = new Set([
  'test-reading-order.mjs', 'test-channel-spacing.mjs', 'test-layout-policy.mjs', 'test-page-file-contract.mjs',
  'smoke-page-design-script.mjs', 'smoke-flow-design-script.mjs', 'smoke-bpmn-routing.mjs',
  'smoke-design-style-script.mjs', 'smoke-prd-script.mjs', 'smoke-layout-production.mjs',
].map(name => `test/${name}`))
const toolFiles = new Set(['scripts/compare-reading-layout.mjs', 'scripts/preview-reading-layout.mjs'])

export function isKitRootDevelopmentFile(path) {
  return testFiles.has(path) || toolFiles.has(path)
}

export function assertKitTestScripts(scripts) {
  assert.ok(scripts && typeof scripts === 'object' && !Array.isArray(scripts), 'Kit scripts must declare source-only tests')
  assert.ok(Object.hasOwn(scripts, 'test'), 'Kit must retain a test command')
  const referenced = new Set()
  for (const [name, command] of Object.entries(scripts)) {
    assert.match(name, /^test(?::[a-z0-9][a-z0-9:-]*)?$/u, 'Kit scripts must not add build, install or runtime lifecycle commands')
    assert.equal(typeof command, 'string', 'Kit test command must be a string')
    for (const segment of command.split('&&')) {
      const tokens = segment.trim().split(/\s+/u)
      assert.equal(tokens[0], 'node', 'Kit tests may only invoke Node directly')
      const testRunner = tokens[1] === '--test'
      const files = tokens.slice(testRunner ? 2 : 1)
      assert.ok(files.length > 0 && (testRunner || files.length === 1), 'Kit tests require explicit files, without arbitrary Node or script arguments')
      for (const file of files) {
        assert.ok(testFiles.has(file), `Kit test command must name an approved engineering test: ${file}`)
        referenced.add(file)
      }
    }
  }
  return referenced
}
