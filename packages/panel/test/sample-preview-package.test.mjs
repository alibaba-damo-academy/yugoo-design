/** Checks a normal built entry and its existing packaged CSS carrier. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { registerPackagedCssAssets } from '../../../scripts/css-asset-host.mjs'
import { loadPackagedCssAssets } from '../../../scripts/css-asset-manifest.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const prefix = '/design-system-assets/dsh-design-panel-sample-preview/'

test('public browser sample entry and declarations import without native Host or Studio dependencies', () => {
  const entry = manifest.exports['./sample-preview']
  assert.ok(existsSync(join(root, entry.types)))
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    import assert from 'node:assert/strict';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith('@deepseek-ai/') || specifier.startsWith('dsh-design-studio')
        || /^node:(fs|child_process|worker_threads)(?:\\/|$)/.test(specifier)) {
        throw Error('Native or Studio capability import: ' + specifier);
      }
      return next(specifier, context);
    } });
    const api = await import(${JSON.stringify(pathToFileURL(join(root, entry.default)).href)});
    assert.deepEqual(Object.keys(api), ['PanelSamplePreview']);
    assert.equal(typeof api.PanelSamplePreview, 'function');
  `], { encoding: 'utf8', timeout: 15000 })
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr)
})

test('standalone sample assets use the existing verified manifest and owned route lifecycle', () => {
  const lib = join(root, 'lib'), table = loadPackagedCssAssets(lib, prefix)
  assert.equal(table.manifest.prefix, prefix)
  const routes = [], disposed = []
  const dispose = registerPackagedCssAssets({ register(route) {
    routes.push(route); return () => disposed.push(route.path)
  } }, lib, [prefix])
  assert.deepEqual(routes.map(value => value.path), [prefix.slice(0, -1)])
  const request = name => {
    const response = { statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value }, end(value) { this.body = value } }
    routes[0].handler({ method: 'GET', url: prefix + name }, response)
    return response
  }
  for (const asset of table.assets) {
    const response = request(asset.name)
    assert.equal(response.statusCode, 200); assert.deepEqual(response.body, asset.bytes)
  }
  // The current shared base has inline data URLs only: an empty asset table is
  // valid and never grants a generic path into the package or caller workspace.
  for (const path of ['../host.js', '%2e%2e/host.js', 'unlisted.woff2']) assert.equal(request(path).statusCode, 404)
  dispose(); dispose(); assert.deepEqual(disposed, [prefix.slice(0, -1)])
})
