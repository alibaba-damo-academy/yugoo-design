const MIME_TYPES = Object.freeze({
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.eot': 'application/vnd.ms-fontobject',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
})

/** Resolve one admitted top-level static name; query strings are not filenames. */
export function staticAssetRequest(requestUrl, admittedNames) {
  if (typeof requestUrl !== 'string' || !requestUrl.startsWith('/') || requestUrl.includes('#')) return null
  const pathname = requestUrl.split('?', 1)[0]
  let name
  try { name = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1)) }
  catch { return null }
  // Validate before path normalization: encoded separators/traversal never gain admission.
  if (!name || name === '.' || name === '..' || /[\/\\\u0000-\u001f\u007f]/u.test(name)) return null
  if (!admittedNames.has(name)) return null
  const suffix = name.slice(name.lastIndexOf('.')).toLowerCase()
  const type = Object.hasOwn(MIME_TYPES, suffix) ? MIME_TYPES[suffix] : 'application/octet-stream'
  return { name, type }
}
