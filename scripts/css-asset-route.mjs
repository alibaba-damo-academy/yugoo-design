import { createHash } from 'node:crypto'

const MIME = Object.freeze({ eot: 'application/vnd.ms-fontobject', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' })

/** Serve only a verified, immutable CSS asset table, never a directory.
 * Mount behind the owning host's existing access policy. This helper does not
 * supply authentication, register a host route, or certify a packaged build.
 */
export function createCssAssetHandler({ prefix, assets }) {
  if (typeof prefix !== 'string' || !/^\/design-system-assets\/[a-z0-9-]+\/$/u.test(prefix)) throw Error('Invalid owned CSS asset prefix')
  if (!Array.isArray(assets) || assets.length > 512) throw Error('CSS asset table exceeds budget')
  const table = new Map()
  let total = 0
  for (const asset of assets) {
    if (!Buffer.isBuffer(asset?.bytes) || asset.bytes.length > 32 * 1024 * 1024) throw Error('Invalid CSS asset bytes or budget')
    total += asset.bytes.length
    if (total > 64 * 1024 * 1024) throw Error('CSS asset table bytes exceed budget')
    const match = /^([a-f0-9]{64})\.([a-z0-9]+)$/u.exec(asset.name ?? '')
    if (!match || !Object.hasOwn(MIME, match[2]) || asset.mime !== MIME[match[2]]) throw Error('Invalid CSS asset identity or MIME')
    const bytes = Buffer.from(asset.bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== match[1] || asset.sha256 !== hash) throw Error('CSS asset bytes do not match content identity')
    if (table.has(asset.name)) throw Error('Duplicate CSS asset identity')
    table.set(asset.name, { bytes, mime: asset.mime, etag: `"${hash}"` })
  }
  return function cssAssetHandler(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.statusCode = 405
      response.setHeader('Allow', 'GET, HEAD')
      response.end()
      return
    }
    const url = request.url
    let name
    if (typeof url === 'string' && url.startsWith(prefix) && !/[\u0000-\u0020\u007f#]/u.test(url)) {
      const pathname = url.split('?', 1)[0]
      try { name = decodeURIComponent(pathname.slice(prefix.length)) } catch { /* invalid encoding is not admitted */ }
    }
    // Query strings are cache hints, not part of the file identity. Fragments
    // stay in generated CSS and are interpreted by the browser, not the server.
    const asset = typeof name === 'string' && /^[a-f0-9]{64}\.[a-z0-9]+$/u.test(name) ? table.get(name) : undefined
    if (!asset) {
      response.statusCode = 404
      response.end()
      return
    }
    response.statusCode = 200
    response.setHeader('Content-Type', asset.mime)
    response.setHeader('Content-Length', asset.bytes.length)
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    response.setHeader('ETag', asset.etag)
    response.end(request.method === 'HEAD' ? undefined : asset.bytes)
  }
}
