/** Minimal declarations for shared renderer contracts, independent of any Kit. */
export const graphManifest = {
  version: 1, panel_kind: 'document',
  sections: [
    { id: 'objects', title: 'Items' },
    { id: 'relations', title: 'Links', add_mode: 'graph' },
    { id: 'properties', title: 'Notes', navigation: 'contextual' },
    { id: 'structures', title: 'Groups', navigation: 'contextual' },
  ],
  fields: [
    { key: 'title', control: 'text', label: 'Title', applies_to: ['objects', 'relations', 'properties', 'structures'] },
    { key: 'kind', control: 'select', options: [{ value: 'item', label: 'Item' }], applies_to: ['objects'] },
    { key: 'specializes', control: 'record_select', options_from_section: 'objects', applies_to: ['objects'],
      hierarchy: { label_field: 'title', group_label: 'Specific items', inherit_fields: ['kind'] } },
    { key: 'participants', control: 'record_map', order_field: 'participant_order', applies_to: ['relations'], item_fields: [
      { key: 'object_ref', control: 'record_select', options_from_section: 'objects' },
      { key: 'role', control: 'text' },
    ] },
    { key: 'state', control: 'text', applies_to: ['relations'] },
    { key: 'object_ref', control: 'record_select', options_from_section: 'objects', applies_to: ['properties'] },
    { key: 'object_refs', control: 'record_multi_select', options_from_section: 'objects', applies_to: ['structures'] },
  ],
  ui: { component: 'record_workspace', id: 'graph-workspace', title: 'Items', sidebar_icon: 'network',
    sources: ['objects', 'relations', 'properties', 'structures'], children: [
      { component: 'relation_graph', id: 'graph', graph: { nodes: 'objects', edges: 'relations', label_field: 'title',
        node_kind_field: 'kind', edge_state_field: 'state', edge_pending_values: ['draft'],
        participants: { field: 'participants', reference_field: 'object_ref', role_field: 'role', order_field: 'participant_order' },
        related: [{ source: 'properties', reference_field: 'object_ref', label_field: 'title' }],
      } },
      { component: 'record_inspector', id: 'inspector' },
    ] },
}

export const matrixManifest = {
  version: 1, panel_kind: 'document', sections: [{ id: 'tables', title: 'Tables' }],
  fields: [{ key: 'title', control: 'text', applies_to: ['tables'] },
    { key: 'cells', control: 'rows', applies_to: ['tables'], columns: [
      { key: 'row', control: 'text', label: 'Row' }, { key: 'column', control: 'text', label: 'Column' },
      { key: 'value', control: 'text', label: 'Value' },
    ] }],
  ui: { component: 'record_workspace', id: 'matrix-workspace', sources: ['tables'], children: [
    { component: 'record_matrix', id: 'matrix', source: 'tables', matrix: { field: 'cells', row: 'row', column: 'column', value: 'value' } },
    { component: 'record_inspector', id: 'inspector' },
  ] },
}

export const artifactManifest = {
  version: 1, panel_kind: 'document', sections: [{ id: 'views', title: 'Views' }],
  fields: [{ key: 'title', control: 'text', applies_to: ['views'] },
    { key: 'file', control: 'artifact_ref', applies_to: ['views'] }],
  ui: { component: 'record_workspace', id: 'artifact-workspace', sources: ['views'], children: [
    { component: 'record_artifact', id: 'artifact', source: 'views', artifact: { field: 'file' } },
    { component: 'record_inspector', id: 'inspector' },
  ] },
}

export const recordSchema = { type: 'object', required: ['items'], properties: {
  items: { type: 'map', value: { type: 'object', properties: {
    title: { type: 'string' }, detail: { type: 'string' }, group: { type: 'string' },
  } } },
} }
export const recordState = { items: {
  first: { title: 'First record', detail: 'A readable record description.', group: 'Examples' },
  second: { title: 'Second record', detail: 'An independent sibling record.', group: 'Examples' },
} }
export const reportSchema = { type: 'object', properties: {
  report: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, status: { type: 'enum', values: ['draft', 'reviewed'] } } },
} }
export const reportState = { report: { title: 'Example report', summary: 'A small readable summary.', status: 'draft' } }
