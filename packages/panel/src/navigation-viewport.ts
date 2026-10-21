/** Place an unscaled diagram object at the visible canvas center. */
export function centeredNavigationPosition(
  rect: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
  screenToDiagram: (point: { x: number; y: number }) => { x: number; y: number },
): { x: number; y: number } {
  const center = screenToDiagram({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 }
}
