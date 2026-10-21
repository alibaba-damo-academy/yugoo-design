import assert from 'node:assert/strict'

/** Radix uses normal browser globals not installed by JSDOM automatically. */
export function installSelectDom(window) {
  for (const key of ['HTMLInputElement', 'HTMLFormElement', 'HTMLSelectElement', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) globalThis[key] = window[key]
  globalThis.getComputedStyle = window.getComputedStyle
  window.HTMLElement.prototype.scrollIntoView = function() {}
  window.HTMLElement.prototype.hasPointerCapture = () => false
  window.HTMLElement.prototype.releasePointerCapture = function() {}
}

export async function selectKey(React, element, key) {
  await React.act(() => element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })))
  await React.act(() => new Promise(resolve => setTimeout(resolve, 0)))
}

export async function inspectSelectOption(React, trigger, value) {
  await selectKey(React, trigger, 'Enter')
  const option = [...document.querySelectorAll('[role="option"]')].find(element => element.dataset.value === value)
  const result = option ? { disabled: option.getAttribute('aria-disabled') === 'true', text: option.textContent } : undefined
  await selectKey(React, document.activeElement, 'Escape')
  return result
}

export async function chooseSelectValue(React, trigger, value) {
  await selectKey(React, trigger, 'Enter')
  const option = [...document.querySelectorAll('[role="option"]')].find(element => element.dataset.value === value)
  if (!option && value === '') {
    await selectKey(React, document.activeElement, 'Escape')
    return
  }
  assert.ok(option, `choice ${value} is available`)
  await selectKey(React, option, 'Enter')
  if (option.getAttribute('aria-disabled') === 'true') await selectKey(React, document.activeElement, 'Escape')
}
