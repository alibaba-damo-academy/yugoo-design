#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { compileSchema } from '../../core/lib/index.js'

const script = new URL('../bundles/page_design/scripts/page-design.mjs', import.meta.url)

function runFile(operation, context, content) {
  return spawnSync(process.execPath, [script.pathname, operation], {
    encoding: 'utf8',
    input: `${JSON.stringify(context)}\n${content}`,
  })
}

const state = {
  schema_version: 7,
  stage: 'mapped',
  pages: {
    home: {
      id: 'home',
      name: 'Home',
      purpose: 'Review the workspace',
      page_type: 'overview',
      audience: ['Operator'],
      key_content: ['Current work'],
      key_actions: ['Open details'],
      function_refs: [],
      evidence_refs: [],
      artifact_file: '',
      canvas_position: { x: 40, y: 40 },
    },
  },
  page_order: ['home'],
  entry_page_ids: ['home'],
  connections: {},
  connection_order: [],
  common_spec: {
    layout: 'Application shell',
    logo: { description: 'Product wordmark' },
    navigation: [{ id: 'home-nav', label: 'Home', target_page_id: 'home' }],
    shared_components: ['Primary button'],
    source: 'design_style',
  },
  style_theme: 'default',
  style_epoch: 1,
}

const invalid = runFile('validate-html-file', { page_id: 'home', state }, '<html><body>broken')
const validateSchema = compileSchema(parse(readFileSync(new URL('../bundles/page_design/schema.yaml', import.meta.url), 'utf8')))
assert.deepEqual(validateSchema(state), [])
const layoutState = structuredClone(state)
layoutState.pages.home.uses_shared_layout = false
assert.deepEqual(validateSchema(layoutState), [])
layoutState.pages.home.uses_shared_layout = 'false'
assert.ok(validateSchema(layoutState).some(message => message.includes('uses_shared_layout')))
assert.equal(invalid.status, 1)
const result = JSON.parse(invalid.stdout)
assert.equal(result.valid, false)
assert.ok(result.diagnostics.length > 0)

const receipt = runFile('validate-html-file', { page_id: 'home', state }, '<html><body>broken')
assert.equal(receipt.status, 1)
assert.equal(JSON.parse(receipt.stdout).valid, false)

const standaloneHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Workspace</title>
    <style>
      body { margin: var(--ds-space-2); background: var(--ds-background); color: var(--ds-text); font-family: var(--ds-body-font); font-size: var(--ds-base-font-size); line-height: var(--ds-line-height); }
      .shell { display: grid; grid-template-columns: 12rem 1fr; gap: var(--ds-density-gap); }
      .content { display: flex; flex-direction: column; padding: var(--ds-density-padding); border: 1px solid var(--ds-border); border-radius: var(--ds-radius); box-shadow: var(--ds-shadow); }
      button { background: var(--ds-primary); color: var(--ds-surface); }
      button:hover, button:focus { opacity: 0.8; }
    </style>
  </head>
  <body><main class="shell"><nav>Product wordmark · <a data-nav-id="home-nav" data-prototype-page="home"><span data-nav-label="home-nav">Home</span></a></nav><section class="content"><h1>Workspace</h1><p>Review current work and open its details from this complete standalone prototype.</p><button type="button">Open details</button></section></main></body>
