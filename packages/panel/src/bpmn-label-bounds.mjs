/** Shared import adapter. Explicit BPMN DI is the user's saved text frame. */
export function createBpmnLabelBoundsModule() {
  // Keep this factory self-contained: the PRD browser uses these same bytes.
  function PreserveExplicitLabelBounds(eventBus, textRenderer) {
    let importing = false
    eventBus.on('import.render.start', () => { importing = true })
    eventBus.on('import.render.complete', () => { importing = false })
    eventBus.on('shape.add', 1500, ({ element }) => {
      if (!importing || element.type !== 'label') return
      const bounds = element.di?.label?.bounds
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        || bounds.width <= 0 || bounds.height <= 0) return
      // Importer otherwise tight-fits each time. Saving that temporary box
      // repeatedly narrows the next import and can split an unchanged word.
      const text = element.businessObject?.name
      const measured = typeof text === 'string' && text
        ? textRenderer.getDimensions(text, { box: bounds, style: textRenderer.getExternalStyle() }).height : 0
      Object.assign(element, { x: bounds.x, y: bounds.y, width: bounds.width,
        height: Math.max(bounds.height, Math.ceil(measured)) })
    })
  }
  PreserveExplicitLabelBounds.$inject = ['eventBus', 'textRenderer']
  return {
    __init__: ['preserveExplicitLabelBounds'],
    preserveExplicitLabelBounds: ['type', PreserveExplicitLabelBounds],
  }
}
