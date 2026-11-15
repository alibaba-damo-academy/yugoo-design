import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the owning JSX with a workspace boundary stub. The real browser
// walkthrough separately checks shared styles, geometry and the save/retry path.
const requirePanel = createRequire(new URL('../../panel/package.json', import.meta.url))
const React = requirePanel('react')
const { renderToStaticMarkup } = requirePanel('react-dom/server')
const { JSDOM } = requirePanel('jsdom')
const source = await readFile(process.env.COMPANION_PLACEMENT_SOURCE ?? new URL('../src/client.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let recovery, dock, beforeComposer
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'savedNotificationRecovery') recovery = node.initializer
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'beforeComposer') beforeComposer = node.initializer.expression
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'className' && p.initializer?.text === 'dsh-design-dock')) dock = node
  ts.forEachChild(node, visit)
}
visit(tree)
const sharedSource = await readFile(new URL('../../panel/src/panel-content-state.tsx', import.meta.url), 'utf8')
const sharedTree = ts.createSourceFile('state.tsx', sharedSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const sharedFunction = sharedTree.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'PanelContentState')
function evaluate(text, context) {
  const code = ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return vm.runInNewContext(code, { React, ...context })
}
const PanelContentState = evaluate(sharedFunction.getText(sharedTree).replace(/^export /, ''), {
  CircleAlert: 'svg', FileText: 'svg', Image: 'svg', LoaderCircle: 'svg', Shapes: 'svg',
})
function render(visible, overrides = {}) {
  const context = { trialPanelPage: false, savedContinuationError: '', savedContinuations: [{ retryable: true, status: 'not_submitted' }],
    PanelContentState, Button: 'button', locale: 'en_US', recoveringNotification: false, panelSaving: false, pollError: '',
    thread: 'test-thread', conversationVisible: visible, continuationBar: null, advisoryInbox: null,
    workspace: { clarity: { testValue: 'preserved' } }, designOnly: !visible, preferences: {}, runtime: {}, publishControls: () => {}, lastNotificationFailure: undefined,
    chrome: key => key, DesignWorkspace: props => React.createElement('div', { 'data-workspace': true },
      React.createElement('header', { 'data-project-ust': true }, props.clarity.testValue)), ...overrides }
  context.savedNotificationRecovery = recovery ? evaluate(recovery.getText(tree), context) : null
  return { dock: new JSDOM(renderToStaticMarkup(evaluate(dock.getText(tree), context))).window.document,
    composer: new JSDOM(renderToStaticMarkup(evaluate(beforeComposer.getText(tree), context))).window.document }
}

for (const visible of [true, false]) {
  for (const status of ['not_submitted', 'unknown', 'preparing']) {
    test(`${visible ? 'visible' : 'hidden'} conversation/${status}: internal delivery state creates no separate UI or heading gap`, () => {
      const r = render(visible, { savedContinuations: [{ retryable: status === 'not_submitted', status }] })
      assert.ok(r.dock.querySelector('.dsh-design-dock').firstElementChild.matches('[data-workspace]'))
      assert.equal(r.dock.querySelector('[data-project-ust]').textContent, 'preserved')
      assert.equal(r.dock.querySelector('.dsh-panel-content-state'), null)
      assert.equal(r.composer.querySelector('.dsh-panel-content-state'), null)
      assert.doesNotMatch(r.dock.body.textContent + r.composer.body.textContent, /notification only|Files are saved|文件已保存|仅恢复|仅重试/)
    })
  }
}
