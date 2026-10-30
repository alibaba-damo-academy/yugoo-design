/** Full compiled-page loader gate, separate from HTTP routing and bundler negatives. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { analyzeEmittedLoaders, proveKnownFlatBrowserLoaders } from '../../../scripts/emitted-loader-check.mjs'

const page = new URL('../lib/page-client.js', import.meta.url)
const code = await readFile(page, 'utf8')
const started = performance.now()
// Only exact, source-pinned forwarding/optional-Node guards receive a proof.
// All other module loads and loader aliases retain strict rejection. Actual
// image Worker string values are checked separately by page-workers.test.mjs.
const loaders = analyzeEmittedLoaders(code, proveKnownFlatBrowserLoaders(code, {
  fileName: page.pathname, includeLodash: true, includeEmbedded: true,
}))
assert.deepEqual(loaders.loads, [], 'the standalone browser has no import map or external module loader')
assert.deepEqual(loaders.unverified, [], 'the standalone page cannot defer a computed or unverified module load')
console.log(JSON.stringify({ result: 'DSH STUDIO PAGE LOADERS OK',
  pageSha256: createHash('sha256').update(code).digest('hex'),
  loads: loaders.loads.length, unverified: loaders.unverified.length,
  codeEvaluations: loaders.codeEvaluations, dynamicClosureVerified: loaders.dynamicClosureVerified,
  elapsedMs: performance.now() - started }))
