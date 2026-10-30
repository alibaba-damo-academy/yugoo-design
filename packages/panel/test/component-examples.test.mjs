import test from 'node:test'
import assert from 'node:assert/strict'
import { createPanelComponentExample, panelComponentTitle, panelComponentCategory } from '../src/component-examples.ts'
import { COMPONENT_KINDS, PANEL_COMPONENT_CATALOG, parsePanelManifest } from '../../core/src/panel-dsl.ts'
import { renderToStaticMarkup } from 'react-dom/server'
const React = await import('react'); globalThis.React = React
const { renderManifest } = await import('../src/interpreter.ts')
const { documentArtifactPath } = await import('../src/document-workspace.tsx')
const { parseCanvasScene } = await import('../src/canvas-scene.ts')

const contains = (node, kind) => node.component === kind || (node.children ?? []).some(child => contains(child, kind))
  || Object.values(node.slots ?? {}).some(child => contains(child, kind))

test('real catalog drives the showcase; each supplied example is a valid declaration containing that component', () => {
  let previewed = 0
  for (const kind of COMPONENT_KINDS) {
    assert.ok(panelComponentTitle(kind, 'zh'))
    assert.ok(panelComponentTitle(kind, 'en'))
    assert.ok(['layout', 'data', 'workspace'].includes(panelComponentCategory(kind)))
    for (const locale of ['zh', 'en']) {
      const example = createPanelComponentExample(kind, locale)
      if (!example) continue
      const manifest = parsePanelManifest(example.panelYaml)
      assert.ok(contains(manifest.ui, kind), kind)
      assert.ok(example.sample && typeof example.sample === 'object')
      assert.ok(Object.keys(example.artifacts).every(path => !path.includes('..') && !path.startsWith('/')))
      if (locale === 'zh') previewed++
    }
  }
  assert.equal(previewed, COMPONENT_KINDS.length, 'every registered component needs a populated documentation example')
  assert.equal(PANEL_COMPONENT_CATALOG.execution_log.autoOrder, undefined)
  const log = createPanelComponentExample('execution_log', 'en')
  assert.match(log.panelYaml, /No Host connection or Agent execution/)
  assert.doesNotMatch(log.panelYaml, /runId|run_id|attemptId|projectId|transcript_path/, 'DSL example cannot grant native transcript authority')
  assert.equal(log.logEntries.length, 3, 'finite explicitly synthetic transcript, not a connected Host')
})

test('example values are owned per request; editing them cannot mutate another example or language', () => {
  const first = createPanelComponentExample('record_form', 'zh')
  first.sample.items.first.title = 'User test edit'
  const next = createPanelComponentExample('record_form', 'zh')
  assert.notEqual(next.sample.items.first.title, 'User test edit')
  assert.notEqual(next.sample.items.first.title, createPanelComponentExample('record_form', 'en').sample.items.first.title)
})

test('showcase sizing follows the example root without extending the DSL or changing runtime workspace behavior', () => {
  for (const [kind, layout] of [['schema_field', 'inline'], ['text_block', 'inline'], ['tabs', 'inline'], ['record_workspace', 'workspace'], ['question_workspace', 'workspace'], ['document_workspace', 'workspace'], ['mind_map', 'workspace'], ['canvas_workspace', 'workspace'], ['diagram_workspace', 'workspace'], ['preview_workspace', 'workspace'], ['artifact_workspace', 'workspace'], ['navigation_workspace', 'workspace']]) {
    const example = createPanelComponentExample(kind, 'en')
    assert.equal(example.previewLayout, layout, kind)
    assert.doesNotMatch(example.panelYaml, /previewLayout|preview_layout/, 'showcase dimensions never become a DSL property')
  }
})

test('all supplied examples render shared components with normal, empty and readonly values', () => {
  for (const kind of COMPONENT_KINDS) {
    const example = createPanelComponentExample(kind, 'en')
    if (!example) continue
    const manifest = parsePanelManifest(example.panelYaml)
    for (const mode of ['normal', 'empty', 'readonly']) {
      const html = renderToStaticMarkup(renderManifest(manifest, mode === 'empty' ? {} : example.sample, {
        locale: 'en-US', editable: mode !== 'readonly', onEdit: () => {}, onPanelUpdate: () => {},
      }))
      assert.match(html, /dsh-design-panel/, `${kind}:${mode}`)
      if (kind === 'math_document') assert.match(html, /is-record-form/, 'mathematical reading uses the shared detail shell rather than stacking workspace gutters')
    }
  }
})

test('schema-field editors reuse shared controls and expose their labels; readonly remains non-editable', () => {
  const example = createPanelComponentExample('schema_field', 'en')
  const manifest = parsePanelManifest(example.panelYaml)
  for (const control of ['text', 'number', 'select', 'textarea', 'list']) {
    manifest.ui.control = control
    const html = renderToStaticMarkup(renderManifest(manifest, example.sample, { editable: true, onPanelUpdate: () => {} }))
    if (control === 'select') assert.match(html, /role="combobox"[^>]*aria-label="Name"[^>]*class="dsh-panel-select-trigger dsh-design-field-input"/, control)
    else assert.match(html, /class="dsh-design-field-input" aria-label="Name"/, control)
  }
  const html = renderToStaticMarkup(renderManifest(manifest, example.sample, { editable: false, onPanelUpdate: () => assert.fail('readonly writes') }))
  assert.doesNotMatch(html, /<input|<textarea|<select/)
})

test('document example respects the real renderer owner boundary and serves only its confined fixture', () => {
  const example = createPanelComponentExample('document_workspace', 'en')
  const manifest = parsePanelManifest(example.panelYaml)
  const path = documentArtifactPath(example.sample.document, manifest.ui.document, 'component_example')
  assert.equal(path, 'component_example/document.html')
  assert.match(example.artifacts[path], /<h2>Goal<\/h2>/)
  assert.equal(documentArtifactPath(example.sample.document, manifest.ui.document, 'other_bundle'), undefined)
})

test('file-backed documentation examples have populated, bounded, self-contained fixture data', () => {
  for (const locale of ['zh', 'en']) {
    const canvas = createPanelComponentExample('canvas_workspace', locale)
    const scene = parseCanvasScene(canvas.artifacts[canvas.sample.items.first.file], { skill: 'component_example', assetsDirectory: 'images' })
    assert.equal(scene.elements.length, 2)
    assert.ok(scene.elements.some(element => element.type === 'text' && element.text.length > 0))
    assert.deepEqual(scene.files, {}, 'documentation does not read outside images or project assets')
    const diagram = createPanelComponentExample('diagram_workspace', locale)
    assert.match(diagram.artifacts[diagram.sample.items.first.file], /<bpmndi:BPMNDiagram/)
    assert.match(diagram.artifacts[diagram.sample.items.first.file], /<bpmn:task/)
    const preview = createPanelComponentExample('preview_workspace', locale)
    assert.match(preview.artifacts[preview.sample.preview.file], /<article>/)
    for (const example of [canvas, diagram, preview]) {
      for (const content of Object.values(example.artifacts)) {
        assert.ok(content.length < 20_000)
        assert.doesNotMatch(content, /<script|<iframe|https?:[^\s"']+\.(?:woff|png|jpg)/i, 'fixed examples do not execute or fetch remote assets')
      }
    }
    const log = createPanelComponentExample('execution_log', locale)
    assert.ok(log.logEntries.every(entry => entry.message.length > 0))
    assert.doesNotMatch(JSON.stringify(log.sample), /component-example-static-transcript/, 'runtime identity is never authored into design data')
  }
})
