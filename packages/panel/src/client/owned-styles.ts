import { CLARITY_DOCK_CSS } from './clarity-dock.tsx'
import { ADVISORY_CSS, CONTINUATION_CSS, DOCK_CSS, TOGGLE_CSS } from './styles.ts'
import '../panel-content-state.css'
// Host-level shared controls can appear before the Design Dock is ever opened.
// Load their one foundation through the existing plugin CSS/HMR lifetime.
import '../visual-components.css'

const TAG_ID = 'dsh-design-panel/shell.css'

/*
 * Runs while the client factory is materialized. dsh HMR removes every style
 * tagged with this package id before materializing the next revision.
 */
if (typeof document !== 'undefined') {
  const tag = document.querySelector<HTMLStyleElement>(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`)
    ?? document.createElement('style')
  // Package ownership metadata is scoped by the existing distribution projection.
  tag.dataset.plugin = 'dsh-design-panel'
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = `${DOCK_CSS}\n${TOGGLE_CSS}\n${CLARITY_DOCK_CSS}\n${ADVISORY_CSS}\n${CONTINUATION_CSS}`
  if (!tag.isConnected) document.head.append(tag)
}
