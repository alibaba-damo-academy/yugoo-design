import { createHash } from 'node:crypto'
export const archiveHash = value => createHash('sha256').update(value).digest('hex')
export function archiveFixture(contents = { 'SKILL.md': '# Original method\n', 'reference/pixel.png': Uint8Array.of(137, 80, 78, 71, 0, 255) }) {
  const files = Object.entries(contents).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, value]) => {
    const data = Buffer.from(value)
    return { path, base64: data.toString('base64'), bytes: data.length, sha256: archiveHash(data) }
  })
  const body = { format: 'studio-content-archive/v1', kind: 'bundle', pin: { name: 'demo', version: '1.0' }, provenance: { source: 'Synthetic test source', license: 'MIT' }, dependencies: [], files }
  return JSON.stringify({ ...body, sha256: archiveHash(JSON.stringify(body)) })
}
