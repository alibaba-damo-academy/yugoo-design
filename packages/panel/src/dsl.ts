/** Browser-safe re-export of the core-owned declarative panel compiler. */
export {
  parsePanelManifest,
  localizePanelManifest,
  validatePanelManifest,
  PANEL_KINDS,
  COMPONENT_KINDS,
  WORKSPACE_COMPONENT_KINDS,
  PANEL_COMPONENT_CATALOG,
  describePanelComponents,
  CONTROL_KINDS,
  DATA_TABLE_TYPES, DATA_TABLE_LIMITS, dataTableIssues, dataTableCellIssue, dataTableId,
  type DataTableValue, type DataTableColumn, type DataTableType,
  ROW_COLUMN_CONTROLS,
  SIDEBAR_ICONS,
  type SidebarIcon,
  type PanelKind,
  type ComponentKind,
  type ControlKind,
  type RowColumnControl,
  type PanelSectionRef,
  type RecordHierarchy,
  type FieldOption,
  type RowColumn,
  type PanelSection,
  type FormField,
  type FormRow,
  type FormGroup,
  type FormTabs,
  type EditorField,
  type ComponentNode,
  type PanelManifest,
} from 'dsh-design-core/dsl'

import { WORKSPACE_COMPONENT_KINDS, type PanelManifest } from 'dsh-design-core/dsl'

const WORKSPACE_COMPONENTS = new Set(WORKSPACE_COMPONENT_KINDS)

/** True when the manifest root owns its full two-dimensional panel surface. */
export function declarativePanelOwnsWorkspace(manifest: PanelManifest): boolean {
  const ownsWorkspace = (node: PanelManifest['ui']): boolean => {
    if (WORKSPACE_COMPONENTS.has(node.component)) return true
    // A view switch between complete workspaces still owns the panel surface.
    // Ordinary or mixed document tabs must retain the body's natural scrolling.
    if (node.component === 'tabs') return Boolean(node.children?.length)
      && node.children!.every(child => ownsWorkspace(child as PanelManifest['ui']))
    return node.component === 'stack' && node.children?.length === 1
      ? ownsWorkspace(node.children[0] as PanelManifest['ui'])
      : false
  }
  return ownsWorkspace(manifest.ui)
}
