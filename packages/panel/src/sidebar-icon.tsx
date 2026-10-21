import type { ReactElement } from 'react'
import type { SidebarIcon } from './dsl.ts'
import {
  PanelsTopLeft, Bot, Database, ListChecks, Palette, Workflow, Blocks, Plug, Bell,
  Map, ClipboardCheck, Search, Shield, MessageCircleQuestion, FileText, PenTool,
  Columns2, Network, ChartNoAxesCombined, UsersRound, BookOpen,
} from 'lucide-react'

/** Shared finite vocabulary, selected by content rather than Bundle identities. */
const icons = {
  'panels-top-left': PanelsTopLeft, bot: Bot, database: Database, 'list-checks': ListChecks,
  palette: Palette, workflow: Workflow, blocks: Blocks, plug: Plug, bell: Bell, map: Map,
  'clipboard-check': ClipboardCheck, search: Search, shield: Shield,
  'message-circle-question': MessageCircleQuestion, 'file-text': FileText, 'pen-tool': PenTool,
  'columns-2': Columns2, network: Network, 'chart-no-axes-combined': ChartNoAxesCombined, users: UsersRound, 'book-open': BookOpen,
} satisfies Record<SidebarIcon, typeof Bell>

export function sidebarIcon(name?: SidebarIcon): ReactElement | undefined {
  if (name === undefined) return undefined
  const Icon = Object.hasOwn(icons, name) ? icons[name] : undefined
  if (!Icon) throw new Error('Unknown sidebar icon')
  return <Icon size={16} aria-hidden="true" focusable="false" data-sidebar-icon={name} />
}
