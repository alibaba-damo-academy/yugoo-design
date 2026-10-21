import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PanelWorkspaceTreeRecord } from '../src/panel-workspace.tsx'
import { PanelLocaleContext } from '../src/panel-i18n.tsx'
globalThis.React = React

test('shared record tree localizes disclosure while preserving authored labels and selection semantics', () => {
  for (const [locale, expand, collapse] of [['en-US', 'Expand', 'Collapse'], ['zh-CN', '展开', '收起']]) {
    for (const expanded of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(PanelLocaleContext.Provider, { value: locale },
        React.createElement(PanelWorkspaceTreeRecord, { label: 'User content', ariaLabel: 'Original label', expanded,
          selected: true, onSelect: () => assert.fail('render cannot select'), onToggle: () => assert.fail('render cannot toggle') },
        React.createElement('span', null, 'Child content'))))
      assert.ok(html.includes(`aria-label="${expanded ? collapse : expand}${locale === 'en-US' ? ' ' : ''}Original label"`))
      assert.ok(html.includes('User content'))
      assert.ok(html.includes('aria-current="page"'))
      assert.ok(html.includes(`aria-expanded="${expanded}"`))
      assert.equal(html.includes('Child content'), expanded)
    }
  }
})
