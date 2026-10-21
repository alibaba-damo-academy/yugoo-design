import assert from 'node:assert/strict'
import { test } from 'node:test'
import { posix, win32 } from 'node:path'
import { isPathWithin } from '../src/npm-installer-paths.mjs'

test('registration boundaries reject parents, siblings, other volumes and UNC shares', () => {
  for (const [paths, root, child, parent, sibling] of [
    [posix, '/data/product', '/data/product/bin', '/data', '/data/product-old'],
    [win32, 'C:\\data\\product', 'C:\\data\\product\\bin', 'C:\\data', 'C:\\data\\product-old'],
  ]) {
    assert.equal(isPathWithin(root, root, paths), true)
    assert.equal(isPathWithin(root, child, paths), true)
    assert.equal(isPathWithin(root, parent, paths), false)
    assert.equal(isPathWithin(root, sibling, paths), false)
  }
  assert.equal(isPathWithin('C:\\data\\product', 'D:\\data\\product', win32), false)
  assert.equal(isPathWithin('C:\\data\\product', 'c:\\DATA\\PRODUCT\\bin', win32), true)
  assert.equal(isPathWithin('\\\\host\\one\\product', '\\\\host\\two\\product', win32), false)
  assert.equal(isPathWithin('\\\\host\\one\\product', '\\\\other\\one\\product', win32), false)
  assert.equal(isPathWithin('\\\\host\\one\\product', '\\\\host\\one\\product\\bin', win32), true)
})
