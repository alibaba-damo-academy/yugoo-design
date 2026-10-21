import { CLARITY_DOCK_CSS } from './clarity-dock.tsx'
import { ADVISORY_CSS, CONTINUATION_CSS, DOCK_CSS, TOGGLE_CSS } from './styles.ts'
import '../panel-content-state.css'

const PLUGIN_ID = 'dsh-design-panel'
const TAG_ID = 'dsh-design-panel/shell.css'

/*
 * Runs while the client factory is materialized. dsh HMR removes every style
 * tagged with this plugin id before materializing the next revision.
 */
if (typeof document !== 'undefined'
  && document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = `${DOCK_CSS}\n${TOGGLE_CSS}\n${CLARITY_DOCK_CSS}\n${ADVISORY_CSS}\n${CONTINUATION_CSS}`
  document.head.append(tag)
}
