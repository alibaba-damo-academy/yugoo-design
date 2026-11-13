import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as css from 'css-tree'
const source = ts.createSourceFile('client.tsx', readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let conversationNode, shell
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'CONVERSATION_CSS') conversationNode = node.initializer
  if (ts.isTemplateExpression(node) && node.head.text.includes('.companion-root{')) shell = node
  ts.forEachChild(node, visit)
}
visit(source)
let activity
const activitySource = ts.createSourceFile('ConversationActivity.tsx', readFileSync(new URL('../../studio-ui/src/ConversationActivity.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function activityVisit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(activitySource) === 'CONVERSATION_ACTIVITY_CSS') activity = node.initializer.text
  ts.forEachChild(node, activityVisit)
}
activityVisit(activitySource)
function render(node, values) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  assert.ok(ts.isTemplateExpression(node))
  return node.head.text + node.templateSpans.map(span => {
    const name = span.expression.getText(source)
    assert.ok(Object.hasOwn(values, name), `Unknown CSS interpolation: ${name}`)
    return values[name] + span.literal.text
  }).join('')
}
assert.ok(conversationNode && shell && activity)
const conversation = render(conversationNode, { CONVERSATION_ACTIVITY_CSS: activity })
const shellCss = render(shell, { CONVERSATION_CSS: conversation })
function resolved(value, dark) {
  const ast = css.clone(value)
  css.walk(ast, { visit: 'Function', leave(node, item, list) {
    if (node.name !== 'var') return
    const parts = node.children.toArray(), name = parts[0].name
    const comma = parts.findIndex(part => part.type === 'Operator' && part.value === ',')
    const fallback = comma < 0 ? undefined : parts.slice(comma + 1).map(part => css.generate(part)).join('')
    const replacement = name === '--ds-static-white' ? '#fff'
      : name === '--ds-bg-white' ? dark ? '#19191c' : '#fff'
        : fallback || (/radius|space|height|width/.test(name) ? '4px' : '#777')
    list.replace(item, resolved(css.parse(replacement, { context: 'value' }), dark).children)
  } })
  return ast
}
test('actual Companion conversation and shell CSS have valid declarations after theme substitution', () => {
  let checked = 0
  for (const [name, text] of [['conversation', conversation], ['shell', shellCss]]) {
    const tree = css.parse(text)
    css.walk(tree, { visit: 'Declaration', enter(node) {
      if (node.property.startsWith('--')) return
      for (const dark of [false, true]) {
        const value = resolved(node.value, dark)
        const match = css.lexer.matchProperty(node.property, value)
        assert.equal(match.error, null, `${name}/${node.property}: ${css.generate(value)}: ${match.error?.message}`)
        checked++
      }
    } })
  }
  assert.ok(checked > 200)
})
test('brand actions retain static white foreground in both synthetic themes', () => {
  const { JSDOM } = createRequire(new URL('../../panel/package.json', import.meta.url))('jsdom')
  for (const dark of [false, true]) {
    const tree = css.parse(shellCss)
    css.walk(tree, { visit: 'Declaration', enter(node) { node.value = resolved(node.value, dark) } })
    const dom = new JSDOM('<!doctype html><style></style><div class="companion-root"><div class="companion-conversation"><button type="submit">Send</button><details class="companion-send-menu"><summary>More</summary></details></div></div>')
    dom.window.document.querySelector('style').textContent = css.generate(tree)
    for (const element of dom.window.document.querySelectorAll('button,summary')) {
      assert.equal(dom.window.getComputedStyle(element).color, 'rgb(255, 255, 255)')
    }
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.companion-root')).backgroundColor,
      dark ? 'rgb(25, 25, 28)' : 'rgb(255, 255, 255)')
    dom.window.close()
  }
})
