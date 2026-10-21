function normalizeAnchorId(value: string | number) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export function getFunctionPanelAnchorId(panelId: string, panelIndex: number) {
  return `function-panel-${normalizeAnchorId(panelId || panelIndex)}`;
}

export function getFunctionEpicAnchorId(panelId: string, epicIndex: number) {
  return `function-epic-${normalizeAnchorId(panelId || 'panel')}-${epicIndex}`;
}

export function getFunctionItemAnchorId(functionId: string) {
  return `function-item-${normalizeAnchorId(functionId)}`;
}
