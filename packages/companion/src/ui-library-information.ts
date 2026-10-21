/** Same-build display metadata. Never a registration, upgrade or DSL authority. */
import react from '../../panel/node_modules/react/package.json' with { type: 'json' }
import reactDom from '../../panel/node_modules/react-dom/package.json' with { type: 'json' }
import icons from '../../provider-web-app/node_modules/lucide-react/package.json' with { type: 'json' }
import resizable from '../../provider-web-app/node_modules/react-resizable-panels/package.json' with { type: 'json' }
import markdown from '../../provider-web-app/node_modules/react-markdown/package.json' with { type: 'json' }
import dialog from '../../provider-web-app/node_modules/@radix-ui/react-dialog/package.json' with { type: 'json' }
import select from '../../provider-web-app/node_modules/@radix-ui/react-select/package.json' with { type: 'json' }
import tabs from '../../provider-web-app/node_modules/@radix-ui/react-tabs/package.json' with { type: 'json' }
import tooltip from '../../provider-web-app/node_modules/@radix-ui/react-tooltip/package.json' with { type: 'json' }
import flow from '../../provider-web-app/node_modules/@xyflow/react/package.json' with { type: 'json' }
import canvas from '../../provider-web-app/node_modules/@excalidraw/excalidraw/package.json' with { type: 'json' }
import bpmn from '../../provider-web-app/node_modules/bpmn-js/package.json' with { type: 'json' }
import charts from '../../provider-web-app/node_modules/recharts/package.json' with { type: 'json' }
import type { StudioUiLibrary } from '../../studio-ui/src/ComponentLibrary.tsx'

const info = (metadata: { name: string; version: string }, title: string, group: StudioUiLibrary['group'], zh: string, en: string): StudioUiLibrary => ({
  packageName: metadata.name, version: metadata.version, title, group, purpose: { zh, en },
})
export const studioUiLibraries: readonly StudioUiLibrary[] = [
  info(react, 'React', 'foundation', '共享界面的组件与状态基础。', 'Component and state foundation for the shared UI.'),
  info(reactDom, 'React DOM', 'foundation', '将共享 React 界面渲染到浏览器。', 'Renders the shared React UI in the browser.'),
  info(icons, 'Lucide', 'foundation', '侧栏、操作和状态使用的语义化线性图标。', 'Semantic line icons for navigation, actions and status.'),
  info(resizable, 'Resizable Panels', 'controls', '可拖拽调整宽度的侧栏与内容分栏。', 'Resizable navigation and content panes.'),
  info(markdown, 'React Markdown', 'controls', '设计说明、文档和产物的 Markdown 阅读界面。', 'Markdown reading surfaces for design notes, documents and artifacts.'),
  info(dialog, 'Radix Dialog', 'controls', '对话框的焦点管理、键盘和可访问性交互。', 'Dialog focus management, keyboard interaction and accessibility.'),
  info(select, 'Radix Select', 'controls', '具有键盘与可访问性支持的选择控件。', 'Selection controls with keyboard and accessibility support.'),
  info(tabs, 'Radix Tabs', 'controls', '现有原生界面使用的页签交互基础；不是所有自定义页签都由它实现。', 'Tab primitives used by existing native UI; not every custom tab is implemented with this library.'),
  info(tooltip, 'Radix Tooltip', 'controls', '图标及辅助操作的提示交互。', 'Contextual help for icons and secondary actions.'),
  info(flow, 'React Flow', 'visualization', '关系、页面导航和 Agent 资源等节点连线画布。', 'Node-and-edge canvases for relationships, page navigation and Agent resources.'),
  info(canvas, 'Excalidraw', 'visualization', '白板、自由绘制和批注。', 'Whiteboards, freeform drawing and annotations.'),
  info(bpmn, 'bpmn-js', 'visualization', '专业 BPMN 流程图的渲染与编辑。', 'Rendering and editing of professional BPMN diagrams.'),
  info(charts, 'Recharts', 'visualization', '已有原生功能说明里的统计图形。', 'Charts in existing native feature descriptions.'),
]
