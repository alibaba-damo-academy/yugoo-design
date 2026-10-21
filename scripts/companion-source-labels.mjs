/** Stable dependency source labels; physical module evidence remains unchanged. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { isAbsolute, relative } from 'node:path'

const require = createRequire(import.meta.url)
const { parseSync } = await import(createRequire(require.resolve('tsdown')).resolve('rolldown/utils'))
const reviewed = [
  'node_modules/.pnpm/pica@7.1.1/node_modules/pica/dist/pica.js',
  'node_modules/.pnpm/image-blob-reduce@3.0.1/node_modules/image-blob-reduce/dist/image-blob-reduce.esm.mjs',
]

export function companionSourceLabels(labelRoot = process.cwd()) {
  return {
    name: 'companion-dependency-source-labels',
    renderChunk(code, chunk) {
      // Only actual emitted line comments for the two reviewed module inputs may
      // change. Never rewrite executable strings, licenses, imports or sources.
      const labels = new Map()
      for (const id of Object.keys(chunk.modules)) {
        const normalized = id.replaceAll('\\', '/')
        const to = reviewed.find(path => normalized.endsWith('/' + path))
        if (!to || !isAbsolute(id)) continue
        const from = relative(labelRoot, id).replaceAll('\\', '/')
        if (from !== to) labels.set('#region ' + from, '#region ' + to)
      }
      if (![...code.matchAll(/^\/\/(#region [^\r\n]+)$/gmu)].some(match => labels.has(match[1]))) return null
      const parsed = parseSync(chunk.fileName, code)
      assert.equal(parsed.errors.length, 0, 'Source-label normalization requires valid emitted JS')
      const edits = parsed.comments.filter(comment => comment.type === 'Line' && labels.has(comment.value))
      if (!edits.length) return null
      for (const label of labels.keys()) assert.ok(edits.filter(edit => edit.value === label).length <= 1, 'Ambiguous generated module region label')
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        code = code.slice(0, edit.start) + '//' + labels.get(edit.value) + code.slice(edit.end)
      }
      return { code, map: null }
    },
  }
}
