import { Bell, ChartNoAxesCombined, Check, ChevronDown, CircleCheck, CircleDashed, CircleHelp, Database, Ellipsis, FileText, Grid2X2, LayoutDashboard, Link, List, ListChecks, Palette, Pencil, Plug, Plus, RefreshCw, Search, Shield, SlidersHorizontal, SquareCheck, WandSparkles, Workflow, X, type LucideIcon } from 'lucide-react'

/** Finite compatibility aliases for existing Kit data and ported UI consumers. */
export const ICON_GLYPHS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  'icon-line-operation-add': Plus,
  'icon-line-operation-ellipsis': Ellipsis,
  'icon-line-operation-edit': Pencil,
  'icon-line-operation-close': X,
  'icon-line-operation-refresh': RefreshCw,
  'icon-line-operation-unfold': ChevronDown,
  'icon-line-operation-select': Check,
  'icon-line-operation-relevance': Link,
  'icon-line-tool-config': SlidersHorizontal,
  'icon-line-tool-dataquery': Search,
  'icon-line-business-attributionanalysis': ChartNoAxesCombined,
  'icon-gaiweiduoxuan': SquareCheck,
  'icon-MagicWandLine': WandSparkles,
  'icon-tiaoseban': Palette,
  'icon-line-status-notfull': CircleDashed,
  'search': Search,
  'rules': ListChecks,
  'connection': Plug,
  'check-circle': CircleCheck,
  'document': FileText,
  'workflow': Workflow,
  'shield': Shield,
  'pencil': Pencil,
  'database': Database,
  'apps': Grid2X2,
  'notification': Bell,
  'question-circle': CircleHelp,
  'palette': Palette,
  'layout': LayoutDashboard,
  'list': List,
})

/** Unknown third-party values use a visible neutral glyph; never load code from data. */
export function resolveIconGlyph(type: string): LucideIcon {
  const key = Object.hasOwn(ICON_GLYPHS, type) ? type : type.startsWith('icon-') ? type.slice(5) : `icon-${type}`
  return Object.hasOwn(ICON_GLYPHS, key) ? ICON_GLYPHS[key]! : CircleHelp
}

