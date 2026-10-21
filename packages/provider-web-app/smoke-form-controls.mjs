#!/usr/bin/env node
/** Shared checkbox and radio controls preserve visible, interactive states. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { register } = await import('tsx/esm/api')
register()

const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'https://panel.test/',
})
const { window } = dom
for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLFormElement', 'Element', 'Node',
  'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'MutationObserver', 'CustomEvent',
]) {
  if (globalThis[key] === undefined) globalThis[key] = window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { Checkbox } = await import('./src/client/ported/ui/checkbox.tsx')
const { RadioGroup, RadioGroupItem } = await import('./src/client/ported/ui/radio-group.tsx')
const { act } = React
const checkboxChanges = []
const radioChanges = []

function Harness() {
  const [checked, setChecked] = React.useState(false)
  const [radio, setRadio] = React.useState('guest')
  return React.createElement('div', { className: 'dsh-design-root' },
    React.createElement(Checkbox, {
      'aria-label': '访客',
      checked,
      onCheckedChange: (value) => {
        checkboxChanges.push(value)
        setChecked(value)
      },
    }),
    React.createElement(Checkbox, { 'aria-label': '不可用访客', disabled: true, checked: false }),
    React.createElement(RadioGroup, {
      value: radio,
      onValueChange: (value) => {
        radioChanges.push(value)
        setRadio(value)
      },
    },
    React.createElement(RadioGroupItem, { value: 'guest', 'aria-label': '访客角色' }),
    React.createElement(RadioGroupItem, { value: 'member', 'aria-label': '成员角色' }),
    React.createElement(RadioGroupItem, { value: 'disabled', 'aria-label': '不可用角色', disabled: true })),
  )
}

const container = window.document.getElementById('root')
const root = createRoot(container)
await act(async () => { root.render(React.createElement(Harness)) })

const checkbox = container.querySelector('[aria-label="访客"]')
const disabledCheckbox = container.querySelector('[aria-label="不可用访客"]')
assert.equal(checkbox?.getAttribute('data-state'), 'unchecked', 'the shared checkbox exposes its unchecked state')
assert.ok(checkbox?.classList.contains('dsh-design-checkbox'), 'role choices use the shared checkbox surface')
assert.equal(disabledCheckbox?.hasAttribute('disabled'), true, 'the shared checkbox exposes its disabled state')
await act(async () => { checkbox.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
assert.deepEqual(checkboxChanges, [true], 'the unchecked checkbox can be selected')
assert.equal(checkbox.getAttribute('data-state'), 'checked', 'the checkbox renders its selected state')
await act(async () => { disabledCheckbox.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
assert.deepEqual(checkboxChanges, [true], 'disabled checkboxes cannot change selection')

const radios = [...container.querySelectorAll('[role="radio"]')]
assert.equal(radios[0].getAttribute('data-state'), 'checked', 'the selected radio exposes its state')
assert.equal(radios[1].getAttribute('data-state'), 'unchecked', 'the unselected radio exposes its state')
await act(async () => { radios[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
assert.deepEqual(radioChanges, ['member'], 'the unselected radio can be selected')
assert.equal(radios[1].getAttribute('data-state'), 'checked', 'the radio renders its selected state')
await act(async () => { radios[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
assert.deepEqual(radioChanges, ['member'], 'disabled radios cannot change selection')

const css = await readFile(new URL('./src/client/generated/design.tw.css', import.meta.url), 'utf8')
assert.match(css, /\.dsh-design-checkbox[^}]*\.dsh-design-radio:not\(\.sr-only\)\{[^}]*border:var\(--ds-border-width-2\) solid var\(--ds-line-4\)/, 'unchecked controls use the stronger DS line token')
assert.match(css, /data-state=unchecked[^}]*hover\{[^}]*var\(--ds-line-6\)[^}]*var\(--ds-fill-1\)/, 'hovered controls have a distinct DS token state')
assert.match(css, /data-state=checked[^}]*\{[^}]*var\(--ds-brand-bg-default\)/, 'selected controls use the brand DS token')
assert.match(css, /\.dsh-design-checkbox:disabled[^}]*\{[^}]*var\(--ds-line-2\)[^}]*var\(--ds-fill-2\)[^}]*opacity:1/, 'disabled controls remain visible without blanket opacity')

const roleAccessSource = await readFile(new URL('./src/client/panels/role-access.tsx', import.meta.url), 'utf8')
assert.match(roleAccessSource, /操作前需要（可选）[\s\S]*<Checkbox/, 'role access requirements use the shared checkbox')

await act(async () => { root.unmount() })
console.log('SHARED FORM CONTROL STATES OK')
