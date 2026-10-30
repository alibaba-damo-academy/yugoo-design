/** Test-only authored-selector coverage; no DOM setup or test-registration side effects.
 * This checks meaningful matching base declarations, not browser cascade, variable
 * resolution, layout or pixels. Call with a Studio-owned rendered DOM root.
 * Panel/reading slots retain their own owners; iframes are separate documents.
 */
import * as cssTree from 'css-tree'

const foreignContent = '.ygd-studio-live-pane-body, .ygd-studio-component-stage, .ygd-studio-markdown'
function authoredRules(css) {
  const rules = []
  cssTree.walk(cssTree.parse(css), { visit: 'Rule', enter(rule) {
    if (this.atrule?.name.endsWith('keyframes')) return
    if (rule.prelude?.type !== 'SelectorList') return
    for (const selector of rule.prelude.children) {
      let stateOnly = false, pseudo
      cssTree.walk(selector, node => {
        if (node.type === 'PseudoClassSelector' && /^(hover|active|focus(?:-visible|-within)?|disabled|enabled|checked)$/u.test(node.name)) stateOnly = true
        if (node.type === 'PseudoElementSelector') pseudo = node.name
      })
      if (stateOnly || pseudo && pseudo !== 'file-selector-button') continue
      const declarations = [...rule.block.children].filter(node => node.type === 'Declaration').map(node => node.property)
      rules.push({ selector: cssTree.generate(selector).replace(/::file-selector-button$/u, ''), pseudo, declarations })
    }
  } })
  return rules
}

function matchingProperties(element, rules, pseudo) {
  return new Set(rules.filter(rule => {
    if (rule.pseudo !== pseudo) return false
    try { return element.matches(rule.selector) }
    catch (error) { throw new Error(`Style selector cannot be checked: ${rule.selector}`, { cause: error }) }
  }).flatMap(rule => rule.declarations))
}

export function controlStyleGaps(root, css) {
  const rules = authoredRules(css)
  const gaps = []
  for (const element of root.querySelectorAll('button,input,select,textarea')) {
    if (element.closest(foreignContent) || element.closest('[hidden]') || element.matches('input[type=hidden]')) continue
    const pseudo = element.matches('input[type=file]') ? 'file-selector-button' : undefined
    const properties = matchingProperties(element, rules, pseudo)
    const typography = ['font', 'font-family', 'font-size'].some(property => properties.has(property))
    const appearance = [...properties].some(property => /^(background(?:-color)?|border(?:-.+)?|padding(?:-.+)?|appearance)$/u.test(property))
    if (!typography || !appearance) gaps.push(`${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}: ${element.getAttribute('aria-label') ?? element.textContent.trim()}`)
  }
  return gaps
}

/** Call on the affected Studio feedback region after rendering error/recovery
 * states. This only detects unstyled feedback, not content quality or placement.
 * Unlike control coverage, do not exclude the live-pane wrapper: it also owns
 * Studio's preview errors. Pass the Studio region, not a foreign Panel tree.
 */
export function feedbackStyleGaps(root, css) {
  const rules = authoredRules(css), gaps = []
  const elements = [...(root.matches?.('[role=alert],[role=status]') ? [root] : []), ...root.querySelectorAll('[role=alert],[role=status]')]
  for (const element of elements) {
    if (element.closest('[hidden], .ygd-studio-component-stage, .ygd-studio-markdown')) continue
    const label = element.getAttribute('aria-label') ?? element.textContent.trim()
    if (!label) continue
    const properties = matchingProperties(element, rules)
    const typography = ['font', 'font-family', 'font-size', 'line-height'].some(property => properties.has(property))
    const layout = [...properties].some(property => /^(padding|margin|gap|display|position)(?:-.+)?$/u.test(property))
    // A red inline style or an arbitrary class is not a shared feedback pattern.
    if (!typography || !layout) gaps.push(`${element.tagName.toLowerCase()}[role=${element.getAttribute('role')}]: ${label}`)
  }
  return gaps
}
