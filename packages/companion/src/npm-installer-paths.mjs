import path from 'node:path'

/** Compare paths using the host's path rules, including Windows volume changes. */
export function isPathWithin(root, target, paths = path) {
  const delta = paths.relative(root, target)
  return delta !== '..' && !delta.startsWith('..' + paths.sep) && !paths.isAbsolute(delta)
}
