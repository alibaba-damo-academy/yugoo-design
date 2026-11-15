/** Non-blocking diagnostics for a structurally validated native scene.
 * No font measurement, layout mutation, visual acceptance or runtime policy.
 */
export function inspectTextGeometry(scene) {
  const warnings = []
  const elements = new Map(scene.elements.filter(element => !element.isDeleted)
    .map(element => [element.id, element]))
  const tolerance = 1
  for (const text of elements.values()) {
    if (text.type !== 'text' || !text.text.length) continue
    if (Number.isFinite(text.fontSize) && text.fontSize > 0
      && Number.isFinite(text.lineHeight) && text.lineHeight > 0) {
      const minimumHeight = text.text.split(/\r\n|\r|\n/u).length * text.fontSize * text.lineHeight
      if (text.height + tolerance < minimumHeight) warnings.push({
        code: 'text_line_height', elementId: text.id,
        message: 'Declared text height is below the explicit line-height minimum; reflow or resize and inspect rendering.',
        actualHeight: text.height, minimumHeight,
      })
    }
    const container = elements.get(text.containerId)
    if (container?.type !== 'rectangle' || container.angle !== 0 || text.angle !== 0) continue
    if (text.x < container.x - tolerance || text.y < container.y - tolerance
      || text.x + text.width > container.x + container.width + tolerance
      || text.y + text.height > container.y + container.height + tolerance) warnings.push({
      code: 'text_container_bounds', elementId: text.id, containerId: container.id,
      message: 'Declared text bounds extend outside the bound unrotated rectangle; inspect the label and affected connectors.',
    })
  }
  return warnings
}