</html>`
const validReceipt = runFile('validate-html-file', { page_id: 'home', state }, standaloneHtml)
assert.equal(validReceipt.status, 0, validReceipt.stdout || validReceipt.stderr)
assert.equal(JSON.parse(validReceipt.stdout).valid, true)

const fileReceipt = runFile('validate-html-file', { page_id: 'home', state }, standaloneHtml)
assert.equal(fileReceipt.status, 0, fileReceipt.stdout || fileReceipt.stderr)
assert.equal(JSON.parse(fileReceipt.stdout).valid, true)
const legacyHtml = standaloneHtml.replace(' data-nav-id="home-nav"', '')
const legacyReceipt = runFile('validate-html-file', { page_id: 'home', state }, legacyHtml)
assert.equal(legacyReceipt.status, 0, legacyReceipt.stdout || legacyReceipt.stderr)

const iconState = structuredClone(state)
iconState.common_spec.navigation[0].icon_ref = 'navigation_home'
iconState.common_spec.navigation[0].group = 'Workspace'
iconState.common_spec.visual_pattern_refs = ['primary_navigation']
iconState.common_spec.logo.name = 'Product wordmark'
iconState.common_spec.logo.mark_ref = 'primary'
const iconHtml = standaloneHtml.replace('data-nav-id="home-nav"', 'data-nav-id="home-nav" data-nav-group="Workspace"').replace('Product wordmark', '<span data-design-brand="primary"><svg aria-label="Product"><path d="M4 4h16v16H4z"></path></svg></span><span data-design-wordmark="primary">Product wordmark</span>').replace(
  '><span data-nav-label="home-nav">Home</span></a>',
  '><span data-design-icon="navigation_home"><svg aria-label="Home" viewBox="0 0 24 24"><path d="M3 11 12 3l9 8v10H3z"></path></svg></span><span data-nav-label="home-nav">Home</span></a>',
)
const styleAuthority = {
  brand: { mark_id: 'primary', mark_svg: '<svg aria-label="Product"><path d="M4 4h16v16H4z"></path></svg>' },
  iconography: { library: 'test', style: 'outline' },
  icons: { navigation_home: { label: 'Home', svg: '<svg aria-label="Home" viewBox="0 0 24 24"><path d="M3 11 12 3l9 8v10H3z"></path></svg>' } },
}
// Format / reference / binding validity is not a visual quality score.
const authority = Object.fromEntries([...standaloneHtml.matchAll(/var\((--ds-[\w-]+)/g)].map(m => [m[1], 'test']));
const context = { page_id: 'home', state: iconState, style_authority: styleAuthority, authoritative_tokens: authority };
function check(html, expected, ctx = context, message) {
 const result = runFile('validate-html-file', ctx, html);
 assert.equal(result.status, expected, result.stdout || result.stderr);
 if (message) assert.match(result.stdout, message);
 return JSON.parse(result.stdout);
}
check(iconHtml, 0);
// All removed heuristics stay removed, including with full Style/map context.
const simple = '<html><body>Ready</body></html>';
check(simple, 0); // Under 500 chars; no layout/token/landmark quota.
check('<html><head><style>body{color:var(--ds-text)}</style></head><body>Ready</body></html>', 0);
check('<html><head><style>body{display:block;color:black;padding:12px;font-size:20px;line-height:1.4;border-radius:0}</style></head><body>Ready</body></html>', 0);
check('<html><body>Version v2.0 — changelog v1.0 🔎</body></html>', 0, { ...context, state: { ...iconState, pages: { home: { ...iconState.pages.home, purpose: 'Review version v1.0' } } } });
check(iconHtml.replace('d="M3 11 12 3l9 8v10H3z"', 'd="M0 0"'), 0); // Agent reviews actual glyph, not string comparison.
check(iconHtml.replace('>Product wordmark</span>', '>Other wordmark</span>'), 0); // Passing is not a brand-quality verdict.
check(iconHtml.replace('data-nav-label="home-nav"', 'data-nav-label="Home"'), 0);
check(iconHtml.replace(/<nav>[\s\S]*?<\/nav>/u, ''), 0);
for (const uses_shared_layout of [true, false]) check(simple, 0, { ...context, state: { ...iconState, pages: { home: { ...iconState.pages.home, uses_shared_layout } } } });
// Deterministic failures still block; no missing-reference or broken-hotspot regression.
check('<html><body><div>Broken</body></html>', 1, context, /structure error/);
check('<html><body>truncated', 1, context, /canonical HTML document/);
check('MODEL OUTPUT: '+simple, 1, context, /canonical HTML document/);
check(simple, 1, { ...context, page_id: 'missing' }, /absent/);
check(iconHtml.replace('data-prototype-page="home"', 'data-prototype-page="missing"'), 1, context, /unknown target page/);
check(iconHtml.replace('data-design-icon="navigation_home"', 'data-design-icon="missing"'), 1, context, /absent from style_authority/);
check(iconHtml.replace('data-design-brand="primary"', 'data-design-brand="missing"'), 1, context, /Unknown brand reference/);
check('<html><body><img src="https://example.com/image.png"></body></html>', 1, context, /remote asset/);
for (const css of ['body{color:var(--ds-missing)}', ':root{--ds-text:red}', 'body{--ds-local:blue}']) {
 check('<html><head><style>'+css+'</style></head><body>Ready</body></html>', 1);
}
check('<html><body style="color:var(--ds-missing)">Ready</body></html>', 1, context, /missing from the published set/);
check('<html><head><style id="ds-runtime-vars">:root{--ds-text:red}</style></head><body>Ready</body></html>', 1, context, /declares its own/);
const connected = structuredClone(iconState);
connected.pages.detail = { ...connected.pages.home, id: 'detail' };
connected.page_order.push('detail');
connected.connections = { open: { id: 'open', source_page_id: 'home', target_page_id: 'detail', label: 'Open' } };
connected.connection_order = ['open'];
const connectedContext = { ...context, state: connected };
const button = '<button data-prototype-id="open-button" data-prototype-connection="open" data-prototype-label="Open">Open</button>';
const bound = '<html><body>'+button+'</body></html>';
const boundResult = check(bound, 0, connectedContext);
assert.deepEqual(boundResult.bindings, { open: { elementId: 'open-button', label: 'Open' } });
check(simple, 1, connectedContext, /does not bind outgoing/);
check(bound.replace('connection="open"', 'connection="missing"'), 1, connectedContext, /unknown connections/);
check(bound.replace('<button ', '<button data-prototype-page="home" '), 1, connectedContext, /target conflicts with connection/);
check(bound, 1, { ...connectedContext, page_id: 'detail' }, /incoming connections/);
check(bound.replace('data-prototype-id="open-button"', ''), 1, connectedContext, /without data-prototype-id/);
check(bound.replace('</body>', button+'</body>'), 1, connectedContext, /duplicate data-prototype-id/);
check(bound.replace('</body>', button.replace('open-button', 'second')+'</body>'), 1, connectedContext, /more than once/);
// Map reference preflight remains, independent of menu count or page layout.
const mapContext = { style_authority: styleAuthority };
assert.equal(runFile('validate-map-file', mapContext, JSON.stringify(connected)).status, 0);
const contextual = structuredClone(connected);
contextual.connections.open.preview_context = { selection: 'garden' };
assert.deepEqual(validateSchema(contextual), []);
assert.equal(runFile('validate-map-file', mapContext, JSON.stringify(contextual)).status, 0);
check(bound, 0, { ...connectedContext, state: contextual });
for (const value of [null, [], { selection: 2 }, { selection: {} }, { constructor: 'bad' },
  JSON.parse('{"__proto__":"bad"}'), { selection: 'x'.repeat(257) },
  Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`key${i}`, 'x'])),
  Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`key${i}`, '中'.repeat(256)]))]) {
  const invalidContext = structuredClone(contextual);
  invalidContext.connections.open.preview_context = value;
  const rejected = runFile('validate-map-file', mapContext, JSON.stringify(invalidContext));
  assert.equal(rejected.status, 1, rejected.stdout);
  assert.match(rejected.stdout, /preview_context/);
  check(bound, 1, { ...connectedContext, state: invalidContext }, /preview_context/);
}
check(bound.replace('</body>', '<script type="application/json" id="dsh-design-preview-context">{}</script></body>'),
  1, connectedContext, /reserved Host context element/);
const badMap = structuredClone(connected);
badMap.common_spec.navigation[0].icon_ref = 'missing';
assert.match(runFile('validate-map-file', mapContext, JSON.stringify(badMap)).stdout, /icon_ref.*missing.*no SVG/);
badMap.common_spec.logo.mark_ref = 'missing';
assert.match(runFile('validate-map-file', mapContext, JSON.stringify(badMap)).stdout, /logo mark_ref.*missing/);
const noMenu = structuredClone(connected);
noMenu.common_spec.navigation = [];
assert.equal(runFile('validate-map-file', mapContext, JSON.stringify(noMenu)).status, 0);
const malformed = runFile('validate-html-file', { state: [] }, simple);
assert.equal(malformed.status, 2);
console.log('PAGE DESIGN AGENT SCRIPT OK');
