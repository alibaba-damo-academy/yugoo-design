import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

// The same check can target an installed candidate without copying its library
// or supplying the renderer peers a native Host intentionally does not install.
const root = process.env.YUGOO_PANEL_PACKAGE_ROOT ?? fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entry = pathToFileURL(join(root, manifest.exports['.'].default)).href

test('Node plugin root imports and schedules its optional CSS carrier without renderer dependencies', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createRequire, registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const attempted = [];
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'react' || specifier.startsWith('react/')
        || specifier === 'react-dom' || specifier.startsWith('react-dom/')
        || specifier === 'lucide-react' || specifier.startsWith('@xyflow/')) {
        attempted.push(specifier);
        throw new Error('FORBIDDEN_RENDERER_IMPORT: ' + specifier);
      }
      return next(specifier, context);
    } });
    const panel = await import(${JSON.stringify(entry)});
    assert.equal(typeof panel.apply, 'function');
    assert.equal(panel.name, 'dsh-design-panel');
    assert.equal(typeof panel.parsePanelManifest, 'function');
    assert.equal(typeof panel.validatePanelManifest, 'function');
    const injections = [];
    panel.apply({ inject(names, callback) { injections.push({ names, callback }); } });
    assert.deepEqual(injections.map(row => row.names), [['webServer']]);
    assert.equal(typeof injections[0].callback, 'function');
    // Actual Cordis lifecycle, separate from the CSS scheduling recorder. A
    // native Loader/manifest check remains a distinct integration boundary.
    const require = createRequire(${JSON.stringify(pathToFileURL(join(root, 'package.json')).href)});
    const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
    const ctx = new Context();
    try {
      const plugin = ctx.plugin(panel);
      await plugin;
      assert.equal(plugin.state, 2);
    } finally { await ctx.fiber.dispose(); }
    assert.deepEqual(attempted, []);
    console.log('HOST_ENTRY_OK');
  `], { encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'HOST_ENTRY_OK')
})

test('Host discovery stays on the package root and UI entry is explicit', () => {
  assert.equal(manifest.main.replace(/^\.\//u, ''), manifest.exports['.'].default.replace(/^\.\//u, ''))
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.exports['./ui'].default, './lib/index.js')
  assert.notEqual(manifest.exports['.'].default, manifest.exports['./ui'].default)
})

test('explicit UI library keeps the component and interpreter API', async () => {
  const ui = await import(pathToFileURL(join(root, manifest.exports['./ui'].default)).href)
  for (const name of ['renderManifest', 'renderNode', 'StandardQuestionList', 'StandardQuestionWorkspace',
    'PanelWorkspace', 'QuestionAttachments', 'ClarityDockReadout', 'AdvisoryReviewCard',
    'DesignProjectSidebarEntry', 'DesignContinuationBar', 'readResidueEnvelope']) {
    assert.equal(typeof ui[name], 'function', name)
  }
  const host = await import(entry)
  for (const name of ['parsePanelManifest', 'validatePanelManifest', 'pathGet', 'pathSet',
    'applyDesignEditToDraft', 'clarityIndex', 'canNavigate', 'NativePanelRegistry',
    'prepareDeclarativePanelSave', 'automaticDesignDockWidth', 'currentDockSession']) {
    assert.equal(typeof host[name], 'function', name)
    assert.equal(host[name], ui[name], `${name} must retain one implementation`)
  }
})

test('moved Host entry retains packaged CSS route registration and disposal', async () => {
  const host = await import(entry)
  let mount
  host.apply({ inject(_names, callback) { mount = callback } })
  const routes = []
  const removed = []
  const effects = []
  mount({
    webServer: { register(route) {
      routes.push(route)
      return () => { removed.push(route.path) }
    } },
    effect(effect) { effects.push(effect()) },
  })
  assert.deepEqual(routes.map(route => route.path), [
    '/design-system-assets/dsh-design-panel-renderer',
    '/design-system-assets/dsh-design-panel-client',
  ])
  assert.ok(routes.every(route => route.kind === 'prefix' && typeof route.handler === 'function'))
  for (const dispose of effects.reverse()) dispose()
  assert.deepEqual(removed, routes.map(route => route.path).reverse())
})
