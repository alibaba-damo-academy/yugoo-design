import test from 'node:test'
import assert from 'node:assert/strict'
import { centeredNavigationPosition } from '../src/navigation-viewport.ts'

test('frame creation centers in diagram coordinates after host offset, pan and zoom', () => {
  const canvas = { left: 200, top: 80, width: 800, height: 600 }
  for (const viewport of [{ x: 0, y: 0, zoom: 1 }, { x: -320, y: 140, zoom: 2 }, { x: 35, y: -90, zoom: 0.5 }]) {
    const size = { width: 500, height: 300 }
    const position = centeredNavigationPosition(canvas, size, point => {
      assert.deepEqual(point, { x: 600, y: 380 })
      return { x: (point.x - canvas.left - viewport.x) / viewport.zoom,
        y: (point.y - canvas.top - viewport.y) / viewport.zoom }
    })
    assert.equal((position.x + size.width / 2) * viewport.zoom + viewport.x, canvas.width / 2)
    assert.equal((position.y + size.height / 2) * viewport.zoom + viewport.y, canvas.height / 2)
  }
})
