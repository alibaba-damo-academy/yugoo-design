import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const MIME = Object.freeze({ eot: 'application/vnd.ms-fontobject', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' })
const inside = (root, file) => { const path = relative(root, file); return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\')) }

/** Plan post-preprocessor CSS resource rewrites using an explicitly supplied mature parser.
 * The renderer must provide the actual packaged-resource representation; this helper
 * does not invent a host URL, embed bytes, emit files or assert browser equivalence.
 */
export function planCssResources(css, { file, ownerRoot, parser, renderUrl,
  maxCssBytes = 2 * 1024 * 1024, maxResources = 512,
  maxResourceBytes = 32 * 1024 * 1024, maxTotalResourceBytes = 64 * 1024 * 1024 }) {
  for (const limit of [maxCssBytes, maxResources, maxResourceBytes, maxTotalResourceBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid CSS resource planning budget')
  }
  if (typeof css !== 'string' || Buffer.byteLength(css) > maxCssBytes) throw Error('CSS input exceeds resource planning budget')
  if (typeof parser?.parse !== 'function' || typeof parser?.walk !== 'function' || typeof parser?.url?.encode !== 'function') throw Error('Explicit CSS parser required')
  if (typeof renderUrl !== 'function') throw Error('Explicit packaged resource URL renderer required')
  const root = realpathSync(ownerRoot), stylesheet = realpathSync(file)
  if (!inside(root, stylesheet)) throw Error('Stylesheet is outside declared resource owner')
  const ast = parser.parse(css, { positions: true, parseCustomProperty: true, onParseError(error) { throw error } })
  const resources = [], externalReferences = [], edits = []
  let total = 0
  parser.walk(ast, function (node) {
    if (node.type === 'Raw') throw Error('Unparsed CSS cannot certify resource closure')
    if (node.type === 'Function' && ['image-set', '-webkit-image-set'].includes(node.name.toLowerCase())) {
      node.children.forEach(child => { if (child.type === 'String') throw Error('String image-set resources require explicit parser support') })
    }
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
      throw Error('CSS imports must be resolved by the stylesheet graph before resource planning')
    }
    if (node.type !== 'Url') return
    const originalUrl = node.value
    if (!originalUrl || /[\u0000-\u001f\u007f]/u.test(originalUrl)) throw Error('Invalid CSS resource URL')
    if (/^(?:data:|https?:|blob:|\/|#)/iu.test(originalUrl)) {
      externalReferences.push({ originalUrl, representationVerified: false })
      return
    }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(originalUrl)) throw Error('Unsupported CSS resource scheme')
    if (resources.length >= maxResources) throw Error('CSS resource count exceeds budget')
    const split = originalUrl.search(/[?#]/u)
    const rawPath = split < 0 ? originalUrl : originalUrl.slice(0, split)
    const suffix = split < 0 ? '' : originalUrl.slice(split)
    let path
    try { path = decodeURIComponent(rawPath) } catch { throw Error('Invalid encoded CSS resource path') }
    if (!path || /[\\\u0000-\u001f\u007f]/u.test(path)) throw Error('Invalid CSS resource path')
    const absolute = resolve(dirname(stylesheet), path)
    if (!inside(root, absolute)) throw Error('CSS resource is outside declared owner')
    const parts = relative(root, absolute).split(/[\/\\]/u)
    let checked = root
    for (const [i, part] of parts.entries()) {
      checked = resolve(checked, part)
      const info = lstatSync(checked)
      if (info.isSymbolicLink() || !(i === parts.length - 1 ? info.isFile() : info.isDirectory())) throw Error('CSS resource must be a regular owned file')
    }
    const info = lstatSync(absolute)
    if (info.size > maxResourceBytes || total + info.size > maxTotalResourceBytes) throw Error('CSS resource bytes exceed budget')
    // Read the checked size plus one byte, not an unbounded readFile: a growing
    // source cannot allocate past the approved per-resource read budget.
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let bytes
    try {
      const opened = fstatSync(fd)
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw Error('CSS resource identity changed')
      const buffer = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null)
        if (count === 0) break
        length += count
      }
      const final = fstatSync(fd)
      if (length !== info.size || final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs) throw Error('CSS resource changed or exceeded budget')
      bytes = buffer.subarray(0, length)
    } finally { closeSync(fd) }
    total += bytes.length
    const extension = absolute.slice(absolute.lastIndexOf('.') + 1).toLowerCase()
    if (!Object.hasOwn(MIME, extension)) throw Error('Unsupported CSS resource MIME')
    const resource = { originalUrl, suffix, source: absolute, bytes: Buffer.from(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'), mime: MIME[extension] }
    const rendered = renderUrl(resource)
    if (typeof rendered !== 'string' || !rendered || /[\u0000-\u001f\u007f]/u.test(rendered)) throw Error('Invalid packaged CSS resource URL')
    if (suffix && !rendered.endsWith(suffix)) throw Error('Packaged CSS resource URL lost query or fragment')
    resources.push(resource)
    edits.push({ start: node.loc.start.offset, end: node.loc.end.offset, text: parser.url.encode(rendered) })
  })
  // Exact offset edits preserve unrelated comments, strings and syntax byte-for-byte.
  let rewritten = css
  for (const edit of edits.sort((a, b) => b.start - a.start)) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end)
  return { css: rewritten, resources, externalReferences, representationVerified: false }
}
