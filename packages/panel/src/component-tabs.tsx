import { createElement, useEffect, useId, useState, type ReactElement, type KeyboardEvent } from 'react'
import type { ComponentNode } from './dsl.ts'

/** Navigation only: children remain mounted and never acquire write authority. */
export function ComponentTabs({ node, render }: {
  node: ComponentNode
  render: (child: ComponentNode) => ReactElement
}): ReactElement {
  const children = node.children ?? []
  const ids = children.map(child => child.id)
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('tabs children require unique, non-empty IDs')
  }
  const base = useId()
  const [selected, setSelected] = useState<string | undefined>(() => ids[0])
  const active = selected !== undefined && ids.includes(selected) ? selected : ids[0]
  // Commit the fallback so a removed/re-added ID cannot regain selection.
  useEffect(() => { if (selected !== active) setSelected(active) }, [selected, active])
  return createElement('div', { className: 'dsh-component-tabs' },
    createElement('div', { className: 'dsh-component-tabs-list', role: 'tablist',
      'aria-label': node.title ?? node.id, 'aria-orientation': 'horizontal' },
    children.map((child, index) => createElement('button', {
      key: child.id, type: 'button', role: 'tab', id: `${base}-tab-${index}`,
      'aria-controls': `${base}-panel-${index}`, 'aria-selected': active === child.id,
      tabIndex: active === child.id ? 0 : -1,
      onClick: () => setSelected(child.id), onFocus: () => setSelected(child.id),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        let next: number
        switch (event.key) {
          case 'ArrowRight': next = (index + 1) % children.length; break
          case 'ArrowLeft': next = (index + children.length - 1) % children.length; break
          case 'Home': next = 0; break
          case 'End': next = children.length - 1; break
          default: return
        }
        event.preventDefault()
        const target = event.currentTarget.parentElement?.children.item(next)
        if (target instanceof event.currentTarget.ownerDocument.defaultView!.HTMLElement) target.focus()
      },
    }, child.title ?? child.id))),
    children.map((child, index) => createElement('div', {
      key: child.id, className: 'dsh-component-tabs-panel', role: 'tabpanel',
      id: `${base}-panel-${index}`, 'aria-labelledby': `${base}-tab-${index}`,
      hidden: active !== child.id, tabIndex: 0,
    }, render(child))))
}
